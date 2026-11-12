-- Backend support for the redesigned apps: QR check-in, self-serve membership freeze,
-- attendance milestones, a richer gym display, and the design system's track colours.

-- ---------------------------------------------------------------------------------------------
-- Track colours from the design system (Strength red, Engine orange, Selection indigo)
-- ---------------------------------------------------------------------------------------------
update public.tracks set color = '#FF4245' where slug = 'strength';
update public.tracks set color = '#FF9230' where slug = 'engine';
update public.tracks set color = '#6D7CFF' where slug = 'selection';
alter table public.tracks alter column color set default '#8E8E93';

-- ---------------------------------------------------------------------------------------------
-- Gym settings: attendance milestone shown on the check-in screen
-- ---------------------------------------------------------------------------------------------
alter table public.gyms
  add column milestone_visits int not null default 20 check (milestone_visits between 1 and 1000),
  -- e.g. "a free Fury Co. tee". Null shows the count without promising a reward.
  add column milestone_reward text;

alter table public.display_state
  -- First name and last initial of checked-in athletes on the gym screen. Off until staff opt in.
  add column show_checked_in boolean not null default false;

-- ---------------------------------------------------------------------------------------------
-- QR check-in
-- The app shows a code that changes every 30 seconds: HMAC-SHA256(secret, floor(epoch / 30)).
-- Staff scan it at the front desk; a screenshot of an old code is useless a minute later.
-- ---------------------------------------------------------------------------------------------
create table public.checkin_secrets (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  secret text not null default encode(extensions.gen_random_bytes(20), 'hex'),
  created_at timestamptz not null default now()
);
alter table public.checkin_secrets enable row level security;
create policy checkin_secrets_read_own on public.checkin_secrets for select to authenticated
  using (user_id = (select auth.uid()));

-- Returns the caller's check-in secret, creating it on first use.
create or replace function public.my_checkin_secret()
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_secret text;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  insert into public.checkin_secrets (user_id) values (v_uid) on conflict (user_id) do nothing;
  select secret into v_secret from public.checkin_secrets where user_id = v_uid;
  return v_secret;
end $$;

create or replace function private.checkin_code(p_secret text, p_counter bigint)
returns text language sql immutable set search_path = '' as $$
  select substr(encode(extensions.hmac(p_counter::text, p_secret, 'sha256'), 'hex'), 1, 10);
$$;

-- Staff scan "FC1:<user id>:<code>". Checks the athlete in to the class they are booked into
-- that starts within the hour (or began up to 30 minutes ago).
create or replace function public.check_in_with_code(p_payload text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_parts text[] := string_to_array(btrim(coalesce(p_payload, '')), ':');
  v_user uuid;
  v_secret text;
  v_counter bigint := floor(extract(epoch from now()) / 30);
  v_gym uuid := public.default_gym_id();
  v_name text;
  v_booking public.bookings;
  v_session public.class_sessions;
begin
  if not public.is_staff(v_gym) then raise exception 'forbidden' using errcode = '42501'; end if;
  if array_length(v_parts, 1) is distinct from 3 or v_parts[1] <> 'FC1' then
    return jsonb_build_object('result', 'invalid_code');
  end if;
  begin
    v_user := v_parts[2]::uuid;
  exception when others then
    return jsonb_build_object('result', 'invalid_code');
  end;

  select secret into v_secret from public.checkin_secrets where user_id = v_user;
  -- Accept the current 30-second window and its neighbours, to allow for clock drift.
  if v_secret is null or v_parts[3] not in (
    private.checkin_code(v_secret, v_counter - 2), private.checkin_code(v_secret, v_counter - 1),
    private.checkin_code(v_secret, v_counter), private.checkin_code(v_secret, v_counter + 1)
  ) then
    return jsonb_build_object('result', 'expired_code');
  end if;

  select full_name into v_name from public.profiles where id = v_user;

  select b.* into v_booking
    from public.bookings b
    join public.class_sessions s on s.id = b.session_id
    where b.user_id = v_user and b.gym_id = v_gym
      and b.status in ('booked', 'attended')
      and s.status = 'scheduled'
      and s.starts_at between now() - interval '30 minutes' and now() + interval '60 minutes'
    order by abs(extract(epoch from (s.starts_at - now())))
    limit 1;
  if not found then
    return jsonb_build_object('result', 'no_booking', 'athlete', v_name, 'user_id', v_user);
  end if;

  select * into v_session from public.class_sessions where id = v_booking.session_id;
  if v_booking.status = 'attended' then
    return jsonb_build_object('result', 'already_checked_in', 'athlete', v_name,
      'class', v_session.title, 'starts_at', v_session.starts_at, 'session_id', v_session.id);
  end if;

  update public.bookings
    set status = 'attended', checked_in_at = now(), checked_in_by = auth.uid()
    where id = v_booking.id;
  return jsonb_build_object('result', 'checked_in', 'athlete', v_name,
    'class', v_session.title, 'starts_at', v_session.starts_at, 'session_id', v_session.id);
end $$;

-- ---------------------------------------------------------------------------------------------
-- Membership freeze
-- A frozen membership whose resume date has arrived counts as active again, so a freeze ends on
-- its own even for memberships that are not billed through Stripe.
-- ---------------------------------------------------------------------------------------------
create or replace function private.has_facility_access(p_user uuid, p_gym uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.memberships m
    where m.user_id = p_user
      and m.gym_id = p_gym
      and (m.status in ('active', 'past_due')
           or (m.status = 'frozen' and m.frozen_until is not null and m.frozen_until <= public.gym_today(p_gym)))
      and (m.ends_at is null or m.ends_at > now())
  );
$$;

create or replace function private.find_entitlement(p_user uuid, p_gym uuid, p_at timestamptz)
returns uuid language sql security definer set search_path = '' as $$
  select m.id
  from public.memberships m
  join public.gyms g on g.id = m.gym_id
  where m.user_id = p_user
    and m.gym_id = p_gym
    and (m.status in ('active', 'past_due')
         -- a class after the freeze ends can be booked while still frozen
         or (m.status = 'frozen' and m.frozen_until is not null
             and m.frozen_until <= (p_at at time zone g.timezone)::date))
    and (m.ends_at is null or m.ends_at > p_at)
    and (m.credits_remaining is null or m.credits_remaining > 0)
  order by (m.credits_remaining is null) desc, m.ends_at asc nulls last, m.created_at
  limit 1
  for update of m;
$$;

-- Freezes a membership and releases the athlete's reservations inside the freeze window.
-- Called by the web app's membership route after it has paused billing in Stripe; not callable
-- by clients directly, so a freeze can never get out of step with billing.
create or replace function public.freeze_membership(p_user uuid, p_membership uuid, p_until date)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_membership public.memberships;
  v_gym public.gyms;
  v_today date;
  v_booking record;
  v_released int := 0;
begin
  select * into v_membership from public.memberships where id = p_membership and user_id = p_user for update;
  if not found then raise exception 'membership_not_found'; end if;
  if v_membership.status not in ('active', 'past_due') then raise exception 'membership_not_active'; end if;

  select * into v_gym from public.gyms where id = v_membership.gym_id;
  v_today := public.gym_today(v_gym.id);
  if p_until < v_today + 7 or p_until > v_today + 92 then raise exception 'invalid_freeze_length'; end if;

  update public.memberships set status = 'frozen', frozen_until = p_until where id = p_membership;

  for v_booking in
    select b.id, b.session_id, b.status, b.credit_used, b.membership_id
    from public.bookings b
    join public.class_sessions s on s.id = b.session_id
    where b.user_id = p_user and b.status in ('booked', 'waitlisted')
      and s.starts_at > now()
      and (s.starts_at at time zone v_gym.timezone)::date < p_until
    order by s.starts_at
  loop
    perform 1 from public.class_sessions where id = v_booking.session_id for update;
    if v_booking.credit_used and v_booking.membership_id is not null then
      update public.memberships set credits_remaining = credits_remaining + 1
        where id = v_booking.membership_id and credits_remaining is not null;
    end if;
    update public.bookings set status = 'cancelled', cancelled_at = now() where id = v_booking.id;
    if v_booking.status = 'booked' then perform private.promote_waitlist(v_booking.session_id); end if;
    v_released := v_released + 1;
  end loop;

  return jsonb_build_object('frozen_until', p_until, 'released_bookings', v_released);
end $$;

-- ---------------------------------------------------------------------------------------------
-- Athlete training summary for the Progress and check-in screens
-- ---------------------------------------------------------------------------------------------
create or replace function public.my_attendance()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'visits', (select count(*) from public.bookings b
                where b.user_id = (select auth.uid()) and b.status = 'attended'),
    'visits_this_month', (
      select count(*) from public.bookings b
      join public.class_sessions s on s.id = b.session_id
      join public.gyms g on g.id = b.gym_id
      where b.user_id = (select auth.uid()) and b.status = 'attended'
        and date_trunc('month', s.starts_at at time zone g.timezone)
            = date_trunc('month', now() at time zone g.timezone))
  );
$$;

-- ---------------------------------------------------------------------------------------------
-- Gym display: adds the current or next class, its countdown, and (if staff allow) who is in.
-- ---------------------------------------------------------------------------------------------
create or replace function public.get_display(p_token text)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_gym public.gyms;
  v_state public.display_state;
  v_today date;
  v_workouts jsonb;
  v_class jsonb;
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

  -- The class in progress (first half hour) or the next one starting within three hours.
  select jsonb_build_object(
      'id', s.id,
      'title', s.title,
      'starts_at', s.starts_at,
      'track', t.name,
      'track_color', t.color,
      'coach', c.full_name,
      'capacity', s.capacity,
      'booked', (select count(*) from public.bookings b where b.session_id = s.id and b.status in ('booked', 'attended')),
      'checked_in', (select count(*) from public.bookings b where b.session_id = s.id and b.status = 'attended'),
      'checked_in_names', case when v_state.show_checked_in then coalesce((
          select jsonb_agg(
            split_part(p.full_name, ' ', 1)
              || case when position(' ' in btrim(p.full_name)) > 0
                      then ' ' || left(split_part(btrim(p.full_name), ' ', -1), 1) || '.' else '' end
            order by b.checked_in_at)
          from public.bookings b join public.profiles p on p.id = b.user_id
          where b.session_id = s.id and b.status = 'attended'), '[]'::jsonb)
        else '[]'::jsonb end
    ) into v_class
  from public.class_sessions s
  left join public.tracks t on t.id = s.track_id
  left join public.profiles c on c.id = s.coach_id
  where s.gym_id = v_gym.id and s.status = 'scheduled'
    and s.starts_at between now() - interval '30 minutes' and now() + interval '3 hours'
    and (v_state.track_id is null or s.track_id = v_state.track_id)
  order by s.starts_at
  limit 1;

  return jsonb_build_object(
    'gym', v_gym.name,
    'date', v_today,
    'timezone', v_gym.timezone,
    'mode', v_state.mode,
    'message', v_state.message,
    'workouts', case when v_state.mode = 'off' then '[]'::jsonb else v_workouts end,
    'next_class', case when v_state.mode = 'off' then null else v_class end,
    'updated_at', v_state.updated_at
  );
end $$;

-- The class overview also carries the track id, so the app can show the day's workout for a class.
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
      where b.session_id = s.id and b.status = 'attended')::int as checked_in_count
  from public.class_sessions s
  left join public.tracks t on t.id = s.track_id
  left join public.profiles c on c.id = s.coach_id
  left join public.bookings mine
    on mine.session_id = s.id and mine.user_id = (select auth.uid()) and mine.status <> 'cancelled'
  where public.is_member(s.gym_id);

-- ---------------------------------------------------------------------------------------------
-- Grants for the new objects (later migrations opt in explicitly; see the policies migration)
-- ---------------------------------------------------------------------------------------------
grant all on public.checkin_secrets to service_role;
grant select on public.checkin_secrets to authenticated;
grant select on public.class_session_overview to authenticated;
grant all on public.class_session_overview to service_role;

revoke execute on all functions in schema public from public, anon;
grant execute on function public.my_checkin_secret() to authenticated, service_role;
grant execute on function public.check_in_with_code(text) to authenticated, service_role;
grant execute on function public.my_attendance() to authenticated, service_role;
grant execute on function public.get_display(text) to anon, authenticated, service_role;
-- Only the server may freeze, after billing has been paused.
revoke execute on function public.freeze_membership(uuid, uuid, date) from authenticated;
grant execute on function public.freeze_membership(uuid, uuid, date) to service_role;
grant execute on all functions in schema private to service_role;
