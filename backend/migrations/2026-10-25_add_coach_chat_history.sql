-- Saved coach chats (backend/app/coach_history.py): the coach chat and voice calls keep each athlete's conversation
-- with their coach on our side too, so the coach remembers it (its last 50 messages go with every message) on every
-- device the athlete uses, and a new device or a cleared browser gets it back.
--   user_coach_conversations: one row per athlete and coach: the conversation in use, and when it was last started
--     over ("New chat" or "Clear history", on any device), so the athlete's other devices start over too.
--   user_coach_messages: that conversation's messages, the newest 50 per athlete and coach. Starting over deletes them.
-- Deleting an athlete's profile deletes both. Only the backend (secret key) reads or writes them: row level security is
-- on with no policies, and the public API roles have no access.
-- Run once in the Supabase SQL editor. Safe to re-run. It adds these two tables and changes no existing table or row.
-- Until it has run, chats stay on the athlete's device only, exactly as before.

create table if not exists public.user_coach_conversations (
  user_id uuid not null references public.user_profiles(id) on delete cascade,
  coach text not null check (char_length(coach) between 1 and 100),
  conversation text not null check (char_length(conversation) between 8 and 100),
  started_at timestamptz not null default now(),
  reset_at timestamptz,
  primary key (user_id, coach)
);

create table if not exists public.user_coach_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.user_profiles(id) on delete cascade,
  coach text not null check (char_length(coach) between 1 and 100),
  conversation text not null check (char_length(conversation) between 8 and 100),
  message_id text not null check (char_length(message_id) between 1 and 100),
  role text not null check (role in ('user', 'assistant')),
  content text not null check (char_length(content) between 1 and 40000),
  voice boolean not null default false,
  plan text check (plan in ('swim', 'gym', 'both')),
  sent_at timestamptz not null,
  created_at timestamptz not null default now()
);

-- A message is saved once, however often a device sends it.
create unique index if not exists idx_user_coach_messages_message
  on public.user_coach_messages (user_id, message_id);
create index if not exists idx_user_coach_messages_conversation
  on public.user_coach_messages (user_id, coach, conversation, sent_at desc);

alter table public.user_coach_conversations enable row level security;
alter table public.user_coach_messages enable row level security;
revoke all on table public.user_coach_conversations from anon, authenticated;
revoke all on table public.user_coach_messages from anon, authenticated;
grant select, insert, update, delete on table public.user_coach_conversations to service_role;
grant select, insert, update, delete on table public.user_coach_messages to service_role;

comment on table public.user_coach_conversations is
  'Coach chat: each athlete''s conversation with each coach (one row per user_id and coach). Written only by the backend.';
comment on column public.user_coach_conversations.conversation is 'The conversation in use, as the athlete''s devices name it.';
comment on column public.user_coach_conversations.reset_at is 'When the athlete last started over ("New chat" or "Clear history"); null if never.';
comment on table public.user_coach_messages is
  'Coach chat messages, typed and said on voice calls: the newest 50 of each athlete''s conversation with each coach. Written only by the backend.';
comment on column public.user_coach_messages.message_id is 'The message''s id on the athlete''s devices.';
comment on column public.user_coach_messages.voice is 'True for a coach reply said on a voice call.';
comment on column public.user_coach_messages.plan is 'For a coach reply that prescribes sessions: which kinds (swim, gym or both).';
comment on column public.user_coach_messages.sent_at is 'When it was written, by the clock of the device it was written on.';

-- Make the Supabase API see the new tables straight away (otherwise it can report them missing until its cache refreshes).
notify pgrst, 'reload schema';

-- Reading them (paste into the SQL editor):
--
-- How many athletes have saved chats, and how many messages:
--   select count(distinct user_id) as athletes, count(*) as messages from public.user_coach_messages;
--
-- One athlete's conversation, oldest first (put their email in):
--   select m.coach, m.role, m.voice, m.sent_at, m.content
--   from public.user_coach_messages m
--   join public.user_profiles p on p.id = m.user_id
--   join auth.users u on u.id = p.auth_user_id
--   where u.email = 'athlete@example.com'
--   order by m.coach, m.sent_at;
