-- Fury Co. Athletics — core schema.
-- Every business table carries gym_id. The pilot runs a single gym, but nothing below assumes it.

create extension if not exists pgcrypto with schema extensions;

create schema if not exists private;

-- ---------------------------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------------------------
create type public.gym_role as enum ('athlete', 'coach', 'admin', 'owner');
create type public.track_kind as enum ('facility', 'online');
create type public.workout_status as enum ('draft', 'published');
create type public.workout_metric as enum
  ('load', 'sets', 'reps', 'time', 'distance', 'pace', 'splits', 'rpe', 'benchmark', 'comments');
create type public.display_mode as enum ('auto', 'manual', 'off');
create type public.booking_status as enum ('booked', 'waitlisted', 'cancelled', 'attended', 'no_show');
create type public.plan_kind as enum ('recurring', 'class_pack', 'drop_in', 'intro');
create type public.membership_status as enum ('active', 'past_due', 'frozen', 'cancelled', 'expired');
create type public.program_status as enum ('draft', 'published', 'archived');
create type public.unlock_mode as enum ('weekly', 'daily', 'all');
create type public.enrollment_status as enum ('active', 'paused', 'completed', 'cancelled', 'refunded');
create type public.payment_kind as enum ('membership', 'class_pack', 'drop_in', 'intro', 'program');
create type public.revenue_stream as enum ('facility', 'digital');
create type public.payment_status as enum ('pending', 'succeeded', 'failed', 'refunded', 'partially_refunded');

create or replace function private.set_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Identity
-- ---------------------------------------------------------------------------------------------
create table public.gyms (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  timezone text not null default 'America/Chicago',
  booking_window_days int not null default 14 check (booking_window_days between 1 and 365),
  cancel_cutoff_minutes int not null default 60 check (cancel_cutoff_minutes >= 0),
  -- Shows the "buy on the web" link for digital programs in the iOS app (US storefront only).
  ios_program_purchase_link boolean not null default true,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index gyms_single_default on public.gyms (is_default) where is_default;
create trigger gyms_updated before update on public.gyms
  for each row execute function private.set_updated_at();

-- Values that must never reach athletes (TV display token).
create table public.gym_secrets (
  gym_id uuid primary key references public.gyms (id) on delete cascade,
  display_token text not null unique default encode(extensions.gen_random_bytes(24), 'hex'),
  updated_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  full_name text not null default '',
  phone text,
  avatar_url text,
  date_of_birth date,
  emergency_contact_name text,
  emergency_contact_phone text,
  units text not null default 'lb' check (units in ('lb', 'kg')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger profiles_updated before update on public.profiles
  for each row execute function private.set_updated_at();

create table public.gym_members (
  gym_id uuid not null references public.gyms (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role public.gym_role not null default 'athlete',
  status text not null default 'active' check (status in ('active', 'inactive')),
  joined_at timestamptz not null default now(),
  primary key (gym_id, user_id)
);
create index gym_members_user on public.gym_members (user_id);

create table public.audit_log (
  id bigint generated always as identity primary key,
  gym_id uuid references public.gyms (id) on delete cascade,
  actor_id uuid,
  action text not null,
  entity text not null,
  entity_id text,
  details jsonb,
  created_at timestamptz not null default now()
);
create index audit_log_gym_time on public.audit_log (gym_id, created_at desc);

-- ---------------------------------------------------------------------------------------------
-- Programming
-- ---------------------------------------------------------------------------------------------
create table public.tracks (
  id uuid primary key default gen_random_uuid(),
  gym_id uuid not null references public.gyms (id) on delete cascade,
  name text not null,
  slug text not null,
  kind public.track_kind not null default 'facility',
  color text not null default '#E5484D',
  description text,
  position int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (gym_id, slug)
);

create table public.exercises (
  id uuid primary key default gen_random_uuid(),
  gym_id uuid not null references public.gyms (id) on delete cascade,
  name text not null,
  category text,
  cues text,
  video_url text,
  default_metrics public.workout_metric[] not null default '{}',
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  unique (gym_id, name)
);

create table public.workouts (
  id uuid primary key default gen_random_uuid(),
  gym_id uuid not null references public.gyms (id) on delete cascade,
  track_id uuid references public.tracks (id) on delete set null,
  title text not null,
  description text,
  coach_notes text,
  -- Facility workouts live on a calendar date. Program workouts leave this null and are placed by
  -- program_workouts (week, day) relative to each athlete's own start date.
  scheduled_date date,
  status public.workout_status not null default 'draft',
  -- Athletes and displays see a published workout once publish_at has passed ("scheduled publishing").
  publish_at timestamptz,
  is_template boolean not null default false,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status = 'draft' or publish_at is not null)
);
create index workouts_gym_date on public.workouts (gym_id, scheduled_date);
create index workouts_track on public.workouts (track_id);
create trigger workouts_updated before update on public.workouts
  for each row execute function private.set_updated_at();

create table public.workout_items (
  id uuid primary key default gen_random_uuid(),
  workout_id uuid not null references public.workouts (id) on delete cascade,
  position int not null default 0,
  section text,
  title text not null,
  exercise_id uuid references public.exercises (id) on delete set null,
  prescription text,
  scaling text,
  notes text,
  video_url text,
  -- The fields the coach wants athletes to record for this item.
  metrics public.workout_metric[] not null default '{}',
  -- Set when metrics includes 'benchmark': results are tracked under this name across workouts.
  benchmark_name text,
  created_at timestamptz not null default now()
);
create index workout_items_workout on public.workout_items (workout_id, position);

create table public.display_state (
  gym_id uuid primary key references public.gyms (id) on delete cascade,
  mode public.display_mode not null default 'auto',
  track_id uuid references public.tracks (id) on delete set null,
  workout_id uuid references public.workouts (id) on delete set null,
  message text,
  show_coach_notes boolean not null default false,
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------------------------
-- Operations: plans, memberships, waivers, classes, bookings
-- ---------------------------------------------------------------------------------------------
create table public.membership_plans (
  id uuid primary key default gen_random_uuid(),
  gym_id uuid not null references public.gyms (id) on delete cascade,
  name text not null,
  description text,
  kind public.plan_kind not null,
  price_cents int not null check (price_cents >= 0),
  currency text not null default 'usd',
  billing_interval text check (billing_interval in ('week', 'month', 'year')),
  -- null = unlimited classes while the membership is valid
  class_credits int check (class_credits > 0),
  -- validity for packs, drop-ins and intro offers
  duration_days int check (duration_days > 0),
  stripe_price_id text,
  active boolean not null default true,
  is_public boolean not null default true,
  position int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((kind = 'recurring') = (billing_interval is not null))
);
create trigger membership_plans_updated before update on public.membership_plans
  for each row execute function private.set_updated_at();

create table public.memberships (
  id uuid primary key default gen_random_uuid(),
  gym_id uuid not null references public.gyms (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  plan_id uuid not null references public.membership_plans (id) on delete restrict,
  status public.membership_status not null default 'active',
  source text not null default 'comp' check (source in ('stripe', 'comp', 'migrated')),
  started_at timestamptz not null default now(),
  current_period_end timestamptz,
  ends_at timestamptz,
  cancel_at_period_end boolean not null default false,
  frozen_until date,
  credits_remaining int check (credits_remaining >= 0),
  stripe_subscription_id text unique,
  stripe_checkout_session_id text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index memberships_user on public.memberships (user_id, status);
create index memberships_gym_status on public.memberships (gym_id, status);
create trigger memberships_updated before update on public.memberships
  for each row execute function private.set_updated_at();

create table public.waivers (
  id uuid primary key default gen_random_uuid(),
  gym_id uuid not null references public.gyms (id) on delete cascade,
  title text not null,
  body text not null,
  version int not null default 1,
  required boolean not null default true,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.waiver_signatures (
  id uuid primary key default gen_random_uuid(),
  waiver_id uuid not null references public.waivers (id) on delete restrict,
  gym_id uuid not null references public.gyms (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  signed_name text not null,
  signed_at timestamptz not null default now(),
  ip_address text,
  user_agent text,
  unique (waiver_id, user_id)
);

create table public.class_schedules (
  id uuid primary key default gen_random_uuid(),
  gym_id uuid not null references public.gyms (id) on delete cascade,
  title text not null,
  track_id uuid references public.tracks (id) on delete set null,
  coach_id uuid references public.profiles (id) on delete set null,
  weekday int not null check (weekday between 0 and 6), -- 0 = Sunday
  start_time time not null,
  duration_minutes int not null default 60 check (duration_minutes > 0),
  capacity int not null default 16 check (capacity > 0),
  active boolean not null default true,
  valid_from date,
  valid_until date,
  created_at timestamptz not null default now()
);

create table public.class_sessions (
  id uuid primary key default gen_random_uuid(),
  gym_id uuid not null references public.gyms (id) on delete cascade,
  schedule_id uuid references public.class_schedules (id) on delete set null,
  title text not null,
  track_id uuid references public.tracks (id) on delete set null,
  coach_id uuid references public.profiles (id) on delete set null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  capacity int not null check (capacity > 0),
  status text not null default 'scheduled' check (status in ('scheduled', 'cancelled')),
  notes text,
  created_at timestamptz not null default now(),
  unique (schedule_id, starts_at),
  check (ends_at > starts_at)
);
create index class_sessions_gym_time on public.class_sessions (gym_id, starts_at);

create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  gym_id uuid not null references public.gyms (id) on delete cascade,
  session_id uuid not null references public.class_sessions (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  status public.booking_status not null default 'booked',
  membership_id uuid references public.memberships (id) on delete set null,
  credit_used boolean not null default false,
  late_cancel boolean not null default false,
  booked_at timestamptz not null default now(),
  cancelled_at timestamptz,
  checked_in_at timestamptz,
  checked_in_by uuid references public.profiles (id) on delete set null
);
create unique index bookings_one_live_per_user on public.bookings (session_id, user_id)
  where status <> 'cancelled';
create index bookings_session on public.bookings (session_id, status, booked_at);
create index bookings_user on public.bookings (user_id, booked_at desc);

-- ---------------------------------------------------------------------------------------------
-- Online programs
-- ---------------------------------------------------------------------------------------------
create table public.programs (
  id uuid primary key default gen_random_uuid(),
  gym_id uuid not null references public.gyms (id) on delete cascade,
  track_id uuid references public.tracks (id) on delete set null,
  name text not null,
  slug text not null,
  summary text,
  description text,
  duration_weeks int not null check (duration_weeks between 1 and 104),
  days_per_week int not null default 5 check (days_per_week between 1 and 7),
  price_cents int not null default 0 check (price_cents >= 0),
  currency text not null default 'usd',
  stripe_price_id text,
  status public.program_status not null default 'draft',
  unlock_mode public.unlock_mode not null default 'weekly',
  -- access continues this many days after the final program week
  grace_days int not null default 14 check (grace_days >= 0),
  position int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (gym_id, slug)
);
create trigger programs_updated before update on public.programs
  for each row execute function private.set_updated_at();

create table public.program_workouts (
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null references public.programs (id) on delete cascade,
  week int not null check (week >= 1),
  day int not null check (day between 1 and 7),
  workout_id uuid not null references public.workouts (id) on delete cascade,
  unique (program_id, week, day)
);
create index program_workouts_workout on public.program_workouts (workout_id);

create table public.enrollments (
  id uuid primary key default gen_random_uuid(),
  gym_id uuid not null references public.gyms (id) on delete cascade,
  program_id uuid not null references public.programs (id) on delete restrict,
  user_id uuid not null references public.profiles (id) on delete cascade,
  start_date date not null,
  expires_at date,
  status public.enrollment_status not null default 'active',
  source text not null default 'comp' check (source in ('stripe', 'comp', 'migrated')),
  stripe_checkout_session_id text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index enrollments_one_active on public.enrollments (program_id, user_id)
  where status = 'active';
create index enrollments_user on public.enrollments (user_id, status);
create trigger enrollments_updated before update on public.enrollments
  for each row execute function private.set_updated_at();

create or replace function private.enrollment_default_expiry()
returns trigger language plpgsql set search_path = '' as $$
declare
  v_weeks int;
  v_grace int;
begin
  if new.expires_at is null then
    select p.duration_weeks, p.grace_days into v_weeks, v_grace
      from public.programs p where p.id = new.program_id;
    new.expires_at := new.start_date + (v_weeks * 7) - 1 + v_grace;
  end if;
  return new;
end $$;
create trigger enrollments_default_expiry before insert on public.enrollments
  for each row execute function private.enrollment_default_expiry();

-- ---------------------------------------------------------------------------------------------
-- Logging
-- ---------------------------------------------------------------------------------------------
create table public.workout_logs (
  id uuid primary key default gen_random_uuid(),
  gym_id uuid not null references public.gyms (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  workout_id uuid not null references public.workouts (id) on delete cascade,
  enrollment_id uuid references public.enrollments (id) on delete set null,
  performed_on date not null,
  notes text,
  rpe numeric(3, 1) check (rpe between 0 and 10),
  duration_seconds int check (duration_seconds >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index workout_logs_one_per_workout on public.workout_logs
  (user_id, workout_id, coalesce(enrollment_id, '00000000-0000-0000-0000-000000000000'::uuid));
create index workout_logs_user_date on public.workout_logs (user_id, performed_on desc);
create trigger workout_logs_updated before update on public.workout_logs
  for each row execute function private.set_updated_at();

create table public.workout_log_entries (
  id uuid primary key default gen_random_uuid(),
  log_id uuid not null references public.workout_logs (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  workout_item_id uuid references public.workout_items (id) on delete set null,
  exercise_id uuid references public.exercises (id) on delete set null,
  benchmark_name text,
  set_index int not null default 1,
  load numeric(8, 2) check (load >= 0),
  load_unit text not null default 'lb' check (load_unit in ('lb', 'kg')),
  load_kg numeric(8, 2) generated always as
    (case when load_unit = 'kg' then load else round(load * 0.45359237, 2) end) stored,
  sets int check (sets >= 0),
  reps int check (reps >= 0),
  time_seconds numeric(10, 2) check (time_seconds >= 0),
  distance_m numeric(10, 2) check (distance_m >= 0),
  pace_seconds numeric(8, 2) check (pace_seconds >= 0),
  pace_unit text check (pace_unit in ('500m', 'km', 'mile')),
  splits jsonb,
  rpe numeric(3, 1) check (rpe between 0 and 10),
  comments text,
  is_pr boolean not null default false,
  performed_on date not null,
  created_at timestamptz not null default now()
);
create index workout_log_entries_log on public.workout_log_entries (log_id);
create index workout_log_entries_exercise on public.workout_log_entries (user_id, exercise_id, performed_on);
create index workout_log_entries_benchmark on public.workout_log_entries (user_id, benchmark_name);

create table public.coach_feedback (
  id uuid primary key default gen_random_uuid(),
  log_id uuid not null references public.workout_logs (id) on delete cascade,
  coach_id uuid references public.profiles (id) on delete set null,
  body text not null,
  created_at timestamptz not null default now()
);
create index coach_feedback_log on public.coach_feedback (log_id);

-- ---------------------------------------------------------------------------------------------
-- Commerce (written only by the Stripe webhook through the service role)
-- ---------------------------------------------------------------------------------------------
create table public.stripe_customers (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  stripe_customer_id text not null unique,
  created_at timestamptz not null default now()
);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  gym_id uuid not null references public.gyms (id) on delete cascade,
  -- Financial records outlive the account: the row stays, the link is cleared.
  user_id uuid references public.profiles (id) on delete set null,
  kind public.payment_kind not null,
  revenue_stream public.revenue_stream not null,
  description text,
  plan_id uuid references public.membership_plans (id) on delete set null,
  program_id uuid references public.programs (id) on delete set null,
  membership_id uuid references public.memberships (id) on delete set null,
  enrollment_id uuid references public.enrollments (id) on delete set null,
  -- amount_cents is what the customer was charged, tax included.
  amount_cents int not null check (amount_cents >= 0),
  tax_cents int not null default 0 check (tax_cents >= 0),
  fee_cents int not null default 0 check (fee_cents >= 0),
  refunded_cents int not null default 0 check (refunded_cents >= 0),
  currency text not null default 'usd',
  status public.payment_status not null default 'pending',
  failure_reason text,
  stripe_payment_intent_id text unique,
  stripe_invoice_id text unique,
  stripe_charge_id text unique,
  stripe_checkout_session_id text,
  stripe_balance_transaction_id text,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index payments_gym_time on public.payments (gym_id, paid_at desc);
create index payments_user on public.payments (user_id, created_at desc);
create trigger payments_updated before update on public.payments
  for each row execute function private.set_updated_at();

create table public.payouts (
  id uuid primary key default gen_random_uuid(),
  gym_id uuid not null references public.gyms (id) on delete cascade,
  stripe_payout_id text not null unique,
  amount_cents int not null,
  currency text not null default 'usd',
  status text not null,
  arrival_date date,
  created_at timestamptz not null default now()
);

create table public.stripe_events (
  id text primary key,
  type text not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  error text
);

-- ---------------------------------------------------------------------------------------------
-- Base data: the gym itself and its three tracks. Demo content lives in seed.sql.
-- ---------------------------------------------------------------------------------------------
with g as (
  insert into public.gyms (name, slug, is_default)
  values ('Fury Co. Athletics', 'fury-co', true)
  returning id
), s as (
  insert into public.gym_secrets (gym_id) select id from g
), d as (
  insert into public.display_state (gym_id) select id from g
)
insert into public.tracks (gym_id, name, slug, kind, color, position, description)
select g.id, t.name, t.slug, t.kind::public.track_kind, t.color, t.position, t.description
from g, (values
  ('Strength', 'strength', 'facility', '#E5484D', 1, 'Barbell strength and accessory work.'),
  ('Engine', 'engine', 'facility', '#F5A524', 2, 'Aerobic capacity and conditioning.'),
  ('Selection', 'selection', 'online', '#3E9B6E', 3, 'Selection preparation programming.')
) as t (name, slug, kind, color, position, description);
