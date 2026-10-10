-- SwimGPT multi-user onboarding schema for Supabase
-- This is designed for a production-style data model where each user can have one profile and multiple related records.

create extension if not exists "pgcrypto";

create table if not exists public.user_profiles (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid,
  user_key text not null,
  full_name text not null,
  age integer,
  gender text,
  country text,
  height numeric,
  weight numeric,
  body_type text,
  injury_history text,
  swim_experience integer,
  main_events text[] not null default '{}',
  pbs_lcm jsonb not null default '{}'::jsonb,
  pbs_scm jsonb not null default '{}'::jsonb,
  swimmer_type text,
  swim_sessions_per_week integer not null default 0,
  gym_sessions_per_week integer not null default 0,
  session_duration text,
  facilities text[] not null default '{}',
  coaching_situation text,
  health_issues text[] not null default '{}',
  sleep_tracking text,
  one_year_goal text,
  one_year_goal_times jsonb not null default '{}'::jsonb,
  three_year_goal text,
  recommended_coaches text[] not null default '{}',
  is_paid boolean not null default false,
  subscription_checked_at timestamptz,
  payment_status text not null default 'pending',
  payment_plan_id text,
  stripe_checkout_session_id text,
  stripe_customer_id text,
  stripe_subscription_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.user_profiles
  add column if not exists auth_user_id uuid;

alter table public.user_profiles
  add column if not exists payment_status text not null default 'pending';

alter table public.user_profiles
  add column if not exists payment_plan_id text;

alter table public.user_profiles
  add column if not exists stripe_checkout_session_id text;

alter table public.user_profiles
  add column if not exists stripe_customer_id text;

alter table public.user_profiles
  add column if not exists stripe_subscription_id text;

-- Dashboard access: true while the athlete pays for their monthly coaching plan. The backend sets it when Stripe
-- confirms the checkout and sets it back to false when the subscription is cancelled or its renewals go unpaid.
-- Every dashboard API refuses a profile where this is false and sends the athlete to the payment screen.
alter table public.user_profiles
  add column if not exists is_paid boolean not null default false;

-- When the backend last confirmed the monthly subscription with Stripe (it re-checks at most once a day).
alter table public.user_profiles
  add column if not exists subscription_checked_at timestamptz;

comment on column public.user_profiles.is_paid is
  'True while the athlete''s monthly coaching subscription is paid. The dashboard opens only when this is true.';
comment on column public.user_profiles.subscription_checked_at is
  'When the backend last confirmed the Stripe subscription is live. Null means check on the next dashboard visit.';

-- Athletes who paid before is_paid existed keep their access. Safe to re-run.
update public.user_profiles
set is_paid = true
where payment_status = 'paid' and not is_paid;

create index if not exists idx_user_profiles_user_key
  on public.user_profiles (user_key);

create unique index if not exists idx_user_profiles_auth_user_id
  on public.user_profiles (auth_user_id)
  where auth_user_id is not null;

create index if not exists idx_user_profiles_created_at
  on public.user_profiles (created_at desc);

-- Swim times. pbs_lcm, pbs_scm and one_year_goal_times map each event to its time split into parts:
--   {"200m Freestyle": {"minutes": 2, "seconds": 3, "hundredths": 40}}   -- 2:03.40
--   {"50m Freestyle":  {"minutes": 0, "seconds": 24, "hundredths": 5}}   -- 24.05
-- minutes 0-180, seconds 0-59, hundredths 0-99 (the two decimal places shown on a swim clock).
comment on column public.user_profiles.pbs_lcm is
  'Long course (50m) personal bests: {"<event>": {"minutes": 0-180, "seconds": 0-59, "hundredths": 0-99}}';
comment on column public.user_profiles.pbs_scm is
  'Short course (25m) personal bests: {"<event>": {"minutes": 0-180, "seconds": 0-59, "hundredths": 0-99}}';
comment on column public.user_profiles.one_year_goal_times is
  'Long course 1-year target times: {"<event>": {"minutes": 0-180, "seconds": 0-59, "hundredths": 0-99}}';

-- Converts a legacy text time ("1:02.35" or "24.50") into its parts. Anything else is returned unchanged.
create or replace function public.swim_time_parts(value jsonb)
returns jsonb
language plpgsql
immutable
as $$
declare
  txt text := value #>> '{}';
  total_seconds integer;
begin
  if jsonb_typeof(value) is distinct from 'string' or txt !~ '^\d+(:[0-5]\d)?(\.\d{1,3})?$' then
    return value;
  end if;
  total_seconds := case
    when position(':' in txt) > 0
      then split_part(txt, ':', 1)::integer * 60 + split_part(split_part(txt, ':', 2), '.', 1)::integer
    else split_part(txt, '.', 1)::integer
  end;
  return jsonb_build_object(
    'minutes', total_seconds / 60,
    'seconds', total_seconds % 60,
    'hundredths', left(split_part(txt, '.', 2) || '00', 2)::integer
  );
end;
$$;

-- True when every event maps to whole-number minutes/seconds/hundredths within range.
create or replace function public.is_valid_swim_times(times jsonb)
returns boolean
language sql
immutable
as $$
  select jsonb_typeof(times) = 'object' and not exists (
    select 1
    from jsonb_each(times) as t
    where jsonb_typeof(t.value) is distinct from 'object'
       or exists (
         select 1
         from (values ('minutes', 180), ('seconds', 59), ('hundredths', 99)) as part(name, max_value)
         where case
           when jsonb_typeof(t.value -> part.name) = 'number' then
             (t.value ->> part.name)::numeric not between 0 and part.max_value
             or (t.value ->> part.name)::numeric % 1 <> 0
           else true
         end
       )
  );
$$;

-- Normalizes a whole times object: legacy text is split into parts, valid parts are kept, anything else is dropped.
create or replace function public.swim_times_parts(times jsonb)
returns jsonb
language sql
immutable
as $$
  select coalesce(jsonb_object_agg(key, converted), '{}'::jsonb)
  from (select key, public.swim_time_parts(value) as converted from jsonb_each(times)) as t
  where public.is_valid_swim_times(jsonb_build_object(key, converted));
$$;

-- One-off migration for rows saved before times were split into parts. Safe to re-run: valid rows are skipped.
-- Original values are copied to a backup table first, because blank or unreadable entries (e.g. "fast") are dropped.
create table if not exists public.user_profile_swim_times_backup (
  profile_id uuid primary key references public.user_profiles(id) on delete cascade,
  pbs_lcm jsonb,
  pbs_scm jsonb,
  one_year_goal_times jsonb,
  backed_up_at timestamptz not null default now()
);

insert into public.user_profile_swim_times_backup (profile_id, pbs_lcm, pbs_scm, one_year_goal_times)
select id, pbs_lcm, pbs_scm, one_year_goal_times
from public.user_profiles
where not (
  public.is_valid_swim_times(pbs_lcm)
  and public.is_valid_swim_times(pbs_scm)
  and public.is_valid_swim_times(one_year_goal_times)
)
on conflict (profile_id) do nothing;

update public.user_profiles
set
  pbs_lcm = public.swim_times_parts(pbs_lcm),
  pbs_scm = public.swim_times_parts(pbs_scm),
  one_year_goal_times = public.swim_times_parts(one_year_goal_times)
where not (
  public.is_valid_swim_times(pbs_lcm)
  and public.is_valid_swim_times(pbs_scm)
  and public.is_valid_swim_times(one_year_goal_times)
);

-- Reject malformed times on insert/update, including manual edits in the Supabase table editor.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'user_profiles_pbs_lcm_parts') then
    alter table public.user_profiles
      add constraint user_profiles_pbs_lcm_parts check (public.is_valid_swim_times(pbs_lcm));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'user_profiles_pbs_scm_parts') then
    alter table public.user_profiles
      add constraint user_profiles_pbs_scm_parts check (public.is_valid_swim_times(pbs_scm));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'user_profiles_goal_times_parts') then
    alter table public.user_profiles
      add constraint user_profiles_goal_times_parts check (public.is_valid_swim_times(one_year_goal_times));
  end if;
end;
$$;

-- Coaching knowledge lives in the backend code (app/coach_programs.py, app/coach_sessions.py). The PDF-embedding
-- store that used to hold it is removed (see migrations/2026-10-05_remove_coach_context_chunks.sql).
drop function if exists public.match_coach_context_chunks(vector, text[], integer);
drop table if exists public.coach_context_chunks;

create table if not exists public.user_ai_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.user_profiles(id) on delete cascade,
  plan jsonb not null default '{}'::jsonb,
  context_sources text[] not null default '{}',
  model text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists idx_user_ai_plans_user_id
  on public.user_ai_plans (user_id);

create table if not exists public.user_training_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.user_profiles(id) on delete cascade,
  session_type text not null,
  session_name text,
  session_date timestamptz,
  planned_duration_minutes integer,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Dashboard reads this table for the authenticated profile and current UTC week.
-- details supports completion_status (scheduled/in_progress/completed/cancelled),
-- primary_objective, distance_meters, race_pace_meters, and zone_volumes_meters
-- (a JSON object mapping zone names to distances). Missing measurements remain
-- "Not recorded"; onboarding availability is never counted as completed work.
-- session_type accepts swim, strength (or gym), mobility, and recovery.
-- Today also stores daily_plan and athlete_feedback records in this existing
-- table. Their deterministic UUID primary keys identify one record per profile,
-- UTC day, and type. daily_plan.details contains the validated plan, source_files,
-- model and generated_at; athlete_feedback.details contains feedback and saved_at.
-- Generated plans and self-reported check-ins are not completed training sessions.
-- Training also persists week_plan, workout, workout_state, competition,
-- race_plan, and race_result records here. details stores their validated
-- payloads, source files, and reference keys. Account-owned workout_state
-- records track favorites/templates; a separately saved swim record with
-- completion_status='completed' records an athlete-confirmed prescribed session.
-- Daily plans adopted from a week carry origin_week_id so the same workout
-- keeps its library identity and is not counted twice.
-- Today can also read a week directly without creating a duplicate daily_plan.
-- Manual scheduled workouts are separate dated records and consume availability
-- when a week is generated. Strength completions use a deterministic profile/day
-- key, prescribed workout details, and completion_status='completed'.
-- Race results store actual final time, optional segment splits, ranking,
-- stroke rate and feedback. GET recomputes comparison against the current saved
-- race plan and earlier matching-course results so corrected records stay current.
-- Performance persists performance_race and performance_pace in this table,
-- with a validated details.record payload. Each record belongs to user_id;
-- authenticated CRUD can edit/delete only these manual entries, not onboarding
-- or Training competition records. performance_race stores course (SCY/SCM/LCM),
-- event, date, competition, final_time, optional segment splits and stroke rate.
-- SCY events/distances are yards; SCM/LCM are meters and never auto-converted.
-- performance_pace stores actual equal-distance repeat times, distance, course,
-- actual repetition stroke, zone, push/dive start, equipment, rest, optional
-- stroke rate and notes. Comparisons keep these measurement conditions separate.
-- Pace samples are measurements, not completed full workouts, and therefore
-- do not increase training-session volume. Weekly analytics use completed swim
-- and strength records and match them against dated saved plans. Onboarding PBs
-- remain undated baselines; no date or competition is synthesized for them.
-- Dashboard snapshots use the same current-PB/race history; manual race entries
-- also reach the existing coach/Today/week recent-results context with explicit
-- course and distance units. Numerical analytics do not require AI generation.
-- Paces and Zones persists pace_settings per profile/event/course using
-- deterministic keys. details.settings stores the PB selection (or a manual
-- calculator-only reference), distances and six editable PB-speed bands with
-- optional user-supplied HR/lactate annotations. details.method_version records
-- pb-speed-bands-v1: target seconds = PB seconds * distance / event distance
-- divided by the selected speed fraction. These are coaching estimates, not
-- measured physiological thresholds. Imported PBs use the same Performance
-- current-best selection; manual calculator references never create race records.
-- The dedicated navbar and Training tab use the identical calculator/API.
-- Workout Builder reuses account-owned workout records and workout_state
-- favorites. workout includes optional session notes; sets may contain custom
-- stroke/type labels and optional technical_focus cues. All distances are meters
-- (25m/50m pools), including mixed/custom labels without inferred stroke splits.
-- Manual sessions may contain 1-15 sets. Generated sessions still request at
-- least two sets and technical-focus cues. Onboarding facilities and numeric
-- session duration seed the editor without inventing prescriptions or history.
-- Dated saves share Training's two-session / 16,000m daily planning limits;
-- each workout is limited to 12,000m. Editable manual prescriptions are updated
-- in place; generated and completed prescriptions must be duplicated first.
-- Duplicates are unscheduled independent records; deleting a manual prescription
-- removes its preferences, not independent scheduled copies or actual history.
-- PDF export is an authenticated in-memory download, never a public stored file.
-- Nutrition keeps one nutrition_profile record per profile (deterministic key, no session_date, so it never
-- counts as training). details.answers holds the athlete's answers to the Nutrition questions (goal, sex, age,
-- height_cm, weight_kg, swim_time, meals_per_day, pre_training, water, diet, avoid, challenge), details.saved_at
-- when they last answered, and details.water maps their last 7 local dates to the millilitres of water logged.
-- The fuel plan (calories, macros, water, timing and habits) is calculated from the answers and the profile's
-- training volume on every read; it is never stored. No new table or column is needed for it.
-- Mental Performance keeps one mental_profile record per profile the same way: details.answers holds the
-- athlete's answers (goal, 1-5 self-ratings for confidence, focus, calm, motivation and resilience, pre_race,
-- routine, setback, sleep, stress, mood, tools), details.saved_at, and details.checkins maps their last 14 local
-- dates to a 1-5 daily mood check-in. The plan (strength, routine, mental skills, support card) is chosen from
-- fixed text on every read and never stored.
-- Switching coach from the dashboard is a one-time Stripe payment per switch: $1.99, or $2.99 to the athlete's
-- best-match (recommended) coach. The athlete's latest switch checkout is kept in one coach_switch record
-- (deterministic key, no session_date): details.session_id is the Stripe Checkout Session, details.coach the coach
-- chosen at checkout, and details.earlier any paid checkouts from before it whose switch never happened (they count
-- towards it, so it only charged the rest). Stripe says what was paid; the switch deletes the record as it uses the
-- payment, so one payment pays for exactly one switch.
create index if not exists idx_user_training_sessions_user_id
  on public.user_training_sessions (user_id);

create table if not exists public.user_coach_matches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.user_profiles(id) on delete cascade,
  coach_name text not null,
  coach_role text,
  match_score numeric,
  created_at timestamptz not null default now()
);

create index if not exists idx_user_coach_matches_user_id
  on public.user_coach_matches (user_id);

create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_user_profiles_updated_at on public.user_profiles;
create trigger trg_user_profiles_updated_at
before update on public.user_profiles
for each row
execute function public.set_updated_at();

-- Optional row-level security pattern for multi-user isolation.
-- Enable these if you want to protect user data by authenticated user id.
-- alter table public.user_profiles enable row level security;
-- create policy "Users can view own profile" on public.user_profiles
-- for select using (auth.uid()::text = user_key);
-- create policy "Users can insert own profile" on public.user_profiles
-- for insert with check (auth.uid()::text = user_key);
-- create policy "Users can update own profile" on public.user_profiles
-- for update using (auth.uid()::text = user_key);

-- Training Plan store (backend/app/plan_store.py): every PDF plan an account buys. Buying needs an account but no
-- subscription or onboarding, so purchases belong to the sign-in account (auth.users), not to an athlete profile.
-- A row is written as checkout opens (status 'pending') and marked 'paid' once Stripe confirms the payment; a
-- checkout that expires unpaid is removed. amount is in cents; plan_title is the plan's name when it was bought.
-- Only the backend (secret key) reads or writes it: row level security is on with no policies.
create table if not exists public.user_plan_purchases (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null references auth.users(id) on delete cascade,
  plan_id text not null,
  plan_title text not null,
  amount integer not null,
  currency text not null default 'usd',
  status text not null default 'pending' check (status in ('pending', 'paid')),
  stripe_checkout_session_id text not null unique,
  created_at timestamptz not null default now(),
  paid_at timestamptz
);

create index if not exists idx_user_plan_purchases_auth_user_id
  on public.user_plan_purchases (auth_user_id);

alter table public.user_plan_purchases enable row level security;

-- Make the Supabase API see new columns straight away (otherwise it can report them missing until its cache refreshes).
notify pgrst, 'reload schema';
