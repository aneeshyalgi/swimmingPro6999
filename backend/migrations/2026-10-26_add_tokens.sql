-- Tokens (backend/app/tokens.py): every AI feature costs tokens, for accounts made from 26 October 2026 (which accounts
-- use them is decided there: older ones are never charged). A subscription comes with a month's tokens, and
-- everyone's month's tokens renew on the 26th (what's left of a month never carries over). Tokens bought in the
-- dashboard's token store come on top and last two months from purchase. Spending uses whichever tokens run out first.
--   user_token_wallets: one row per athlete: the day their monthly tokens renew on (26 October 2026, monthly, for all).
--   user_token_lots: each month's tokens, each purchase (and any tokens given by SwimGPT): how many, how many are left,
--     and until when they can be spent.
--   user_token_spends: what each AI request cost, and from which lots, so a request that then fails gets its tokens back.
--     A request is charged once however often it's sent (its ref). Kept for 180 days.
--   user_token_purchases: token store checkouts, "pending" until Stripe confirms payment.
-- The functions below change a balance in one step each, with the athlete's wallet row locked, so two requests at once
-- can never spend the same tokens. Only the backend (secret key) can use the tables and functions: row level security
-- is on with no policies, and the public API roles have no access.
-- Deleting an athlete's profile deletes all of it.
-- Run once in the Supabase SQL editor. Safe to re-run. It adds these tables and functions and changes no existing table
-- or row. Until it has run, every AI feature stays free, exactly as before.

create table if not exists public.user_token_wallets (
  user_id uuid primary key references public.user_profiles(id) on delete cascade,
  anchor timestamptz not null,
  created_at timestamptz not null default now()
);

create table if not exists public.user_token_lots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.user_profiles(id) on delete cascade,
  kind text not null check (kind in ('monthly', 'bought', 'gift')),
  ref text not null check (char_length(ref) between 1 and 200),
  amount integer not null check (amount > 0),
  remaining integer not null check (remaining between 0 and amount),
  starts_at timestamptz not null,
  expires_at timestamptz not null check (expires_at > starts_at),
  created_at timestamptz not null default now()
);

create table if not exists public.user_token_spends (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.user_profiles(id) on delete cascade,
  ref text not null check (char_length(ref) between 1 and 200),
  action text not null check (char_length(action) between 1 and 40),
  amount integer not null check (amount > 0),
  lots jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  returned_at timestamptz
);

create table if not exists public.user_token_purchases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.user_profiles(id) on delete cascade,
  stripe_checkout_session_id text not null unique,
  pack text not null check (char_length(pack) between 1 and 40),
  tokens integer not null check (tokens > 0),
  amount integer not null check (amount >= 0),
  currency text not null,
  status text not null default 'pending' check (status in ('pending', 'paid')),
  created_at timestamptz not null default now(),
  paid_at timestamptz
);

-- A month's tokens, a purchase or a request is recorded once, however often it's sent.
create unique index if not exists idx_user_token_lots_ref on public.user_token_lots (user_id, ref);
create index if not exists idx_user_token_lots_expiry on public.user_token_lots (user_id, expires_at);
create unique index if not exists idx_user_token_spends_ref on public.user_token_spends (user_id, ref);
create index if not exists idx_user_token_spends_recent on public.user_token_spends (user_id, created_at desc);
create index if not exists idx_user_token_purchases_user on public.user_token_purchases (user_id, status);

alter table public.user_token_wallets enable row level security;
alter table public.user_token_lots enable row level security;
alter table public.user_token_spends enable row level security;
alter table public.user_token_purchases enable row level security;
revoke all on table public.user_token_wallets from anon, authenticated;
revoke all on table public.user_token_lots from anon, authenticated;
revoke all on table public.user_token_spends from anon, authenticated;
revoke all on table public.user_token_purchases from anon, authenticated;
grant select, insert, update, delete on table public.user_token_wallets to service_role;
grant select, insert, update, delete on table public.user_token_lots to service_role;
grant select, insert, update, delete on table public.user_token_spends to service_role;
grant select, insert, update, delete on table public.user_token_purchases to service_role;

-- The month of a wallet renewing on `p_anchor` that `p_at` falls in. A month that has no such day (the 31st, say) starts
-- on its last day instead.
create or replace function public.swimgpt_token_month(p_anchor timestamptz, p_at timestamptz,
  out period_start timestamptz, out period_end timestamptz)
language plpgsql stable set search_path = public as $$
declare
  anchor_utc timestamp := p_anchor at time zone 'UTC';
  at_utc timestamp := p_at at time zone 'UTC';
  months integer;
begin
  months := (extract(year from at_utc)::integer - extract(year from anchor_utc)::integer) * 12
          + (extract(month from at_utc)::integer - extract(month from anchor_utc)::integer);
  if anchor_utc + make_interval(months => months) > at_utc then
    months := months - 1;
  end if;
  months := greatest(months, 0);
  period_start := (anchor_utc + make_interval(months => months)) at time zone 'UTC';
  period_end := (anchor_utc + make_interval(months => months + 1)) at time zone 'UTC';
end $$;

-- The athlete's wallet, made on first use, locked until the calling statement's transaction ends, with this month's
-- tokens (`p_monthly`, when above 0) added once. Returns this month.
create or replace function public.swimgpt_token_wallet(p_user uuid, p_monthly integer,
  out period_start timestamptz, out period_end timestamptz)
language plpgsql set search_path = public as $$
declare
  wallet_anchor timestamptz;
begin
  -- Everyone's tokens began on 26 October 2026, whenever they joined or first use them: every athlete's month runs from
  -- the 26th to the 26th.
  insert into user_token_wallets (user_id, anchor)
  values (p_user, '2026-10-26T00:00:00Z')
  on conflict (user_id) do nothing;
  -- One change at a time per athlete: each waits here for the one before it.
  select anchor into wallet_anchor from user_token_wallets where user_id = p_user for update;
  select renewal.period_start, renewal.period_end into period_start, period_end
    from swimgpt_token_month(wallet_anchor, now()) renewal;
  if p_monthly > 0 then
    insert into user_token_lots (user_id, kind, ref, amount, remaining, starts_at, expires_at)
    values (p_user, 'monthly', 'monthly:' || to_char(period_start at time zone 'UTC', 'YYYY-MM-DD'), p_monthly, p_monthly,
            period_start, period_end)
    on conflict (user_id, ref) do nothing;
  end if;
  -- What's long over goes: spends and spent-out lots 180 days on.
  delete from user_token_spends where user_id = p_user and created_at < now() - interval '180 days';
  delete from user_token_lots where user_id = p_user and expires_at < now() - interval '180 days';
end $$;

-- Spends `p_amount` tokens on an AI request (`p_ref`, its own id; `p_action`, what it is), from the tokens that expire
-- first. {"ok": true, "balance"} once spent (also when the same request was already paid for: "repeat"), or
-- {"ok": false, "balance", "renews_at"} with nothing spent when there aren't enough.
create or replace function public.swimgpt_spend_tokens(p_user uuid, p_ref text, p_action text, p_amount integer, p_monthly integer)
returns jsonb language plpgsql set search_path = public as $$
declare
  this_month record;
  earlier user_token_spends%rowtype;
  available integer;
  owed integer := p_amount;
  taken integer;
  drawn jsonb := '[]'::jsonb;
  lot record;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'A spend needs a positive amount of tokens';
  end if;
  select * into this_month from swimgpt_token_wallet(p_user, p_monthly);
  select * into earlier from user_token_spends where user_id = p_user and ref = p_ref;
  select coalesce(sum(remaining), 0) into available from user_token_lots
   where user_id = p_user and remaining > 0 and expires_at > now();
  if earlier.id is not null and earlier.returned_at is null then
    return jsonb_build_object('ok', true, 'repeat', true, 'balance', available);
  end if;
  if available < p_amount then
    return jsonb_build_object('ok', false, 'balance', available, 'renews_at', this_month.period_end);
  end if;
  for lot in
    select id, remaining from user_token_lots
     where user_id = p_user and remaining > 0 and expires_at > now()
     order by expires_at, (kind <> 'monthly'), created_at
     for update
  loop
    exit when owed = 0;
    taken := least(owed, lot.remaining);
    update user_token_lots set remaining = remaining - taken where id = lot.id;
    drawn := drawn || jsonb_build_array(jsonb_build_object('lot', lot.id, 'amount', taken));
    owed := owed - taken;
  end loop;
  if earlier.id is not null then
    -- Its tokens were given back when it failed; asked again, it's paid for again.
    update user_token_spends set action = p_action, amount = p_amount, lots = drawn, created_at = now(), returned_at = null
     where id = earlier.id;
  else
    insert into user_token_spends (user_id, ref, action, amount, lots) values (p_user, p_ref, p_action, p_amount, drawn);
  end if;
  return jsonb_build_object('ok', true, 'repeat', false, 'balance', available - p_amount);
end $$;

-- Gives a request's tokens back to the lots they came from (its AI work failed). Once only: {"returned": false} when
-- there was nothing to give back.
create or replace function public.swimgpt_return_tokens(p_user uuid, p_ref text)
returns jsonb language plpgsql set search_path = public as $$
declare
  spent user_token_spends%rowtype;
  part jsonb;
begin
  perform 1 from user_token_wallets where user_id = p_user for update;
  select * into spent from user_token_spends where user_id = p_user and ref = p_ref;
  if spent.id is null or spent.returned_at is not null then
    return jsonb_build_object('returned', false);
  end if;
  for part in select value from jsonb_array_elements(spent.lots) loop
    update user_token_lots set remaining = least(amount, remaining + (part->>'amount')::integer)
     where id = (part->>'lot')::uuid and user_id = p_user;
  end loop;
  update user_token_spends set returned_at = now() where id = spent.id;
  return jsonb_build_object('returned', true);
end $$;

-- Adds `p_amount` tokens that last `p_months` months from now: a purchase ('bought') or tokens given by SwimGPT
-- ('gift'). Once per `p_ref`: {"credited": false} when they were already added.
create or replace function public.swimgpt_credit_tokens(p_user uuid, p_kind text, p_ref text, p_amount integer, p_months integer)
returns jsonb language plpgsql set search_path = public as $$
declare
  added uuid;
begin
  if p_kind not in ('bought', 'gift') then
    raise exception 'Tokens can only be credited as bought or gift, not %', p_kind;
  end if;
  perform swimgpt_token_wallet(p_user, 0);
  insert into user_token_lots (user_id, kind, ref, amount, remaining, starts_at, expires_at)
  values (p_user, p_kind, p_ref, p_amount, p_amount, now(),
          ((now() at time zone 'UTC') + make_interval(months => p_months)) at time zone 'UTC')
  on conflict (user_id, ref) do nothing
  returning id into added;
  return jsonb_build_object('credited', added is not null);
end $$;

-- The athlete's tokens (with this month's added if they're new): this month, every lot that can still be spent (or was
-- this month's), and their latest 25 spends, newest first.
create or replace function public.swimgpt_tokens(p_user uuid, p_monthly integer)
returns jsonb language plpgsql set search_path = public as $$
declare
  this_month record;
begin
  select * into this_month from swimgpt_token_wallet(p_user, p_monthly);
  return jsonb_build_object(
    'period_start', this_month.period_start,
    'period_end', this_month.period_end,
    'lots', coalesce((
      select jsonb_agg(jsonb_build_object('kind', kind, 'amount', amount, 'remaining', remaining, 'starts_at', starts_at,
                                          'expires_at', expires_at) order by expires_at, created_at)
        from user_token_lots where user_id = p_user and expires_at > now()), '[]'::jsonb),
    'recent', coalesce((
      select jsonb_agg(jsonb_build_object('action', action, 'amount', amount, 'at', created_at,
                                          'returned', returned_at is not null) order by created_at desc)
        from (select action, amount, created_at, returned_at from user_token_spends
               where user_id = p_user order by created_at desc limit 25) latest), '[]'::jsonb));
end $$;

revoke all on function public.swimgpt_token_month(timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.swimgpt_token_wallet(uuid, integer) from public, anon, authenticated;
revoke all on function public.swimgpt_spend_tokens(uuid, text, text, integer, integer) from public, anon, authenticated;
revoke all on function public.swimgpt_return_tokens(uuid, text) from public, anon, authenticated;
revoke all on function public.swimgpt_credit_tokens(uuid, text, text, integer, integer) from public, anon, authenticated;
revoke all on function public.swimgpt_tokens(uuid, integer) from public, anon, authenticated;
grant execute on function public.swimgpt_token_month(timestamptz, timestamptz) to service_role;
grant execute on function public.swimgpt_token_wallet(uuid, integer) to service_role;
grant execute on function public.swimgpt_spend_tokens(uuid, text, text, integer, integer) to service_role;
grant execute on function public.swimgpt_return_tokens(uuid, text) to service_role;
grant execute on function public.swimgpt_credit_tokens(uuid, text, text, integer, integer) to service_role;
grant execute on function public.swimgpt_tokens(uuid, integer) to service_role;

comment on table public.user_token_wallets is 'Tokens: one row per athlete. Written only by the backend.';
comment on column public.user_token_wallets.anchor is 'The day the athlete''s monthly tokens renew on: 26 October 2026 (UTC), monthly, for every athlete.';
comment on table public.user_token_lots is 'Tokens: each month''s, each purchase''s and any given by SwimGPT, with how many are left. Written only by the backend.';
comment on column public.user_token_lots.kind is 'monthly: a month''s tokens; bought: from the token store; gift: given by SwimGPT.';
comment on column public.user_token_lots.ref is 'monthly:<first day of the month>, bought:<Stripe Checkout Session id>, or gift:<anything>.';
comment on table public.user_token_spends is 'Tokens: what each AI request cost, and from which lots. Written only by the backend.';
comment on column public.user_token_spends.returned_at is 'When its tokens were given back because the request failed.';
comment on table public.user_token_purchases is 'Token store checkouts: pending until Stripe confirms the payment. Written only by the backend.';

-- Make the Supabase API see the new tables and functions straight away.
notify pgrst, 'reload schema';

-- Reading them (paste into the SQL editor):
--
-- An athlete's tokens (put their email in):
--   select l.kind, l.amount, l.remaining, l.expires_at
--   from public.user_token_lots l
--   join public.user_profiles p on p.id = l.user_id
--   join auth.users u on u.id = p.auth_user_id
--   where u.email = 'athlete@example.com' and l.expires_at > now()
--   order by l.expires_at;
--
-- Giving an athlete 50 tokens that last 2 months (say, to make up for a problem; change the gift name each time):
--   select public.swimgpt_credit_tokens(p.id, 'gift', 'gift:2026-10-26-apology', 50, 2)
--   from public.user_profiles p join auth.users u on u.id = p.auth_user_id
--   where u.email = 'athlete@example.com';
--
-- Token store sales:
--   select count(*) as purchases, sum(amount) / 100.0 as dollars from public.user_token_purchases where status = 'paid';
