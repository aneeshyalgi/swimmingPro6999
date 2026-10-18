-- Platform survey (backend/app/survey.py): from the dashboard, athletes rate SwimGPT from 1 to 5 and answer a few
-- questions about how they use it, the features they use, what they like, what to improve and what to build next.
-- One row per athlete per survey round (survey_version): sending the survey again updates that row. A new round asks
-- every athlete again and keeps the earlier rounds' rows. Deleting an athlete's profile deletes their answers.
-- Only the backend (secret key) reads or writes it: row level security is on with no policies, and the public API
-- roles have no access to it.
-- Run once in the Supabase SQL editor. Safe to re-run. It adds this one table and changes no existing table or row.
-- Until it has run, the dashboard simply doesn't offer the survey.

create table if not exists public.user_platform_surveys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.user_profiles(id) on delete cascade,
  survey_version text not null,
  rating smallint not null check (rating between 1 and 5),
  usage_frequency text,
  training_impact text,
  features_used text[] not null default '{}',
  feature_ratings jsonb not null default '{}'::jsonb check (jsonb_typeof(feature_ratings) = 'object'),
  liked text[] not null default '{}',
  liked_note text,
  improve text[] not null default '{}',
  improve_note text,
  wishlist text[] not null default '{}',
  wishlist_note text,
  recommend smallint check (recommend between 0 and 10),
  comments text,
  contact_ok boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists idx_user_platform_surveys_user_version
  on public.user_platform_surveys (user_id, survey_version);

alter table public.user_platform_surveys enable row level security;
revoke all on table public.user_platform_surveys from anon, authenticated;
grant select, insert, update, delete on table public.user_platform_surveys to service_role;

comment on table public.user_platform_surveys is
  'Dashboard survey answers: one row per athlete (user_id) and survey round (survey_version). Written only by the backend.';
comment on column public.user_platform_surveys.rating is 'Overall rating of SwimGPT, 1 (poor) to 5 (excellent).';
comment on column public.user_platform_surveys.usage_frequency is 'How often they use SwimGPT: daily, few_weekly, weekly or rarely.';
comment on column public.user_platform_surveys.training_impact is 'How their training has changed since they started: much_better, better, same or worse.';
comment on column public.user_platform_surveys.features_used is 'Features they use (swim_week, gym_week, workout_builder, competitions, coach_chat, voice_calls, nutrition, mental, video_analysis, pace_calculator, training_plans).';
comment on column public.user_platform_surveys.feature_ratings is 'Each feature they use, rated 1 to 5: {"swim_week": 5, "coach_chat": 4}.';
comment on column public.user_platform_surveys.liked is 'What they like most (up to 3): personalised, coach, workouts, variety, ease, design, progress, all_in_one, value.';
comment on column public.user_platform_surveys.improve is 'What to improve: workout_fit, coach_answers, ease, speed, bugs, phone, features, price, or nothing.';
comment on column public.user_platform_surveys.wishlist is 'What to build next (up to 3): watch_sync, progress_charts, drill_videos, teams, offline, reminders, calendar_sync, community, languages.';
comment on column public.user_platform_surveys.recommend is 'How likely they are to recommend SwimGPT, 0 to 10 (Net Promoter Score).';
comment on column public.user_platform_surveys.contact_ok is 'True when they agreed to be emailed about these answers.';
comment on column public.user_platform_surveys.updated_at is 'When they last sent this round''s answers.';

-- Make the Supabase API see the new table straight away (otherwise it can report it missing until its cache refreshes).
notify pgrst, 'reload schema';

-- Reading the results (paste any of these into the SQL editor):
--
-- Answers, average rating and Net Promoter Score this round:
--   select count(*) as answers, round(avg(rating), 2) as average_rating,
--          round(100.0 * (count(*) filter (where recommend >= 9) - count(*) filter (where recommend <= 6))
--                / nullif(count(recommend), 0)) as nps
--   from public.user_platform_surveys where survey_version = '2026-10';
--
-- How many athletes use each feature, and how they rate it:
--   select feature, count(*) as athletes, round(avg((feature_ratings ->> feature)::numeric), 2) as average_rating
--   from public.user_platform_surveys, unnest(features_used) as feature
--   where survey_version = '2026-10' group by feature order by athletes desc;
--
-- What to improve, most asked first (use liked or wishlist in place of improve for the others):
--   select choice, count(*) as athletes
--   from public.user_platform_surveys, unnest(improve) as choice
--   where survey_version = '2026-10' group by choice order by athletes desc;
--
-- Every answer, newest first, with the athlete's name and email:
--   select s.*, p.full_name, u.email
--   from public.user_platform_surveys s
--   join public.user_profiles p on p.id = s.user_id
--   left join auth.users u on u.id = p.auth_user_id
--   order by s.updated_at desc;
