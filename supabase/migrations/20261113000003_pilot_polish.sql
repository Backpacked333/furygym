-- Pilot polish: tell athletes when the gym cancels their class, show staff who has gone quiet and
-- who has earned a reward, and hold the gym's privacy, terms and support text.

-- ---------------------------------------------------------------------------------------------
-- A booking released because the gym cancelled the class, not because the athlete did
-- ---------------------------------------------------------------------------------------------
alter table public.bookings add column class_cancelled boolean not null default false;

create or replace function private.class_session_changed()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_booking public.bookings;
begin
  if new.status = 'cancelled' and old.status <> 'cancelled' then
    for v_booking in select * from public.bookings
      where session_id = new.id and status in ('booked', 'waitlisted') order by id for update
    loop
      if v_booking.credit_used and v_booking.membership_id is not null then
        update public.memberships set credits_remaining = credits_remaining + 1
          where id = v_booking.membership_id and credits_remaining is not null;
      end if;
      update public.bookings
        set status = 'cancelled', cancelled_at = now(), credit_used = false, late_cancel = false, class_cancelled = true
        where id = v_booking.id;
    end loop;
  elsif new.status = 'scheduled' then
    if new.capacity < (select count(*) from public.bookings where session_id = new.id and status in ('booked', 'attended')) then
      raise exception 'capacity_below_bookings';
    end if;
    if new.capacity > old.capacity or old.status <> 'scheduled' then perform private.promote_waitlist(new.id); end if;
  end if;
  return null;
end $$;

-- my_class_cancelled: this athlete held a place or a waitlist spot when the gym cancelled the class.
create or replace view public.class_session_overview as
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
    case when mine.status = 'waitlisted' then
      (select count(*) + 1 from public.bookings b
        where b.session_id = s.id and b.status = 'waitlisted' and b.booked_at < mine.booked_at)::int
    end as my_waitlist_position,
    (select count(*) from public.bookings b
      where b.session_id = s.id and b.status = 'attended')::int as checked_in_count,
    (s.status = 'cancelled' and exists (select 1 from public.bookings b
      where b.session_id = s.id and b.user_id = (select auth.uid()) and b.class_cancelled)) as my_class_cancelled
  from public.class_sessions s
  left join public.tracks t on t.id = s.track_id
  left join public.profiles c on c.id = s.coach_id
  left join public.bookings mine
    on mine.session_id = s.id and mine.user_id = (select auth.uid()) and mine.status <> 'cancelled'
  where public.is_member(s.gym_id);

-- ---------------------------------------------------------------------------------------------
-- Members with an active membership who have not checked in for a while
-- ---------------------------------------------------------------------------------------------
create function public.quiet_members(p_gym uuid, p_days int default 14)
returns table (user_id uuid, full_name text, email text, last_visit timestamptz)
language sql stable security definer set search_path = '' as $$
  select p.id, p.full_name, p.email, seen.last_visit
  from public.profiles p
  join lateral (
    select min(m.started_at) as since from public.memberships m
    where m.user_id = p.id and m.gym_id = p_gym and m.status = 'active'
  ) member on member.since < now() - make_interval(days => p_days)
  left join lateral (
    select max(coalesce(b.checked_in_at, s.starts_at)) as last_visit
    from public.bookings b join public.class_sessions s on s.id = b.session_id
    where b.user_id = p.id and b.gym_id = p_gym and b.status = 'attended'
  ) seen on true
  where public.is_staff(p_gym)
    and (seen.last_visit is null or seen.last_visit < now() - make_interval(days => p_days))
  order by seen.last_visit nulls first, p.full_name
  limit 50;
$$;
revoke all on function public.quiet_members(uuid, int) from public, anon;
grant execute on function public.quiet_members(uuid, int) to authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- Attendance rewards: who has reached the milestone, and which rewards were handed over
-- ---------------------------------------------------------------------------------------------
create table public.milestone_rewards (
  id uuid primary key default gen_random_uuid(),
  gym_id uuid not null references public.gyms (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  visits int not null check (visits > 0),
  reward text,
  given_at timestamptz not null default now(),
  given_by uuid references public.profiles (id) on delete set null,
  unique (gym_id, user_id, visits)
);
alter table public.milestone_rewards enable row level security;
create policy milestone_rewards_read on public.milestone_rewards for select to authenticated
  using (user_id = (select auth.uid()) or public.is_staff(gym_id));
create policy milestone_rewards_staff_insert on public.milestone_rewards for insert to authenticated
  with check (public.is_staff(gym_id) and given_by = (select auth.uid()));
grant select, insert on public.milestone_rewards to authenticated;
grant all on public.milestone_rewards to service_role;

-- The latest milestone each athlete has reached and not been given a reward for.
create function public.milestones_due(p_gym uuid)
returns table (user_id uuid, full_name text, email text, visits int, milestone int)
language sql stable security definer set search_path = '' as $$
  with gym as (
    select g.milestone_visits as every from public.gyms g where g.id = p_gym and public.is_staff(p_gym)
  ), seen as (
    select b.user_id, count(*)::int as visits from public.bookings b
    where b.gym_id = p_gym and b.status = 'attended' group by b.user_id
  )
  select p.id, p.full_name, p.email, seen.visits, (seen.visits / gym.every) * gym.every
  from seen cross join gym join public.profiles p on p.id = seen.user_id
  where seen.visits >= gym.every
    and not exists (
      select 1 from public.milestone_rewards r
      where r.gym_id = p_gym and r.user_id = seen.user_id and r.visits >= (seen.visits / gym.every) * gym.every)
  order by seen.visits desc, p.full_name
  limit 50;
$$;
revoke all on function public.milestones_due(uuid) from public, anon;
grant execute on function public.milestones_due(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- Privacy policy, terms and support contact, shown on the public website and linked from the app
-- ---------------------------------------------------------------------------------------------
create table public.gym_legal (
  gym_id uuid primary key references public.gyms (id) on delete cascade,
  support_email text,
  privacy_policy text,
  terms text,
  updated_at timestamptz not null default now()
);
create trigger gym_legal_updated before update on public.gym_legal
  for each row execute function private.set_updated_at();
alter table public.gym_legal enable row level security;
create policy gym_legal_read on public.gym_legal for select to anon, authenticated using (true);
create policy gym_legal_admin_insert on public.gym_legal for insert to authenticated
  with check (public.is_admin(gym_id));
create policy gym_legal_admin_update on public.gym_legal for update to authenticated
  using (public.is_admin(gym_id)) with check (public.is_admin(gym_id));
grant select on public.gym_legal to anon, authenticated;
grant insert, update on public.gym_legal to authenticated;
grant all on public.gym_legal to service_role;
