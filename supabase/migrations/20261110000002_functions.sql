-- Fury Co. Athletics — access helpers and RPCs.
-- Business rules live here so the iOS app and the web console share one implementation.

-- ---------------------------------------------------------------------------------------------
-- Access helpers (security definer so policies on gym_members do not recurse)
-- ---------------------------------------------------------------------------------------------
create or replace function public.default_gym_id()
returns uuid language sql stable security definer set search_path = '' as $$
  select id from public.gyms where is_default limit 1;
$$;

create or replace function public.has_gym_role(p_gym uuid, p_roles public.gym_role[])
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.gym_members gm
    where gm.gym_id = p_gym
      and gm.user_id = (select auth.uid())
      and gm.status = 'active'
      and gm.role = any (p_roles)
  );
$$;

create or replace function public.is_member(p_gym uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.has_gym_role(p_gym, array['athlete', 'coach', 'admin', 'owner']::public.gym_role[]);
$$;

create or replace function public.is_staff(p_gym uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.has_gym_role(p_gym, array['coach', 'admin', 'owner']::public.gym_role[]);
$$;

create or replace function public.is_admin(p_gym uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.has_gym_role(p_gym, array['admin', 'owner']::public.gym_role[]);
$$;

create or replace function public.gym_today(p_gym uuid)
returns date language sql stable security definer set search_path = '' as $$
  select (now() at time zone g.timezone)::date from public.gyms g where g.id = p_gym;
$$;

-- A membership that currently grants facility access (workouts, class booking).
create or replace function private.has_facility_access(p_user uuid, p_gym uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.memberships m
    where m.user_id = p_user
      and m.gym_id = p_gym
      and m.status in ('active', 'past_due')
      and (m.ends_at is null or m.ends_at > now())
  );
$$;

create or replace function public.has_facility_access(p_gym uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.has_facility_access((select auth.uid()), p_gym);
$$;

-- Is this workout visible to the calling athlete right now?
create or replace function public.can_view_workout(p_workout uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.workouts w
    where w.id = p_workout
      and (
        -- anything the athlete has already logged stays in their history
        exists (
          select 1 from public.workout_logs l
          where l.workout_id = w.id and l.user_id = (select auth.uid())
        )
        or (
          w.status = 'published'
          and w.publish_at <= now()
          and (
            (w.scheduled_date is not null and private.has_facility_access((select auth.uid()), w.gym_id))
            or exists (
              select 1
              from public.program_workouts pw
              join public.programs p on p.id = pw.program_id
              join public.enrollments e on e.program_id = pw.program_id
              where pw.workout_id = w.id
                and e.user_id = (select auth.uid())
                and e.status = 'active'
                and public.gym_today(w.gym_id) <= e.expires_at
                and (
                  p.unlock_mode = 'all'
                  or (p.unlock_mode = 'weekly'
                      and public.gym_today(w.gym_id) >= e.start_date + (pw.week - 1) * 7)
                  or (p.unlock_mode = 'daily'
                      and public.gym_today(w.gym_id) >= e.start_date + (pw.week - 1) * 7 + (pw.day - 1))
                )
            )
          )
        )
      )
  );
$$;

-- ---------------------------------------------------------------------------------------------
-- New account → profile + athlete membership of the default gym
-- ---------------------------------------------------------------------------------------------
create or replace function private.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_gym uuid;
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data ->> 'full_name', ''))
  on conflict (id) do nothing;

  select id into v_gym from public.gyms where is_default limit 1;
  if v_gym is not null then
    insert into public.gym_members (gym_id, user_id, role)
    values (v_gym, new.id, 'athlete')
    on conflict do nothing;
  end if;
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

create or replace function private.handle_user_email_change()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.profiles set email = new.email where id = new.id;
  return new;
end $$;

create trigger on_auth_user_email_changed
  after update of email on auth.users
  for each row when (old.email is distinct from new.email)
  execute function private.handle_user_email_change();

-- ---------------------------------------------------------------------------------------------
-- Audit trail for sensitive tables
-- ---------------------------------------------------------------------------------------------
create or replace function private.audit()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_row jsonb := to_jsonb(case when tg_op = 'DELETE' then old else new end);
begin
  insert into public.audit_log (gym_id, actor_id, action, entity, entity_id, details)
  values (
    nullif(v_row ->> 'gym_id', '')::uuid,
    (select auth.uid()),
    lower(tg_op),
    tg_table_name,
    coalesce(v_row ->> 'id', v_row ->> 'user_id', v_row ->> 'gym_id'),
    case when tg_op = 'UPDATE'
      then jsonb_build_object('before', to_jsonb(old), 'after', to_jsonb(new))
      else v_row end
  );
  return null;
end $$;

create trigger audit_gym_members after insert or update or delete on public.gym_members
  for each row execute function private.audit();
create trigger audit_memberships after insert or update or delete on public.memberships
  for each row execute function private.audit();
create trigger audit_enrollments after insert or update or delete on public.enrollments
  for each row execute function private.audit();
create trigger audit_membership_plans after insert or update or delete on public.membership_plans
  for each row execute function private.audit();
create trigger audit_programs after insert or update or delete on public.programs
  for each row execute function private.audit();
create trigger audit_display_state after update on public.display_state
  for each row execute function private.audit();

-- ---------------------------------------------------------------------------------------------
-- Waivers
-- ---------------------------------------------------------------------------------------------
create or replace function private.missing_required_waiver(p_user uuid, p_gym uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.waivers w
    where w.gym_id = p_gym and w.active and w.required
      and not exists (
        select 1 from public.waiver_signatures s
        where s.waiver_id = w.id and s.user_id = p_user
      )
  );
$$;

create or replace function public.sign_waiver(p_waiver uuid, p_signed_name text)
returns public.waiver_signatures
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_waiver public.waivers;
  v_headers jsonb := coalesce(nullif(current_setting('request.headers', true), ''), '{}')::jsonb;
  v_sig public.waiver_signatures;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if length(btrim(coalesce(p_signed_name, ''))) < 2 then raise exception 'signature_required'; end if;

  select * into v_waiver from public.waivers where id = p_waiver and active;
  if not found then raise exception 'waiver_not_found'; end if;
  if not public.is_member(v_waiver.gym_id) then raise exception 'forbidden' using errcode = '42501'; end if;

  insert into public.waiver_signatures (waiver_id, gym_id, user_id, signed_name, ip_address, user_agent)
  values (
    v_waiver.id, v_waiver.gym_id, v_uid, btrim(p_signed_name),
    split_part(v_headers ->> 'x-forwarded-for', ',', 1),
    v_headers ->> 'user-agent'
  )
  on conflict (waiver_id, user_id) do nothing;

  select * into v_sig from public.waiver_signatures where waiver_id = v_waiver.id and user_id = v_uid;
  return v_sig;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Class booking
-- ---------------------------------------------------------------------------------------------
-- Picks the membership a booking should draw on: unlimited first, then the pack that expires soonest.
create or replace function private.find_entitlement(p_user uuid, p_gym uuid, p_at timestamptz)
returns uuid language sql security definer set search_path = '' as $$
  select m.id
  from public.memberships m
  where m.user_id = p_user
    and m.gym_id = p_gym
    and m.status in ('active', 'past_due')
    and (m.ends_at is null or m.ends_at > p_at)
    and (m.credits_remaining is null or m.credits_remaining > 0)
  order by (m.credits_remaining is null) desc, m.ends_at asc nulls last, m.created_at
  limit 1
  for update;
$$;

-- Fills free seats from the waitlist in the order people joined it. Caller holds the session lock.
create or replace function private.promote_waitlist(p_session uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_session public.class_sessions;
  v_taken int;
  v_wait record;
  v_membership uuid;
  v_uses_credit boolean;
begin
  select * into v_session from public.class_sessions where id = p_session;
  if v_session.status <> 'scheduled' or v_session.starts_at <= now() then return; end if;

  for v_wait in
    select b.id, b.user_id from public.bookings b
    where b.session_id = p_session and b.status = 'waitlisted'
    order by b.booked_at, b.id
  loop
    select count(*) into v_taken from public.bookings
      where session_id = p_session and status in ('booked', 'attended');
    exit when v_taken >= v_session.capacity;

    v_membership := private.find_entitlement(v_wait.user_id, v_session.gym_id, v_session.starts_at);
    continue when v_membership is null;

    select m.credits_remaining is not null into v_uses_credit
      from public.memberships m where m.id = v_membership;
    if v_uses_credit then
      update public.memberships set credits_remaining = credits_remaining - 1 where id = v_membership;
    end if;
    update public.bookings
      set status = 'booked', membership_id = v_membership, credit_used = v_uses_credit
      where id = v_wait.id;
  end loop;
end $$;

create or replace function public.book_class(p_session uuid, p_user uuid default null)
returns public.bookings
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_target uuid := coalesce(p_user, auth.uid());
  v_session public.class_sessions;
  v_gym public.gyms;
  v_by_staff boolean;
  v_booking public.bookings;
  v_membership uuid;
  v_uses_credit boolean := false;
  v_taken int;
  v_status public.booking_status;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;

  -- The row lock serialises concurrent bookings for the same class.
  select * into v_session from public.class_sessions where id = p_session for update;
  if not found then raise exception 'session_not_found'; end if;

  v_by_staff := public.is_staff(v_session.gym_id);
  if v_target <> v_uid and not v_by_staff then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.gym_members gm
    where gm.gym_id = v_session.gym_id and gm.user_id = v_target and gm.status = 'active'
  ) then
    raise exception 'not_a_member';
  end if;
  if v_session.status <> 'scheduled' then raise exception 'session_cancelled'; end if;

  select * into v_gym from public.gyms where id = v_session.gym_id;
  if not (v_by_staff and v_target <> v_uid) then
    if v_session.starts_at <= now() then raise exception 'session_started'; end if;
    if v_session.starts_at > now() + make_interval(days => v_gym.booking_window_days) then
      raise exception 'booking_not_open';
    end if;
    if private.missing_required_waiver(v_target, v_session.gym_id) then
      raise exception 'waiver_required';
    end if;
  end if;

  select * into v_booking from public.bookings
    where session_id = p_session and user_id = v_target and status <> 'cancelled';
  if found then return v_booking; end if;

  v_membership := private.find_entitlement(v_target, v_session.gym_id, v_session.starts_at);
  -- Staff may add a walk-in who has no membership yet; athletes cannot book without one.
  if v_membership is null and not (v_by_staff and v_target <> v_uid) then
    raise exception 'no_entitlement';
  end if;

  select count(*) into v_taken from public.bookings
    where session_id = p_session and status in ('booked', 'attended');
  v_status := case when v_taken < v_session.capacity then 'booked' else 'waitlisted' end;

  -- A waitlist place costs nothing; the credit is taken when a seat is actually assigned.
  if v_status = 'booked' and v_membership is not null then
    select m.credits_remaining is not null into v_uses_credit
      from public.memberships m where m.id = v_membership;
    if v_uses_credit then
      update public.memberships set credits_remaining = credits_remaining - 1 where id = v_membership;
    end if;
  end if;

  insert into public.bookings (gym_id, session_id, user_id, status, membership_id, credit_used)
  values (
    v_session.gym_id, p_session, v_target, v_status,
    case when v_status = 'booked' then v_membership end,
    v_uses_credit
  )
  returning * into v_booking;
  return v_booking;
end $$;

create or replace function public.cancel_booking(p_booking uuid)
returns public.bookings
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_booking public.bookings;
  v_session public.class_sessions;
  v_gym public.gyms;
  v_by_staff boolean;
  v_late boolean;
  v_freed_seat boolean;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;

  select session_id into v_booking.session_id from public.bookings where id = p_booking;
  if not found then raise exception 'booking_not_found'; end if;
  select * into v_session from public.class_sessions where id = v_booking.session_id for update;
  select * into v_booking from public.bookings where id = p_booking;

  v_by_staff := public.is_staff(v_session.gym_id);
  if v_booking.user_id <> v_uid and not v_by_staff then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if v_booking.status = 'cancelled' then return v_booking; end if;
  if not v_by_staff then
    if v_booking.status in ('attended', 'no_show') then raise exception 'already_checked_in'; end if;
    if v_session.starts_at <= now() then raise exception 'session_started'; end if;
  end if;

  select * into v_gym from public.gyms where id = v_session.gym_id;
  v_late := now() > v_session.starts_at - make_interval(mins => v_gym.cancel_cutoff_minutes);
  v_freed_seat := v_booking.status in ('booked', 'attended');

  -- The credit comes back unless the athlete cancelled inside the cutoff window.
  if v_booking.credit_used and v_booking.membership_id is not null and (v_by_staff or not v_late) then
    update public.memberships set credits_remaining = credits_remaining + 1
      where id = v_booking.membership_id and credits_remaining is not null;
  end if;

  update public.bookings
    set status = 'cancelled',
        cancelled_at = now(),
        late_cancel = (v_late and not v_by_staff and v_booking.status = 'booked')
    where id = p_booking
    returning * into v_booking;

  if v_freed_seat then perform private.promote_waitlist(v_session.id); end if;
  return v_booking;
end $$;

create or replace function public.check_in(p_booking uuid, p_status public.booking_status default 'attended')
returns public.bookings
language plpgsql security definer set search_path = '' as $$
declare
  v_booking public.bookings;
begin
  select * into v_booking from public.bookings where id = p_booking;
  if not found then raise exception 'booking_not_found'; end if;
  if not public.is_staff(v_booking.gym_id) then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_status not in ('attended', 'no_show', 'booked') then raise exception 'invalid_status'; end if;
  if v_booking.status not in ('booked', 'attended', 'no_show') then raise exception 'not_booked'; end if;

  update public.bookings
    set status = p_status,
        checked_in_at = case when p_status = 'attended' then now() end,
        checked_in_by = case when p_status = 'attended' then auth.uid() end
    where id = p_booking
    returning * into v_booking;
  return v_booking;
end $$;

-- Turns the recurring schedule into bookable sessions for a date range. Safe to re-run.
create or replace function public.generate_sessions(p_gym uuid, p_from date, p_to date)
returns int
language plpgsql security definer set search_path = '' as $$
declare
  v_count int;
begin
  if not public.is_admin(p_gym) then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_to < p_from or p_to - p_from > 180 then raise exception 'invalid_range'; end if;

  insert into public.class_sessions
    (gym_id, schedule_id, title, track_id, coach_id, starts_at, ends_at, capacity)
  select
    s.gym_id, s.id, s.title, s.track_id, s.coach_id,
    ((p_from + n) + s.start_time) at time zone g.timezone,
    ((p_from + n) + s.start_time) at time zone g.timezone + make_interval(mins => s.duration_minutes),
    s.capacity
  from public.class_schedules s
  join public.gyms g on g.id = s.gym_id
  cross join generate_series(0, p_to - p_from) as n
  where s.gym_id = p_gym
    and s.active
    and extract(dow from (p_from + n)) = s.weekday
    and (s.valid_from is null or (p_from + n) >= s.valid_from)
    and (s.valid_until is null or (p_from + n) <= s.valid_until)
  on conflict (schedule_id, starts_at) do nothing;

  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Athlete calendar: facility workouts by date + program days from the athlete's own start date
-- ---------------------------------------------------------------------------------------------
create or replace function public.my_calendar(p_from date, p_to date)
returns table (
  calendar_date date,
  workout_id uuid,
  title text,
  track_id uuid,
  track_name text,
  track_color text,
  source text,
  program_id uuid,
  program_name text,
  enrollment_id uuid,
  week int,
  day int,
  locked boolean,
  log_id uuid
)
language sql stable security definer set search_path = '' as $$
  -- Facility programming, for athletes with facility access
  select
    w.scheduled_date, w.id, w.title, t.id, t.name, t.color,
    'facility'::text, null::uuid, null::text, null::uuid, null::int, null::int,
    false,
    (select l.id from public.workout_logs l
      where l.workout_id = w.id and l.user_id = (select auth.uid()) and l.enrollment_id is null
      limit 1)
  from public.workouts w
  left join public.tracks t on t.id = w.track_id
  where w.scheduled_date between p_from and p_to
    and w.status = 'published'
    and w.publish_at <= now()
    and not w.is_template
    and private.has_facility_access((select auth.uid()), w.gym_id)

  union all

  -- Enrolled programs: day N of week M lands on start_date + (M-1)*7 + (N-1)
  select
    e.start_date + (pw.week - 1) * 7 + (pw.day - 1), w.id, w.title, t.id, t.name, t.color,
    'program'::text, p.id, p.name, e.id, pw.week, pw.day,
    not (
      w.status = 'published'
      and w.publish_at <= now()
      and public.gym_today(e.gym_id) <= e.expires_at
      and (
        p.unlock_mode = 'all'
        or (p.unlock_mode = 'weekly' and public.gym_today(e.gym_id) >= e.start_date + (pw.week - 1) * 7)
        or (p.unlock_mode = 'daily'
            and public.gym_today(e.gym_id) >= e.start_date + (pw.week - 1) * 7 + (pw.day - 1))
      )
    ),
    (select l.id from public.workout_logs l
      where l.workout_id = w.id and l.user_id = e.user_id and l.enrollment_id = e.id
      limit 1)
  from public.enrollments e
  join public.programs p on p.id = e.program_id
  join public.program_workouts pw on pw.program_id = p.id
  join public.workouts w on w.id = pw.workout_id
  left join public.tracks t on t.id = coalesce(w.track_id, p.track_id)
  where e.user_id = (select auth.uid())
    and e.status = 'active'
    and e.start_date + (pw.week - 1) * 7 + (pw.day - 1) between p_from and p_to
  order by 1, 7, 12;
$$;

-- Athletes may move their own start date until the program begins; staff may move it any time.
-- The expiry moves with it, so an extension granted by staff is preserved.
create or replace function public.set_enrollment_start(p_enrollment uuid, p_start date)
returns public.enrollments
language plpgsql security definer set search_path = '' as $$
declare
  v_enrollment public.enrollments;
  v_today date;
  v_by_staff boolean;
begin
  select * into v_enrollment from public.enrollments where id = p_enrollment for update;
  if not found then raise exception 'enrollment_not_found'; end if;
  v_by_staff := public.is_staff(v_enrollment.gym_id);
  if v_enrollment.user_id <> auth.uid() and not v_by_staff then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  v_today := public.gym_today(v_enrollment.gym_id);
  if not v_by_staff then
    if v_enrollment.status <> 'active' then raise exception 'enrollment_not_active'; end if;
    if v_enrollment.start_date <= v_today then raise exception 'program_already_started'; end if;
    if p_start < v_today then raise exception 'start_date_in_past'; end if;
    if p_start > v_today + 90 then raise exception 'start_date_too_far'; end if;
  end if;

  update public.enrollments
    set expires_at = expires_at + (p_start - start_date),
        start_date = p_start
    where id = p_enrollment
    returning * into v_enrollment;
  return v_enrollment;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Workout logging
-- ---------------------------------------------------------------------------------------------
-- Replaces the athlete's log for a workout in one transaction and flags personal records.
-- p_entries: [{workout_item_id, set_index, load, load_unit, sets, reps, time_seconds, distance_m,
--              pace_seconds, pace_unit, splits, rpe, comments}]
create or replace function public.submit_workout_log(
  p_workout uuid,
  p_performed_on date,
  p_entries jsonb,
  p_enrollment uuid default null,
  p_notes text default null,
  p_rpe numeric default null,
  p_duration_seconds int default null
)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_workout public.workouts;
  v_log_id uuid;
  v_entry jsonb;
  v_item public.workout_items;
  v_new_id uuid;
  v_load_kg numeric;
  v_reps int;
  v_time numeric;
  v_bench text;
  v_is_pr boolean;
  v_prs jsonb := '[]'::jsonb;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if jsonb_typeof(coalesce(p_entries, '[]'::jsonb)) <> 'array' then raise exception 'invalid_entries'; end if;

  select * into v_workout from public.workouts where id = p_workout;
  if not found then raise exception 'workout_not_found'; end if;
  if not (public.can_view_workout(p_workout) or public.is_staff(v_workout.gym_id)) then
    raise exception 'workout_locked';
  end if;
  if p_enrollment is not null and not exists (
    select 1 from public.enrollments e
    join public.program_workouts pw on pw.program_id = e.program_id
    where e.id = p_enrollment and e.user_id = v_uid and pw.workout_id = p_workout
  ) then
    raise exception 'enrollment_mismatch';
  end if;

  select id into v_log_id from public.workout_logs
    where user_id = v_uid and workout_id = p_workout
      and enrollment_id is not distinct from p_enrollment;
  if v_log_id is null then
    insert into public.workout_logs
      (gym_id, user_id, workout_id, enrollment_id, performed_on, notes, rpe, duration_seconds)
    values (v_workout.gym_id, v_uid, p_workout, p_enrollment, p_performed_on, p_notes, p_rpe, p_duration_seconds)
    returning id into v_log_id;
  else
    update public.workout_logs
      set performed_on = p_performed_on, notes = p_notes, rpe = p_rpe, duration_seconds = p_duration_seconds
      where id = v_log_id;
    delete from public.workout_log_entries where log_id = v_log_id;
  end if;

  for v_entry in select * from jsonb_array_elements(coalesce(p_entries, '[]'::jsonb))
  loop
    select * into v_item from public.workout_items
      where id = (v_entry ->> 'workout_item_id')::uuid and workout_id = p_workout;
    if not found then raise exception 'invalid_workout_item'; end if;

    v_bench := case when 'benchmark' = any (v_item.metrics)
                    then coalesce(nullif(btrim(v_item.benchmark_name), ''), v_item.title) end;

    insert into public.workout_log_entries (
      log_id, user_id, workout_item_id, exercise_id, benchmark_name, set_index,
      load, load_unit, sets, reps, time_seconds, distance_m, pace_seconds, pace_unit,
      splits, rpe, comments, performed_on
    ) values (
      v_log_id, v_uid, v_item.id, v_item.exercise_id, v_bench,
      coalesce((v_entry ->> 'set_index')::int, 1),
      (v_entry ->> 'load')::numeric,
      coalesce(v_entry ->> 'load_unit', 'lb'),
      (v_entry ->> 'sets')::int,
      (v_entry ->> 'reps')::int,
      (v_entry ->> 'time_seconds')::numeric,
      (v_entry ->> 'distance_m')::numeric,
      (v_entry ->> 'pace_seconds')::numeric,
      v_entry ->> 'pace_unit',
      case when jsonb_typeof(v_entry -> 'splits') = 'array' then v_entry -> 'splits' end,
      (v_entry ->> 'rpe')::numeric,
      nullif(v_entry ->> 'comments', ''),
      p_performed_on
    )
    returning id, load_kg, reps, time_seconds into v_new_id, v_load_kg, v_reps, v_time;

    v_is_pr := false;
    if v_bench is not null then
      -- Benchmarks: a faster time wins; without a time, more reps; without reps, more load.
      if v_time is not null then
        v_is_pr := not exists (
          select 1 from public.workout_log_entries o
          where o.user_id = v_uid and o.benchmark_name = v_bench and o.log_id <> v_log_id
            and o.time_seconds is not null and o.time_seconds <= v_time);
      elsif v_reps is not null then
        v_is_pr := not exists (
          select 1 from public.workout_log_entries o
          where o.user_id = v_uid and o.benchmark_name = v_bench and o.log_id <> v_log_id
            and o.reps is not null and o.reps >= v_reps);
      elsif v_load_kg is not null then
        v_is_pr := not exists (
          select 1 from public.workout_log_entries o
          where o.user_id = v_uid and o.benchmark_name = v_bench and o.log_id <> v_log_id
            and o.load_kg is not null and o.load_kg >= v_load_kg);
      end if;
    elsif v_item.exercise_id is not null and v_load_kg is not null and v_load_kg > 0 then
      -- Lifts: heaviest load for this exercise at this rep count (a "5-rep max").
      v_is_pr := not exists (
        select 1 from public.workout_log_entries o
        where o.user_id = v_uid and o.exercise_id = v_item.exercise_id and o.log_id <> v_log_id
          and o.reps is not distinct from v_reps
          and o.load_kg >= v_load_kg);
    end if;

    if v_is_pr then
      update public.workout_log_entries set is_pr = true where id = v_new_id;
      v_prs := v_prs || jsonb_build_object(
        'entry_id', v_new_id, 'title', coalesce(v_bench, v_item.title),
        'load_kg', v_load_kg, 'reps', v_reps, 'time_seconds', v_time);
    end if;
  end loop;

  return jsonb_build_object('log_id', v_log_id, 'prs', v_prs);
end $$;

-- ---------------------------------------------------------------------------------------------
-- TV / kiosk display. Authorised by the secret display token, so it works without a login.
-- ---------------------------------------------------------------------------------------------
create or replace function public.get_display(p_token text)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_gym public.gyms;
  v_state public.display_state;
  v_today date;
  v_workouts jsonb;
begin
  select g.* into v_gym
    from public.gym_secrets s join public.gyms g on g.id = s.gym_id
    where s.display_token = p_token;
  if not found then return null; end if;

  select * into v_state from public.display_state where gym_id = v_gym.id;
  v_today := public.gym_today(v_gym.id);

  select coalesce(jsonb_agg(wk.doc order by wk.position, wk.title), '[]'::jsonb) into v_workouts
  from (
    select
      coalesce(t.position, 0) as position,
      w.title,
      jsonb_build_object(
        'id', w.id,
        'title', w.title,
        'description', w.description,
        'coach_notes', case when v_state.show_coach_notes then w.coach_notes end,
        'track', t.name,
        'track_color', t.color,
        'items', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', i.id, 'section', i.section, 'title', i.title,
            'prescription', i.prescription, 'scaling', i.scaling, 'notes', i.notes
          ) order by i.position, i.created_at)
          from public.workout_items i where i.workout_id = w.id), '[]'::jsonb)
      ) as doc
    from public.workouts w
    left join public.tracks t on t.id = w.track_id
    where w.gym_id = v_gym.id
      and w.status = 'published'
      and w.publish_at <= now()
      and (
        (v_state.mode = 'manual' and w.id = v_state.workout_id)
        or (v_state.mode = 'auto'
            and w.scheduled_date = v_today
            and not w.is_template
            and (v_state.track_id is null or w.track_id = v_state.track_id))
      )
  ) wk;

  return jsonb_build_object(
    'gym', v_gym.name,
    'date', v_today,
    'mode', v_state.mode,
    'message', v_state.message,
    'workouts', case when v_state.mode = 'off' then '[]'::jsonb else v_workouts end,
    'updated_at', v_state.updated_at
  );
end $$;

-- ---------------------------------------------------------------------------------------------
-- Reporting (admins only)
-- ---------------------------------------------------------------------------------------------
-- Gross sales exclude tax. Net payout = charged − fees − refunds; tax is collected, not earned.
create or replace function public.report_revenue(p_gym uuid, p_from date, p_to date)
returns table (
  revenue_stream public.revenue_stream,
  kind public.payment_kind,
  payments bigint,
  gross_cents bigint,
  tax_cents bigint,
  fee_cents bigint,
  refunded_cents bigint,
  net_cents bigint
)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_tz text;
begin
  if not public.is_admin(p_gym) then raise exception 'forbidden' using errcode = '42501'; end if;
  select g.timezone into v_tz from public.gyms g where g.id = p_gym;

  return query
  select
    p.revenue_stream,
    p.kind,
    count(*)::bigint,
    sum(p.amount_cents - p.tax_cents)::bigint,
    sum(p.tax_cents)::bigint,
    sum(p.fee_cents)::bigint,
    sum(p.refunded_cents)::bigint,
    sum(p.amount_cents - p.fee_cents - p.refunded_cents)::bigint
  from public.payments p
  where p.gym_id = p_gym
    and p.status in ('succeeded', 'refunded', 'partially_refunded')
    and (p.paid_at at time zone v_tz)::date between p_from and p_to
  group by p.revenue_stream, p.kind
  order by p.revenue_stream, p.kind;
end $$;

create or replace function public.report_overview(p_gym uuid, p_from date, p_to date)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_tz text;
  v_start timestamptz;
  v_end timestamptz;
  v_active_start int;
  v_churned int;
begin
  if not public.is_admin(p_gym) then raise exception 'forbidden' using errcode = '42501'; end if;
  select g.timezone into v_tz from public.gyms g where g.id = p_gym;
  v_start := p_from::timestamp at time zone v_tz;
  v_end := (p_to + 1)::timestamp at time zone v_tz;

  -- Recurring members active when the period opened, and how many of them ended during it.
  select count(distinct m.user_id) into v_active_start
    from public.memberships m join public.membership_plans pl on pl.id = m.plan_id
    where m.gym_id = p_gym and pl.kind = 'recurring'
      and m.started_at < v_start and (m.ends_at is null or m.ends_at >= v_start);
  select count(distinct m.user_id) into v_churned
    from public.memberships m join public.membership_plans pl on pl.id = m.plan_id
    where m.gym_id = p_gym and pl.kind = 'recurring'
      and m.started_at < v_start and m.ends_at >= v_start and m.ends_at < v_end
      and m.status in ('cancelled', 'expired');

  return jsonb_build_object(
    'active_members', (
      select count(distinct m.user_id) from public.memberships m
      where m.gym_id = p_gym and m.status in ('active', 'past_due')
        and (m.ends_at is null or m.ends_at > now())),
    'past_due_members', (
      select count(distinct m.user_id) from public.memberships m
      where m.gym_id = p_gym and m.status = 'past_due'),
    'frozen_members', (
      select count(distinct m.user_id) from public.memberships m
      where m.gym_id = p_gym and m.status = 'frozen'),
    'new_memberships', (
      select count(*) from public.memberships m
      where m.gym_id = p_gym and m.started_at >= v_start and m.started_at < v_end),
    'cancelled_memberships', (
      select count(*) from public.memberships m
      where m.gym_id = p_gym and m.status in ('cancelled', 'expired')
        and m.ends_at >= v_start and m.ends_at < v_end),
    'recurring_at_period_start', v_active_start,
    'recurring_churned', v_churned,
    'churn_rate', case when v_active_start > 0 then round(v_churned::numeric / v_active_start, 4) end,
    'active_enrollments', (
      select count(*) from public.enrollments e
      where e.gym_id = p_gym and e.status = 'active' and e.expires_at >= public.gym_today(p_gym)),
    'new_enrollments', (
      select count(*) from public.enrollments e
      where e.gym_id = p_gym and e.created_at >= v_start and e.created_at < v_end),
    'classes_held', (
      select count(*) from public.class_sessions s
      where s.gym_id = p_gym and s.status = 'scheduled' and s.starts_at >= v_start and s.starts_at < v_end),
    'attendance', (
      select count(*) from public.bookings b join public.class_sessions s on s.id = b.session_id
      where b.gym_id = p_gym and b.status = 'attended' and s.starts_at >= v_start and s.starts_at < v_end),
    'no_shows', (
      select count(*) from public.bookings b join public.class_sessions s on s.id = b.session_id
      where b.gym_id = p_gym and b.status = 'no_show' and s.starts_at >= v_start and s.starts_at < v_end),
    'workouts_logged', (
      select count(*) from public.workout_logs l
      where l.gym_id = p_gym and l.performed_on between p_from and p_to),
    'failed_payments', (
      select count(*) from public.payments p
      where p.gym_id = p_gym and p.status = 'failed' and p.created_at >= v_start and p.created_at < v_end),
    'payouts_cents', (
      select coalesce(sum(po.amount_cents), 0) from public.payouts po
      where po.gym_id = p_gym and po.status = 'paid' and po.arrival_date between p_from and p_to)
  );
end $$;
