-- Permission to email athletes now and then to ask for their feedback, such as when there's a new survey
-- (backend/app/survey.py). The last question of the survey at /survey asks it, and an athlete who has answered can
-- change it there at any time. Two columns on user_platform_surveys: whether they agreed, and when they last chose
-- (kept as proof of what they agreed to).
-- Run once in the Supabase SQL editor. Safe to re-run, and safe before or after deploying the code that asks: until it
-- has run, the survey works as before and doesn't ask. It changes no other table, and answers already sent keep every
-- value, with "not agreed" (false) for the new question.

alter table public.user_platform_surveys
  add column if not exists survey_emails_ok boolean not null default false,
  add column if not exists survey_emails_at timestamptz;

comment on column public.user_platform_surveys.survey_emails_ok is
  'True when they agreed to be emailed now and then to ask for their feedback, such as when there''s a new survey.';
comment on column public.user_platform_surveys.survey_emails_at is
  'When they last chose, in the survey or after it. Null for answers sent before it was asked.';

-- Make the Supabase API see the new columns straight away (otherwise it can report them missing until its cache
-- refreshes).
notify pgrst, 'reload schema';

-- Who may be emailed: paying athletes whose latest choice is yes, with their email address and when they agreed:
--   select distinct on (u.id) u.email, p.full_name, s.survey_emails_at as agreed_at
--   from public.user_platform_surveys s
--   join public.user_profiles p on p.id = s.user_id
--   join auth.users u on u.id = p.auth_user_id
--   where s.survey_emails_ok and p.is_paid
--     and s.survey_emails_at = (select max(survey_emails_at) from public.user_platform_surveys where user_id = s.user_id)
--   order by u.id, s.survey_emails_at desc;
-- To leave out athletes who already answered the round you're inviting them to, add before the order by:
--     and not exists (select 1 from public.user_platform_surveys done where done.user_id = s.user_id and done.survey_version = '2027-01')
--
-- Someone asks by email to stop (record it, so they aren't emailed again):
--   update public.user_platform_surveys s set survey_emails_ok = false, survey_emails_at = now()
--   from public.user_profiles p join auth.users u on u.id = p.auth_user_id
--   where p.id = s.user_id and s.survey_emails_ok and lower(u.email) = lower('their@email.com');
