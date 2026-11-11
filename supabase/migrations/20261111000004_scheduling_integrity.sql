create or replace function private.schedule_instant(p_local timestamp, p_zone text)
returns timestamptz language plpgsql stable set search_path = '' as $$
declare
  v_count int;
  v_instant timestamptz;
begin
  select count(distinct candidate), min(candidate) into v_count, v_instant
  from (
    select (p_local at time zone 'UTC') -
      (((p_local at time zone 'UTC') + n * interval '1 hour') at time zone p_zone
        - (((p_local at time zone 'UTC') + n * interval '1 hour') at time zone 'UTC')) as candidate
    from generate_series(-36, 36, 36) n
  ) choices where candidate at time zone p_zone = p_local;
  if v_count = 0 then raise exception 'nonexistent_local_time'; end if;
  if v_count > 1 then raise exception 'ambiguous_local_time'; end if;
  return v_instant;
end $$;

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
    private.schedule_instant((p_from + n) + s.start_time, g.timezone),
    private.schedule_instant((p_from + n) + s.start_time, g.timezone) + make_interval(mins => s.duration_minutes),
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


revoke execute on function private.schedule_instant(timestamp, text) from public, anon, authenticated;
grant execute on function private.schedule_instant(timestamp, text) to service_role;
