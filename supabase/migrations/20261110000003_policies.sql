-- Fury Co. Athletics — views, row-level security and grants.
-- Rule of thumb: athletes see their own rows, coaches see the gym and write programming,
-- admins/owners manage the gym, money tables are written only by the service role.

-- ---------------------------------------------------------------------------------------------
-- Views
-- ---------------------------------------------------------------------------------------------
-- Staff names for class listings, without exposing staff contact details to athletes.
create view public.staff_directory as
  select gm.gym_id, gm.user_id, gm.role, p.full_name, p.avatar_url
  from public.gym_members gm
  join public.profiles p on p.id = gm.user_id
  where gm.role <> 'athlete' and gm.status = 'active' and public.is_member(gm.gym_id);

-- Class sessions with seat counts and the caller's own booking. Other athletes' bookings stay private.
create view public.class_session_overview as
  select
    s.id, s.gym_id, s.schedule_id, s.title, s.track_id, s.coach_id, s.starts_at, s.ends_at,
    s.capacity, s.status, s.notes,
    t.name as track_name,
    t.color as track_color,
    c.full_name as coach_name,
    (select count(*) from public.bookings b
      where b.session_id = s.id and b.status in ('booked', 'attended'))::int as booked_count,
    (select count(*) from public.bookings b
      where b.session_id = s.id and b.status = 'waitlisted')::int as waitlist_count,
    mine.id as my_booking_id,
    mine.status as my_booking_status,
    (select count(*) + 1 from public.bookings b
      where b.session_id = s.id and b.status = 'waitlisted'
        and mine.status = 'waitlisted' and b.booked_at < mine.booked_at)::int as my_waitlist_position
  from public.class_sessions s
  left join public.tracks t on t.id = s.track_id
  left join public.profiles c on c.id = s.coach_id
  left join public.bookings mine
    on mine.session_id = s.id and mine.user_id = (select auth.uid()) and mine.status <> 'cancelled'
  where public.is_member(s.gym_id);

-- Best load per exercise and rep count.
create view public.personal_records with (security_invoker = true) as
  select distinct on (e.user_id, e.exercise_id, e.reps)
    e.user_id, e.exercise_id, x.name as exercise_name, e.reps,
    e.load, e.load_unit, e.load_kg, e.performed_on, e.log_id
  from public.workout_log_entries e
  join public.exercises x on x.id = e.exercise_id
  where e.benchmark_name is null and e.load_kg is not null and e.load_kg > 0
  order by e.user_id, e.exercise_id, e.reps, e.load_kg desc, e.performed_on;

-- Every benchmark attempt, newest first, for history and charts.
create view public.benchmark_results with (security_invoker = true) as
  select
    e.id, e.user_id, e.benchmark_name, e.time_seconds, e.reps, e.load, e.load_unit, e.load_kg,
    e.distance_m, e.is_pr, e.performed_on, e.log_id
  from public.workout_log_entries e
  where e.benchmark_name is not null;

-- ---------------------------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------------------------
alter table public.gyms enable row level security;
alter table public.gym_secrets enable row level security;
alter table public.profiles enable row level security;
alter table public.gym_members enable row level security;
alter table public.audit_log enable row level security;
alter table public.tracks enable row level security;
alter table public.exercises enable row level security;
alter table public.workouts enable row level security;
alter table public.workout_items enable row level security;
alter table public.display_state enable row level security;
alter table public.membership_plans enable row level security;
alter table public.memberships enable row level security;
alter table public.waivers enable row level security;
alter table public.waiver_signatures enable row level security;
alter table public.class_schedules enable row level security;
alter table public.class_sessions enable row level security;
alter table public.bookings enable row level security;
alter table public.programs enable row level security;
alter table public.program_workouts enable row level security;
alter table public.enrollments enable row level security;
alter table public.workout_logs enable row level security;
alter table public.workout_log_entries enable row level security;
alter table public.coach_feedback enable row level security;
alter table public.stripe_customers enable row level security;
alter table public.payments enable row level security;
alter table public.payouts enable row level security;
alter table public.stripe_events enable row level security;

-- gyms: public facts (name, timezone, booking rules). Secrets live in gym_secrets.
create policy gyms_read on public.gyms for select to anon, authenticated using (true);
create policy gyms_admin_update on public.gyms for update to authenticated
  using (public.is_admin(id)) with check (public.is_admin(id));

create policy gym_secrets_staff_read on public.gym_secrets for select to authenticated
  using (public.is_staff(gym_id));
create policy gym_secrets_admin_update on public.gym_secrets for update to authenticated
  using (public.is_admin(gym_id)) with check (public.is_admin(gym_id));

-- profiles
create policy profiles_read_own on public.profiles for select to authenticated
  using (id = (select auth.uid()));
create policy profiles_staff_read on public.profiles for select to authenticated
  using (exists (
    select 1 from public.gym_members gm
    where gm.user_id = profiles.id and public.is_staff(gm.gym_id)));
create policy profiles_update_own on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));
create policy profiles_admin_update on public.profiles for update to authenticated
  using (exists (
    select 1 from public.gym_members gm
    where gm.user_id = profiles.id and public.is_admin(gm.gym_id)))
  with check (exists (
    select 1 from public.gym_members gm
    where gm.user_id = profiles.id and public.is_admin(gm.gym_id)));

-- gym_members: only admins change roles, and only an owner can grant or alter the owner role.
create policy gym_members_read_own on public.gym_members for select to authenticated
  using (user_id = (select auth.uid()));
create policy gym_members_staff_read on public.gym_members for select to authenticated
  using (public.is_staff(gym_id));
create policy gym_members_admin_insert on public.gym_members for insert to authenticated
  with check (
    public.is_admin(gym_id)
    and (role <> 'owner' or public.has_gym_role(gym_id, array['owner']::public.gym_role[])));
create policy gym_members_admin_update on public.gym_members for update to authenticated
  using (
    public.is_admin(gym_id)
    and (role <> 'owner' or public.has_gym_role(gym_id, array['owner']::public.gym_role[])))
  with check (
    public.is_admin(gym_id)
    and (role <> 'owner' or public.has_gym_role(gym_id, array['owner']::public.gym_role[])));
create policy gym_members_admin_delete on public.gym_members for delete to authenticated
  using (
    public.is_admin(gym_id)
    and (role <> 'owner' or public.has_gym_role(gym_id, array['owner']::public.gym_role[])));

create policy audit_log_admin_read on public.audit_log for select to authenticated
  using (public.is_admin(gym_id));

-- programming
create policy tracks_read on public.tracks for select to anon, authenticated using (true);
create policy tracks_staff_write on public.tracks for all to authenticated
  using (public.is_staff(gym_id)) with check (public.is_staff(gym_id));

create policy exercises_member_read on public.exercises for select to authenticated
  using (public.is_member(gym_id));
create policy exercises_staff_write on public.exercises for all to authenticated
  using (public.is_staff(gym_id)) with check (public.is_staff(gym_id));

create policy workouts_read on public.workouts for select to authenticated
  using (public.is_staff(gym_id) or public.can_view_workout(id));
create policy workouts_staff_write on public.workouts for all to authenticated
  using (public.is_staff(gym_id)) with check (public.is_staff(gym_id));

-- Items follow their workout: the subquery is itself filtered by the workouts policies above.
create policy workout_items_read on public.workout_items for select to authenticated
  using (exists (select 1 from public.workouts w where w.id = workout_items.workout_id));
create policy workout_items_staff_write on public.workout_items for all to authenticated
  using (exists (
    select 1 from public.workouts w
    where w.id = workout_items.workout_id and public.is_staff(w.gym_id)))
  with check (exists (
    select 1 from public.workouts w
    where w.id = workout_items.workout_id and public.is_staff(w.gym_id)));

create policy display_state_staff on public.display_state for all to authenticated
  using (public.is_staff(gym_id)) with check (public.is_staff(gym_id));

-- plans and memberships
create policy plans_public_read on public.membership_plans for select to anon, authenticated
  using (active and is_public);
create policy plans_staff_read on public.membership_plans for select to authenticated
  using (public.is_staff(gym_id));
create policy plans_admin_write on public.membership_plans for all to authenticated
  using (public.is_admin(gym_id)) with check (public.is_admin(gym_id));

create policy memberships_read_own on public.memberships for select to authenticated
  using (user_id = (select auth.uid()));
create policy memberships_staff_read on public.memberships for select to authenticated
  using (public.is_staff(gym_id));
create policy memberships_admin_write on public.memberships for all to authenticated
  using (public.is_admin(gym_id)) with check (public.is_admin(gym_id));

-- waivers
create policy waivers_member_read on public.waivers for select to authenticated
  using (public.is_staff(gym_id) or (active and public.is_member(gym_id)));
create policy waivers_admin_write on public.waivers for all to authenticated
  using (public.is_admin(gym_id)) with check (public.is_admin(gym_id));

create policy waiver_signatures_read on public.waiver_signatures for select to authenticated
  using (user_id = (select auth.uid()) or public.is_staff(gym_id));

-- classes
create policy class_schedules_member_read on public.class_schedules for select to authenticated
  using (public.is_member(gym_id));
create policy class_schedules_admin_write on public.class_schedules for all to authenticated
  using (public.is_admin(gym_id)) with check (public.is_admin(gym_id));

create policy class_sessions_member_read on public.class_sessions for select to authenticated
  using (public.is_member(gym_id));
create policy class_sessions_admin_write on public.class_sessions for all to authenticated
  using (public.is_admin(gym_id)) with check (public.is_admin(gym_id));

-- bookings are read-only for clients; book_class / cancel_booking / check_in do the writing.
create policy bookings_read on public.bookings for select to authenticated
  using (user_id = (select auth.uid()) or public.is_staff(gym_id));

-- programs
create policy programs_public_read on public.programs for select to anon, authenticated
  using (status = 'published');
create policy programs_enrolled_read on public.programs for select to authenticated
  using (exists (
    select 1 from public.enrollments e
    where e.program_id = programs.id and e.user_id = (select auth.uid())));
create policy programs_staff_read on public.programs for select to authenticated
  using (public.is_staff(gym_id));
create policy programs_staff_write on public.programs for all to authenticated
  using (public.is_staff(gym_id)) with check (public.is_staff(gym_id));

create policy program_workouts_read on public.program_workouts for select to authenticated
  using (exists (
    select 1 from public.programs p
    where p.id = program_workouts.program_id
      and (public.is_staff(p.gym_id) or exists (
        select 1 from public.enrollments e
        where e.program_id = p.id and e.user_id = (select auth.uid())))));
create policy program_workouts_staff_write on public.program_workouts for all to authenticated
  using (exists (
    select 1 from public.programs p
    where p.id = program_workouts.program_id and public.is_staff(p.gym_id)))
  with check (exists (
    select 1 from public.programs p
    where p.id = program_workouts.program_id and public.is_staff(p.gym_id)));

create policy enrollments_read_own on public.enrollments for select to authenticated
  using (user_id = (select auth.uid()));
create policy enrollments_staff_read on public.enrollments for select to authenticated
  using (public.is_staff(gym_id));
create policy enrollments_admin_write on public.enrollments for all to authenticated
  using (public.is_admin(gym_id)) with check (public.is_admin(gym_id));

-- logging
create policy workout_logs_read on public.workout_logs for select to authenticated
  using (user_id = (select auth.uid()) or public.is_staff(gym_id));
create policy workout_logs_delete_own on public.workout_logs for delete to authenticated
  using (user_id = (select auth.uid()));

create policy workout_log_entries_read on public.workout_log_entries for select to authenticated
  using (
    user_id = (select auth.uid())
    or exists (
      select 1 from public.workout_logs l
      where l.id = workout_log_entries.log_id and public.is_staff(l.gym_id)));

create policy coach_feedback_read on public.coach_feedback for select to authenticated
  using (exists (
    select 1 from public.workout_logs l
    where l.id = coach_feedback.log_id
      and (l.user_id = (select auth.uid()) or public.is_staff(l.gym_id))));
create policy coach_feedback_staff_insert on public.coach_feedback for insert to authenticated
  with check (
    coach_id = (select auth.uid())
    and exists (
      select 1 from public.workout_logs l
      where l.id = coach_feedback.log_id and public.is_staff(l.gym_id)));
create policy coach_feedback_author_delete on public.coach_feedback for delete to authenticated
  using (coach_id = (select auth.uid()));

-- money: readable by the owner of the row and by admins; never writable by clients
create policy stripe_customers_read_own on public.stripe_customers for select to authenticated
  using (user_id = (select auth.uid()));
create policy payments_read on public.payments for select to authenticated
  using (user_id = (select auth.uid()) or public.is_admin(gym_id));
create policy payouts_admin_read on public.payouts for select to authenticated
  using (public.is_admin(gym_id));
-- stripe_events: no policies — service role only.

-- ---------------------------------------------------------------------------------------------
-- Grants. Explicit, so the result does not depend on a project's default privileges.
-- ---------------------------------------------------------------------------------------------
revoke all on all tables in schema public from anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;

grant usage on schema public to anon, authenticated, service_role;
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;
grant usage on schema private to service_role;
grant execute on all functions in schema private to service_role;

-- Logged-out visitors: the public catalogue only.
grant select on public.gyms, public.tracks, public.membership_plans, public.programs to anon;
grant execute on function public.get_display(text) to anon;

-- Signed-in users: row-level security decides the rest.
grant select on all tables in schema public to authenticated;
revoke select on public.stripe_events from authenticated;
grant update on public.gyms, public.gym_secrets, public.profiles to authenticated;
grant insert, update, delete on
  public.gym_members, public.tracks, public.exercises, public.workouts, public.workout_items,
  public.membership_plans, public.memberships, public.waivers, public.class_schedules,
  public.class_sessions, public.programs, public.program_workouts, public.enrollments
  to authenticated;
grant update on public.display_state to authenticated;
grant insert, delete on public.coach_feedback to authenticated;
grant delete on public.workout_logs to authenticated;
grant execute on all functions in schema public to authenticated;

-- Objects added by later migrations must opt in the same way.
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;
