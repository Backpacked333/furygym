create or replace function private.membership_access_changed()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_session uuid;
  v_booking public.bookings;
begin
  if new.status is not distinct from old.status and new.ends_at is not distinct from old.ends_at then return new; end if;
  for v_session in
    select distinct s.id from public.class_sessions s join public.bookings b on b.session_id = s.id
    where b.membership_id = new.id and b.status = 'booked' and s.starts_at > now()
      and (new.status not in ('active', 'past_due', 'frozen') or (new.ends_at is not null and s.starts_at >= new.ends_at))
    order by s.id
  loop
    perform 1 from public.class_sessions where id = v_session for update;
    select * into v_booking from public.bookings
      where session_id = v_session and membership_id = new.id and status = 'booked' for update;
    if not found then continue; end if;
    if v_booking.credit_used then
      update public.memberships set credits_remaining = credits_remaining + 1 where id = new.id;
    end if;
    update public.bookings set status = 'cancelled', cancelled_at = now(), credit_used = false
      where id = v_booking.id;
    perform private.promote_waitlist(v_session);
  end loop;

  -- A waitlist place carries no membership, so it is checked by what still covers the class. A
  -- freeze releases its own window in freeze_membership.
  if new.status not in ('active', 'past_due', 'frozen') or new.ends_at is not null then
    for v_session in
      select s.id from public.class_sessions s join public.bookings b on b.session_id = s.id
      where b.user_id = new.user_id and b.gym_id = new.gym_id and b.status = 'waitlisted' and s.starts_at > now()
      order by s.id
    loop
      perform 1 from public.class_sessions where id = v_session for update;
      update public.bookings b set status = 'cancelled', cancelled_at = now()
        from public.class_sessions s
        where s.id = v_session and b.session_id = s.id and b.user_id = new.user_id and b.status = 'waitlisted'
          and private.find_entitlement(new.user_id, s.gym_id, s.starts_at) is null;
    end loop;
  end if;
  return new;
end $$;

create trigger membership_access_changed after update of status, ends_at on public.memberships
  for each row execute function private.membership_access_changed();
revoke execute on function private.membership_access_changed() from public, anon, authenticated;
grant execute on function private.membership_access_changed() to service_role;

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
  if p_status in ('attended', 'booked') and v_booking.status <> 'attended' and v_booking.membership_id is not null and not exists (
    select 1 from public.memberships m join public.gyms g on g.id = m.gym_id
    where m.id = v_booking.membership_id and m.user_id = v_booking.user_id and m.gym_id = v_booking.gym_id
      and (m.status in ('active', 'past_due') or (m.status = 'frozen' and m.frozen_until <= (v_session.starts_at at time zone g.timezone)::date))
      and (m.ends_at is null or m.ends_at > v_session.starts_at)
  ) then raise exception 'no_entitlement'; end if;
  v_freed := v_booking.status in ('booked', 'attended') and p_status = 'no_show';
  update public.bookings
    set status = p_status,
        checked_in_at = case when p_status = 'attended' then coalesce(checked_in_at, now()) end,
        checked_in_by = case when p_status = 'attended' then auth.uid() end
    where id = p_booking returning * into v_booking;
  if v_freed then perform private.promote_waitlist(v_session.id); end if;
  return v_booking;
end $$;
