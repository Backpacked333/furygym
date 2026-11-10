-- Demo data for LOCAL development only (`supabase db reset`). Never run against production:
-- it creates accounts with a published password.
--
--   owner@furyco.test    Owner      password: FuryDemo123!
--   coach@furyco.test    Coach
--   alex@furyco.test     Athlete — unlimited membership, waiver signed, enrolled in Selection Prep
--   sam@furyco.test      Athlete — 10-class pack
--   jordan@furyco.test   Athlete — new signup, no membership or waiver yet

do $$
declare
  v_gym uuid := (select id from public.gyms where is_default);
  v_strength uuid := (select id from public.tracks where slug = 'strength');
  v_engine uuid := (select id from public.tracks where slug = 'engine');
  v_selection uuid := (select id from public.tracks where slug = 'selection');
  v_owner uuid := '00000000-0000-4000-a000-000000000001';
  v_coach uuid := '00000000-0000-4000-a000-000000000002';
  v_alex uuid := '00000000-0000-4000-a000-000000000011';
  v_sam uuid := '00000000-0000-4000-a000-000000000012';
  v_jordan uuid := '00000000-0000-4000-a000-000000000013';
  v_today date := public.gym_today(v_gym);
  v_user record;
  v_unlimited uuid;
  v_pack uuid;
  v_dropin uuid;
  v_intro uuid;
  v_waiver uuid;
  v_squat uuid;
  v_deadlift uuid;
  v_press uuid;
  v_row uuid;
  v_run uuid;
  v_ruck uuid;
  v_pullup uuid;
  v_workout uuid;
  v_program uuid;
  v_enrollment uuid;
  v_membership uuid;
  v_item uuid;
  v_log uuid;
  d int;
  wk int;
  dy int;
begin
  -- Accounts -----------------------------------------------------------------------------------
  for v_user in
    select * from (values
      (v_owner, 'owner@furyco.test', 'Braydon Owner'),
      (v_coach, 'coach@furyco.test', 'Casey Coach'),
      (v_alex, 'alex@furyco.test', 'Alex Athlete'),
      (v_sam, 'sam@furyco.test', 'Sam Packholder'),
      (v_jordan, 'jordan@furyco.test', 'Jordan Newcomer')
    ) as u (id, email, full_name)
  loop
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, email_change, email_change_token_new, recovery_token
    ) values (
      '00000000-0000-0000-0000-000000000000', v_user.id, 'authenticated', 'authenticated',
      v_user.email, extensions.crypt('FuryDemo123!', extensions.gen_salt('bf')), now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object('full_name', v_user.full_name), now(), now(), '', '', '', ''
    );
    insert into auth.identities (
      id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at
    ) values (
      gen_random_uuid(), v_user.id, v_user.id::text,
      jsonb_build_object('sub', v_user.id::text, 'email', v_user.email, 'email_verified', true),
      'email', now(), now(), now()
    );
  end loop;

  update public.gym_members set role = 'owner' where user_id = v_owner;
  update public.gym_members set role = 'coach' where user_id = v_coach;
  update public.gym_secrets set display_token = 'demo-display-token' where gym_id = v_gym;

  -- Plans and waiver -----------------------------------------------------------------------------
  insert into public.membership_plans (gym_id, name, description, kind, price_cents, billing_interval, position)
  values (v_gym, 'Unlimited Monthly', 'Unlimited classes and open gym.', 'recurring', 18500, 'month', 1)
  returning id into v_unlimited;
  insert into public.membership_plans (gym_id, name, description, kind, price_cents, class_credits, duration_days, position)
  values (v_gym, '10 Class Pack', 'Ten classes, valid for 90 days.', 'class_pack', 20000, 10, 90, 2)
  returning id into v_pack;
  insert into public.membership_plans (gym_id, name, description, kind, price_cents, class_credits, duration_days, position)
  values (v_gym, 'Drop-in', 'A single class.', 'drop_in', 2500, 1, 30, 3)
  returning id into v_dropin;
  insert into public.membership_plans (gym_id, name, description, kind, price_cents, duration_days, position)
  values (v_gym, 'Two Week Intro', 'Unlimited classes for your first 14 days.', 'intro', 4900, 14, 0)
  returning id into v_intro;

  insert into public.waivers (gym_id, title, body, version)
  values (v_gym, 'Liability Waiver & Membership Agreement',
    E'PLACEHOLDER TEXT — replace with the agreement approved by Fury Co. counsel.\n\n'
    'I understand that physical training involves risk of injury. I confirm that I am physically '
    'able to take part, that I will follow coach instruction, and that I release Fury Co. Athletics '
    'from liability to the extent permitted by law.', 1)
  returning id into v_waiver;

  insert into public.waiver_signatures (waiver_id, gym_id, user_id, signed_name, signed_at)
  values (v_waiver, v_gym, v_alex, 'Alex Athlete', now() - interval '60 days'),
         (v_waiver, v_gym, v_sam, 'Sam Packholder', now() - interval '20 days');

  insert into public.memberships (gym_id, user_id, plan_id, status, source, started_at, current_period_end)
  values (v_gym, v_alex, v_unlimited, 'active', 'comp', now() - interval '60 days', now() + interval '12 days')
  returning id into v_membership;
  insert into public.memberships (gym_id, user_id, plan_id, status, source, started_at, ends_at, credits_remaining)
  values (v_gym, v_sam, v_pack, 'active', 'comp', now() - interval '20 days', now() + interval '70 days', 7);

  -- Exercise library ---------------------------------------------------------------------------
  insert into public.exercises (gym_id, name, category, cues, default_metrics)
  values (v_gym, 'Back Squat', 'Strength', 'Brace, knees track over toes, drive through mid-foot.', '{load,reps}')
  returning id into v_squat;
  insert into public.exercises (gym_id, name, category, cues, default_metrics)
  values (v_gym, 'Deadlift', 'Strength', 'Lats tight, bar close, push the floor away.', '{load,reps}')
  returning id into v_deadlift;
  insert into public.exercises (gym_id, name, category, cues, default_metrics)
  values (v_gym, 'Strict Press', 'Strength', 'Glutes on, ribs down, head through at lockout.', '{load,reps}')
  returning id into v_press;
  insert into public.exercises (gym_id, name, category, cues, default_metrics)
  values (v_gym, 'Row', 'Conditioning', 'Legs, hips, arms — and back in reverse.', '{distance,time,pace}')
  returning id into v_row;
  insert into public.exercises (gym_id, name, category, cues, default_metrics)
  values (v_gym, 'Run', 'Conditioning', 'Tall posture, quick cadence.', '{distance,time,pace}')
  returning id into v_run;
  insert into public.exercises (gym_id, name, category, cues, default_metrics)
  values (v_gym, 'Ruck', 'Conditioning', 'Pack high and tight. Do not run under load.', '{load,distance,time}')
  returning id into v_ruck;
  insert into public.exercises (gym_id, name, category, cues, default_metrics)
  values (v_gym, 'Pull-up', 'Gymnastics', 'Full hang to chin over bar.', '{reps}')
  returning id into v_pullup;

  -- Facility programming: a Strength and an Engine workout for each day, three weeks back → next week
  for d in -21..7 loop
    insert into public.workouts (gym_id, track_id, title, description, coach_notes, scheduled_date, status, publish_at, created_by)
    values (v_gym, v_strength,
      case abs(d) % 3 when 0 then 'Squat Day' when 1 then 'Pull Day' else 'Press Day' end,
      'Build to a heavy set, then accessory work.',
      'Watch bar path on the working sets. Cap the heavy set at RPE 8.',
      v_today + d, 'published',
      -- tomorrow onwards publishes at 18:00 the evening before
      case when d <= 0 then now() - interval '1 day'
           else ((v_today + d - 1) + time '18:00') at time zone 'America/Chicago' end,
      v_coach)
    returning id into v_workout;

    insert into public.workout_items (workout_id, position, section, title, exercise_id, prescription, scaling, metrics)
    values (v_workout, 1, 'Strength',
      case abs(d) % 3 when 0 then 'Back Squat' when 1 then 'Deadlift' else 'Strict Press' end,
      case abs(d) % 3 when 0 then v_squat when 1 then v_deadlift else v_press end,
      '5 x 5 @ 75-80%', 'Reduce load to keep every rep the same speed.', '{load,reps,rpe}');
    insert into public.workout_items (workout_id, position, section, title, exercise_id, prescription, metrics)
    values (v_workout, 2, 'Accessory', 'Pull-up', v_pullup, '4 sets, max strict reps', '{reps,comments}');

    insert into public.workouts (gym_id, track_id, title, description, scheduled_date, status, publish_at, created_by)
    values (v_gym, v_engine,
      case abs(d) % 2 when 0 then 'Row Intervals' else 'Tempo Run' end,
      'Hold a pace you could repeat for one more round.',
      v_today + d, 'published',
      case when d <= 0 then now() - interval '1 day'
           else ((v_today + d - 1) + time '18:00') at time zone 'America/Chicago' end,
      v_coach)
    returning id into v_workout;

    insert into public.workout_items (workout_id, position, section, title, exercise_id, prescription, metrics)
    values (v_workout, 1, 'Conditioning',
      case abs(d) % 2 when 0 then '5 x 500m Row' else '5k Tempo Run' end,
      case abs(d) % 2 when 0 then v_row else v_run end,
      case abs(d) % 2 when 0 then '5 rounds: 500m row, rest 2:00' else '5k at conversational-plus pace' end,
      case abs(d) % 2 when 0 then '{time,splits,pace,rpe}'::public.workout_metric[]
           else '{time,distance,pace,rpe}'::public.workout_metric[] end);
  end loop;

  -- A draft and a reusable benchmark template --------------------------------------------------
  insert into public.workouts (gym_id, track_id, title, description, scheduled_date, status, created_by)
  values (v_gym, v_strength, 'Draft: Heavy Singles', 'Not yet published.', v_today + 9, 'draft', v_coach);

  insert into public.workouts (gym_id, track_id, title, description, status, is_template, created_by)
  values (v_gym, v_engine, 'Benchmark: 2k Row', 'All-out 2,000m row for time.', 'draft', true, v_coach)
  returning id into v_workout;
  insert into public.workout_items (workout_id, position, section, title, exercise_id, prescription, metrics, benchmark_name)
  values (v_workout, 1, 'Test', '2k Row', v_row, '2,000m for time', '{benchmark,time,pace,rpe}', '2k Row');

  -- Online program: Selection Prep, 6 weeks x 5 days --------------------------------------------
  insert into public.programs (gym_id, track_id, name, slug, summary, description, duration_weeks, days_per_week, price_cents, status, unlock_mode, grace_days, position)
  values (v_gym, v_selection, 'Selection Prep — 6 Week', 'selection-prep-6',
    'Six weeks of ruck, run and strength work to arrive ready.',
    'Five sessions a week. Start any day you like — your calendar is built from your own start date. '
    'Each week unlocks on its first day, and you keep access for two weeks after the final session.',
    6, 5, 14900, 'published', 'weekly', 14, 1)
  returning id into v_program;

  for wk in 1..6 loop
    for dy in 1..5 loop
      insert into public.workouts (gym_id, track_id, title, description, coach_notes, status, publish_at, created_by)
      values (v_gym, v_selection,
        format('W%s D%s — %s', wk, dy,
          case dy when 1 then 'Ruck' when 2 then 'Strength' when 3 then 'Run' when 4 then 'Work Capacity' else 'Long Ruck' end),
        case dy when 1 then 'Steady ruck at a pace you could hold for twice the distance.'
                when 2 then 'Heavy compound lifts. Leave two reps in the tank.'
                when 3 then 'Aerobic run. Nose-breathing pace.'
                when 4 then 'Mixed-modal conditioning.'
                else 'Longest effort of the week. Fuel and hydrate.' end,
        'Remote athletes: log pack weight honestly, it drives next week''s loading.',
        'published', now() - interval '30 days', v_coach)
      returning id into v_workout;

      if dy in (1, 5) then
        insert into public.workout_items (workout_id, position, section, title, exercise_id, prescription, scaling, metrics)
        values (v_workout, 1, 'Main', 'Ruck', v_ruck,
          format('%s miles @ %s lb', case dy when 1 then 3 + wk else 5 + wk end, 30 + wk * 2),
          'Drop 10 lb if pace falls below 16:00 / mile.', '{load,distance,time,pace,rpe}');
      elsif dy = 2 then
        insert into public.workout_items (workout_id, position, section, title, exercise_id, prescription, metrics)
        values (v_workout, 1, 'Strength', 'Back Squat', v_squat, format('5 x %s', case when wk <= 3 then 5 else 3 end), '{load,reps,rpe}'),
               (v_workout, 2, 'Strength', 'Deadlift', v_deadlift, '3 x 5', '{load,reps,rpe}'),
               (v_workout, 3, 'Accessory', 'Pull-up', v_pullup, '5 sets, max strict reps', '{reps}');
      elsif dy = 3 then
        insert into public.workout_items (workout_id, position, section, title, exercise_id, prescription, metrics)
        values (v_workout, 1, 'Main', 'Run', v_run, format('%s miles easy', 2 + wk), '{distance,time,pace,rpe}');
      else
        insert into public.workout_items (workout_id, position, section, title, prescription, metrics)
        values (v_workout, 1, 'Main', 'Work Capacity Circuit',
          E'5 rounds for time:\n400m run\n15 push-ups\n10 pull-ups\n20 air squats', '{time,rpe,comments}');
      end if;

      insert into public.program_workouts (program_id, week, day, workout_id) values (v_program, wk, dy, v_workout);
    end loop;
  end loop;

  -- Alex started the program 9 days ago: week 1 done, week 2 unlocked, week 3+ locked.
  insert into public.enrollments (gym_id, program_id, user_id, start_date, source)
  values (v_gym, v_program, v_alex, v_today - 9, 'comp')
  returning id into v_enrollment;

  -- Class schedule and sessions -----------------------------------------------------------------
  insert into public.class_schedules (gym_id, title, track_id, coach_id, weekday, start_time, duration_minutes, capacity)
  select v_gym, s.title, s.track, v_coach, wd, s.t, 60, s.cap
  from generate_series(1, 5) as wd,
    (values ('Strength 6AM', v_strength, time '06:00', 12),
            ('Engine Noon', v_engine, time '12:00', 12),
            ('Strength 5:30PM', v_strength, time '17:30', 2)) as s (title, track, t, cap);
  insert into public.class_schedules (gym_id, title, track_id, coach_id, weekday, start_time, duration_minutes, capacity)
  values (v_gym, 'Saturday Team Session', v_engine, v_coach, 6, time '09:00', 75, 20);

  insert into public.class_sessions (gym_id, schedule_id, title, track_id, coach_id, starts_at, ends_at, capacity)
  select s.gym_id, s.id, s.title, s.track_id, s.coach_id,
    ((v_today + n) + s.start_time) at time zone 'America/Chicago',
    ((v_today + n) + s.start_time) at time zone 'America/Chicago' + make_interval(mins => s.duration_minutes),
    s.capacity
  from public.class_schedules s
  cross join generate_series(-7, 14) as n
  where extract(dow from (v_today + n)) = s.weekday;

  -- Attendance last week
  insert into public.bookings (gym_id, session_id, user_id, status, membership_id, booked_at, checked_in_at, checked_in_by)
  select v_gym, s.id, v_alex, 'attended', v_membership, s.starts_at - interval '1 day', s.starts_at, v_coach
  from public.class_sessions s
  where s.title = 'Strength 6AM' and s.starts_at < now();

  -- Training history for Alex: squat progression + last week's program days ---------------------
  -- Squat Day falls every third day; log the last six with a steady build-up to 235 lb x 5.
  for d in 1..6 loop
    select w.id into v_workout from public.workouts w
      where w.scheduled_date = v_today - d * 3 and w.track_id = v_strength and w.title = 'Squat Day' limit 1;
    continue when v_workout is null;
    select i.id into v_item from public.workout_items i where i.workout_id = v_workout and i.exercise_id = v_squat;
    insert into public.workout_logs (gym_id, user_id, workout_id, performed_on, rpe, notes)
    values (v_gym, v_alex, v_workout, v_today - d * 3, 7.5, 'Felt solid.')
    returning id into v_log;
    insert into public.workout_log_entries (log_id, user_id, workout_item_id, exercise_id, set_index, load, load_unit, reps, performed_on, is_pr)
    select v_log, v_alex, v_item, v_squat, s, 245 - d * 10, 'lb', 5, v_today - d * 3, (d = 1 and s = 1)
    from generate_series(1, 5) as s;
  end loop;

  for dy in 1..5 loop
    select pw.workout_id into v_workout from public.program_workouts pw
      where pw.program_id = v_program and pw.week = 1 and pw.day = dy;
    insert into public.workout_logs (gym_id, user_id, workout_id, enrollment_id, performed_on, rpe)
    values (v_gym, v_alex, v_workout, v_enrollment, v_today - 9 + (dy - 1), 6 + dy * 0.5)
    returning id into v_log;
    insert into public.workout_log_entries (log_id, user_id, workout_item_id, exercise_id, set_index, load, load_unit, reps, time_seconds, distance_m, performed_on)
    select v_log, v_alex, i.id, i.exercise_id, 1,
      case when i.exercise_id = v_ruck then 32 when i.exercise_id in (v_deadlift) then 275 end, 'lb',
      case when i.exercise_id in (v_deadlift, v_pullup) then 5 end,
      case when i.exercise_id in (v_ruck, v_run) or i.exercise_id is null then 1800 + dy * 240 end,
      case when i.exercise_id in (v_ruck, v_run) then 4800 + dy * 800 end,
      v_today - 9 + (dy - 1)
    from public.workout_items i
    where i.workout_id = v_workout and i.exercise_id is distinct from v_squat;
  end loop;

  insert into public.coach_feedback (log_id, coach_id, body)
  select l.id, v_coach, 'Good week one. Keep the ruck pace honest — no shuffling.'
  from public.workout_logs l where l.enrollment_id = v_enrollment order by l.performed_on desc limit 1;

  -- Payments, so reports have something to show ------------------------------------------------
  insert into public.payments (gym_id, user_id, kind, revenue_stream, description, plan_id, membership_id, amount_cents, tax_cents, fee_cents, refunded_cents, status, stripe_payment_intent_id, paid_at)
  values
    (v_gym, v_alex, 'membership', 'facility', 'Unlimited Monthly', v_unlimited, v_membership, 18500, 0, 567, 0, 'succeeded', 'pi_demo_1', now() - interval '48 days'),
    (v_gym, v_alex, 'membership', 'facility', 'Unlimited Monthly', v_unlimited, v_membership, 18500, 0, 567, 0, 'succeeded', 'pi_demo_2', now() - interval '18 days'),
    (v_gym, v_sam, 'class_pack', 'facility', '10 Class Pack', v_pack, null, 20000, 0, 610, 0, 'succeeded', 'pi_demo_3', now() - interval '20 days'),
    (v_gym, v_sam, 'drop_in', 'facility', 'Drop-in', v_dropin, null, 2500, 0, 103, 2500, 'refunded', 'pi_demo_4', now() - interval '25 days');
  insert into public.payments (gym_id, user_id, kind, revenue_stream, description, program_id, enrollment_id, amount_cents, tax_cents, fee_cents, status, stripe_payment_intent_id, paid_at)
  values (v_gym, v_alex, 'program', 'digital', 'Selection Prep — 6 Week', v_program, v_enrollment, 14900, 0, 462, 'succeeded', 'pi_demo_5', now() - interval '10 days');
  insert into public.payments (gym_id, user_id, kind, revenue_stream, description, plan_id, amount_cents, status, failure_reason, stripe_payment_intent_id, created_at)
  values (v_gym, v_sam, 'membership', 'facility', 'Unlimited Monthly', v_unlimited, 18500, 'failed', 'card_declined', 'pi_demo_6', now() - interval '3 days');
  insert into public.payouts (gym_id, stripe_payout_id, amount_cents, status, arrival_date)
  values (v_gym, 'po_demo_1', 37323, 'paid', v_today - 15),
         (v_gym, 'po_demo_2', 14438, 'paid', v_today - 8);
end $$;
