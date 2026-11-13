-- Gym display reliability.
--
-- 1. The class card follows real class times instead of a fixed half hour after the start.
-- 2. The payload carries the server's time so a screen with a wrong clock still counts down correctly.
-- 3. Screens report in, so the staff console can say whether one is actually connected.

alter table public.gym_secrets
  -- When a screen last loaded the display link. Null until one has, and again after the link is replaced.
  add column display_seen_at timestamptz;

-- Called by the display page on every refresh. The token is the only credential, as for get_display.
create or replace function public.display_ping(p_token text)
returns void
language sql volatile security definer set search_path = '' as $$
  update public.gym_secrets
    set display_seen_at = now()
    where display_token = p_token
      -- several screens share one link; one write every few seconds is enough
      and (display_seen_at is null or display_seen_at < now() - interval '10 seconds');
$$;

grant execute on function public.display_ping(text) to anon, authenticated, service_role;

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

  -- The class on the floor stays up until it ends. From fifteen minutes before the next class starts
  -- that one takes over, so arriving athletes see their own countdown and check-ins, and it keeps
  -- the card once it starts even if the earlier class is still running. Otherwise the next class
  -- starting within three hours.
  select jsonb_build_object(
      'id', s.id,
      'title', s.title,
      'starts_at', s.starts_at,
      'ends_at', s.ends_at,
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
    and s.ends_at > now()
    and s.starts_at <= now() + interval '3 hours'
    and (v_state.track_id is null or s.track_id = v_state.track_id)
  order by
    -- of the classes on the floor or about to start, the one that started last; else the soonest
    (s.starts_at <= now() + interval '15 minutes') desc,
    case when s.starts_at <= now() + interval '15 minutes' then s.starts_at end desc,
    s.starts_at, s.title, s.id
  limit 1;

  return jsonb_build_object(
    'gym', v_gym.name,
    'date', v_today,
    'timezone', v_gym.timezone,
    'mode', v_state.mode,
    'message', v_state.message,
    'workouts', case when v_state.mode = 'off' then '[]'::jsonb else v_workouts end,
    'next_class', case when v_state.mode = 'off' then null else v_class end,
    'updated_at', v_state.updated_at,
    -- Screens count down against this, not their own clock, which is often wrong on TV hardware.
    'server_time', now()
  );
end $$;
