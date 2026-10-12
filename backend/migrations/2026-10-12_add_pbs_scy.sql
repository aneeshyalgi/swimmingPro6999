-- Short course yards (25-yard pool) personal bests, asked in onboarding of athletes who join from now on.
-- No default: the column stays null for every athlete who joined before, which keeps their profile as it was and tells
-- the app not to show them the SCY field. Run once in the Supabase SQL editor. Safe to re-run.

alter table public.user_profiles
  add column if not exists pbs_scy jsonb;

comment on column public.user_profiles.pbs_scy is
  'Short course yards PBs by yard event ("500y Freestyle"), as {minutes, seconds, hundredths}. Null for athletes who joined before onboarding asked for them.';
