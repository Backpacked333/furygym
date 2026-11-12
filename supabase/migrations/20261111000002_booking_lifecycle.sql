create or replace function private.has_facility_access(p_user uuid, p_gym uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.memberships m
    where m.user_id = p_user
      and m.gym_id = p_gym
      and exists (select 1 from public.gym_members gm where gm.gym_id = p_gym and gm.user_id = p_user and gm.status = 'active')
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
    and exists (select 1 from public.gym_members gm where gm.gym_id = p_gym and gm.user_id = p_user and gm.status = 'active')
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
          public.is_member(w.gym_id)
          and w.status = 'published'
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
      public.is_member(e.gym_id)
      and w.status = 'published'
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

create or replace function private.promote_waitlist(p_session uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_session public.class_sessions;
  v_taken int;
  v_wait record;
  v_membership uuid;
  v_uses_credit boolean;
begin
  select * into v_session from public.class_sessions where id = p_session for update;
  if not found then return; end if;
  if v_session.status <> 'scheduled' or v_session.starts_at <= now() then return; end if;

  for v_wait in
    select b.id, b.user_id from public.bookings b
    where b.session_id = p_session and b.status = 'waitlisted'
    order by b.booked_at, b.id
  loop
    select count(*) into v_taken from public.bookings
      where session_id = p_session and status in ('booked', 'attended');
    exit when v_taken >= v_session.capacity;

    continue when private.missing_required_waiver(v_wait.user_id, v_session.gym_id);
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

  perform private.promote_waitlist(p_session);
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

create or replace function public.check_in(p_booking uuid, p_status public.booking_status default 'attended')
returns public.bookings
language plpgsql security definer set search_path = '' as $$
declare
  v_booking public.bookings;
  v_session public.class_sessions;
  v_freed boolean;
begin
  select * into v_booking from public.bookings where id = p_booking;
  if not found then raise exception 'booking_not_found'; end if;
  if not public.is_staff(v_booking.gym_id) then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into v_session from public.class_sessions where id = v_booking.session_id for update;
  select * into v_booking from public.bookings where id = p_booking for update;
  if not found then raise exception 'booking_not_found'; end if;
  if v_session.status <> 'scheduled' then raise exception 'session_cancelled'; end if;
  if not exists (select 1 from public.gym_members where gym_id = v_booking.gym_id and user_id = v_booking.user_id and status = 'active') then
    raise exception 'not_a_member';
  end if;
  if p_status not in ('attended', 'no_show', 'booked') then raise exception 'invalid_status'; end if;
  if v_booking.status not in ('booked', 'attended', 'no_show') then raise exception 'not_booked'; end if;
  if v_booking.status = 'no_show' and p_status in ('booked', 'attended') and
    (select count(*) from public.bookings where session_id = v_session.id and status in ('booked', 'attended')) >= v_session.capacity then
    raise exception 'class_full';
  end if;
  v_freed := v_booking.status in ('booked', 'attended') and p_status = 'no_show';
  update public.bookings
    set status = p_status,
        checked_in_at = case when p_status = 'attended' then coalesce(checked_in_at, now()) end,
        checked_in_by = case when p_status = 'attended' then auth.uid() end
    where id = p_booking returning * into v_booking;
  if v_freed then perform private.promote_waitlist(v_session.id); end if;
  return v_booking;
end $$;

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

  if not exists (select 1 from public.gym_members where gym_id = v_gym and user_id = v_user and status = 'active') then
    return jsonb_build_object('result', 'inactive_member');
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

  select * into v_session from public.class_sessions where id = v_booking.session_id for update;
  select * into v_booking from public.bookings where id = v_booking.id;
  if v_session.status <> 'scheduled' or v_booking.status not in ('booked', 'attended') then
    return jsonb_build_object('result', 'no_booking', 'athlete', v_name, 'user_id', v_user);
  end if;
  if v_booking.status = 'attended' then
    return jsonb_build_object('result', 'already_checked_in', 'athlete', v_name,
      'class', v_session.title, 'starts_at', v_session.starts_at, 'session_id', v_session.id);
  end if;

  perform public.check_in(v_booking.id, 'attended');
  return jsonb_build_object('result', 'checked_in', 'athlete', v_name,
    'class', v_session.title, 'starts_at', v_session.starts_at, 'session_id', v_session.id);
end $$;

create or replace function public.freeze_membership(p_user uuid, p_membership uuid, p_until date)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_membership public.memberships;
  v_gym public.gyms;
  v_today date;
  v_booking public.bookings;
  v_session_id uuid;
  v_booking_id uuid;
  v_released int := 0;
begin
  select * into v_membership from public.memberships where id = p_membership and user_id = p_user for update;
  if not found then raise exception 'membership_not_found'; end if;
  if v_membership.status not in ('active', 'past_due') then raise exception 'membership_not_active'; end if;

  select * into v_gym from public.gyms where id = v_membership.gym_id;
  v_today := public.gym_today(v_gym.id);
  if p_until is null or p_until < v_today + 7 or p_until > v_today + 92 then raise exception 'invalid_freeze_length'; end if;

  update public.memberships set status = 'frozen', frozen_until = p_until where id = p_membership;

  for v_booking_id, v_session_id in
    select b.id, b.session_id
    from public.bookings b
    join public.class_sessions s on s.id = b.session_id
    where b.user_id = p_user and b.status in ('booked', 'waitlisted')
      and s.starts_at > now()
      and (s.starts_at at time zone v_gym.timezone)::date < p_until
    order by s.id
  loop
    perform 1 from public.class_sessions where id = v_session_id for update;
    select * into v_booking from public.bookings where id = v_booking_id for update;
    continue when not found or v_booking.status not in ('booked', 'waitlisted');
    -- A seat paid for by another plan stays; so does a waitlist place another plan still covers.
    continue when v_booking.status = 'booked' and v_booking.membership_id is distinct from p_membership;
    continue when v_booking.status = 'waitlisted' and exists (
      select 1 from public.class_sessions s
      where s.id = v_session_id and private.find_entitlement(p_user, s.gym_id, s.starts_at) is not null);
    if v_booking.credit_used and v_booking.membership_id is not null then
      update public.memberships set credits_remaining = credits_remaining + 1
        where id = v_booking.membership_id and credits_remaining is not null;
    end if;
    update public.bookings set status = 'cancelled', cancelled_at = now(), credit_used = false where id = v_booking.id;
    if v_booking.status = 'booked' then perform private.promote_waitlist(v_booking.session_id); end if;
    v_released := v_released + 1;
  end loop;

  return jsonb_build_object('frozen_until', p_until, 'released_bookings', v_released);
end $$;

-- A direct staff table update must have the same lifecycle semantics as any UI action.
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
      update public.bookings set status = 'cancelled', cancelled_at = now(), credit_used = false, late_cancel = false
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
create trigger class_session_lifecycle after update of status, capacity on public.class_sessions
  for each row execute function private.class_session_changed();

-- Cascading account deletion must release the place just like cancellation.
create or replace function private.deleted_booking()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.status in ('booked', 'attended') then perform private.promote_waitlist(old.session_id); end if;
  return null;
end $$;
create trigger booking_deleted after delete on public.bookings
  for each row execute function private.deleted_booking();

create or replace function private.inactive_member()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_booking public.bookings;
  v_id uuid;
  v_session uuid;
begin
  if old.status = 'active' and new.status <> 'active' then
    for v_id, v_session in
      select b.id, b.session_id from public.bookings b join public.class_sessions s on s.id = b.session_id
      where b.gym_id = new.gym_id and b.user_id = new.user_id and b.status in ('booked', 'waitlisted')
        and s.starts_at > now()
      order by s.id
    loop
      perform 1 from public.class_sessions where id = v_session for update;
      select * into v_booking from public.bookings where id = v_id for update;
      continue when not found or v_booking.status not in ('booked', 'waitlisted');
      if v_booking.credit_used and v_booking.membership_id is not null then
        update public.memberships set credits_remaining = credits_remaining + 1
          where id = v_booking.membership_id and credits_remaining is not null;
      end if;
      update public.bookings set status = 'cancelled', cancelled_at = now(), credit_used = false, late_cancel = false where id = v_id;
      perform private.promote_waitlist(v_session);
    end loop;
  end if;
  return null;
end $$;
create trigger member_access_revoked after update of status on public.gym_members
  for each row execute function private.inactive_member();

revoke execute on function private.class_session_changed(), private.deleted_booking(), private.inactive_member() from public, anon, authenticated;
grant execute on function private.class_session_changed(), private.deleted_booking(), private.inactive_member() to service_role;
