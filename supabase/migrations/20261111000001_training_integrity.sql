-- Keep logged workouts as history; account deletion still cascades through the athlete's logs.
alter table public.workout_logs drop constraint workout_logs_workout_id_fkey;
alter table public.workout_logs add constraint workout_logs_workout_id_fkey
  foreign key (workout_id) references public.workouts (id) on delete restrict;

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

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_uid::text, 0));
  select * into v_workout from public.workouts where id = p_workout for key share;
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
    if not public.is_member(v_workout.gym_id) then raise exception 'not_a_member'; end if;
    if p_enrollment is not null then
      perform 1 from public.enrollments e
      join public.program_workouts pw on pw.program_id = e.program_id
      join public.programs p on p.id = e.program_id
      where e.id = p_enrollment and e.user_id = v_uid and pw.workout_id = p_workout
        and e.gym_id = v_workout.gym_id and e.status = 'active'
        and public.gym_today(v_workout.gym_id) <= e.expires_at
        and (p.unlock_mode = 'all'
          or (p.unlock_mode = 'weekly' and public.gym_today(v_workout.gym_id) >= e.start_date + (pw.week - 1) * 7)
          or (p.unlock_mode = 'daily' and public.gym_today(v_workout.gym_id) >= e.start_date + (pw.week - 1) * 7 + pw.day - 1))
      for share of e;
      if not found then raise exception 'workout_locked'; end if;
    elsif not public.is_staff(v_workout.gym_id) and
      (v_workout.scheduled_date is null or not private.has_facility_access(v_uid, v_workout.gym_id)) then
      raise exception 'workout_locked';
    end if;
    insert into public.workout_logs
      (gym_id, user_id, workout_id, enrollment_id, performed_on, notes, rpe, duration_seconds)
    values (v_workout.gym_id, v_uid, p_workout, p_enrollment, p_performed_on, p_notes, p_rpe, p_duration_seconds)
    returning id into v_log_id;
  else
    update public.workout_logs
      set performed_on = p_performed_on, notes = p_notes, rpe = p_rpe, duration_seconds = p_duration_seconds
      where id = v_log_id;
    -- Results for a block the coach has since removed (item reference cleared) are history the
    -- athlete can no longer resubmit, so only the current blocks' entries are replaced.
    delete from public.workout_log_entries where log_id = v_log_id and workout_item_id is not null;
    update public.workout_log_entries set performed_on = p_performed_on
      where log_id = v_log_id and workout_item_id is null;
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
          where o.user_id = v_uid and o.benchmark_name = v_bench and o.id <> v_new_id
            and o.time_seconds is not null and o.time_seconds <= v_time);
      elsif v_reps is not null then
        v_is_pr := not exists (
          select 1 from public.workout_log_entries o
          where o.user_id = v_uid and o.benchmark_name = v_bench and o.id <> v_new_id
            and o.reps is not null and o.reps >= v_reps);
      elsif v_load_kg is not null then
        v_is_pr := not exists (
          select 1 from public.workout_log_entries o
          where o.user_id = v_uid and o.benchmark_name = v_bench and o.id <> v_new_id
            and o.load_kg is not null and o.load_kg >= v_load_kg);
      end if;
    elsif v_item.exercise_id is not null and v_load_kg is not null and v_load_kg > 0 then
      -- Lifts: heaviest load for this exercise at this rep count (a "5-rep max").
      v_is_pr := not exists (
        select 1 from public.workout_log_entries o
        where o.user_id = v_uid and o.exercise_id = v_item.exercise_id and o.id <> v_new_id
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
