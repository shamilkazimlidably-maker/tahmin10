-- =====================================================================
--  TAHMİN10 — veritabanı şeması
--  Supabase → SQL Editor → paste this whole file → Run.
--  Safe to run again: it never drops data.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
--  LEADS — one row per person
-- ---------------------------------------------------------------------
create table if not exists leads (
  id uuid primary key default gen_random_uuid(),
  start_token text not null unique,
  visitor_id text,
  telegram_user_id text,
  chat_id text,
  first_name text,
  username text,
  language_code text,

  source text,
  medium text,
  campaign text,
  adset text,
  ad text,
  fbclid text,
  meta_fbc text,
  meta_fbp text,
  client_ip text,
  user_agent text,
  landing_url text,

  stage text not null default 'NEW',
  score integer not null default 0,
  playbook_version integer,

  user_turns integer not null default 0,
  pre_free_turns integer not null default 0,
  post_free_turns integer not null default 0,
  eligible_turns integer not null default 0,

  free_channel_invited boolean not null default false,
  free_channel_invited_at timestamptz,
  free_channel_joined boolean not null default false,
  free_channel_joined_at timestamptz,

  vip_offer_count integer not null default 0,
  vip_offer_last_at timestamptz,
  plans_shown_count integer not null default 0,

  checkout_started boolean not null default false,
  checkout_started_at timestamptz,
  last_checkout_plan text,

  paid boolean not null default false,
  paid_at timestamptz,
  first_paid_plan text,
  total_revenue numeric(12,2) not null default 0,
  currency text,
  vip_active boolean not null default false,
  vip_access_sent boolean not null default false,
  whop_membership_id text,
  whop_user_id text,
  refunded boolean not null default false,

  opted_out boolean not null default false,
  do_not_sell boolean not null default false,
  do_not_sell_reason text,
  blocked boolean not null default false,
  needs_human boolean not null default false,

  followup_count integer not null default 0,
  followups_since_reply integer not null default 0,
  followups_sent jsonb not null default '[]'::jsonb,
  last_followup_at timestamptz,

  last_user_message_at timestamptz,
  last_bot_message_at timestamptz,

  outcome text check (outcome in ('won', 'lost')),
  outcome_reason text,
  closed_at timestamptz,
  analyzed_at timestamptz,

  lock_until timestamptz,
  merged_into uuid references leads (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists leads_telegram_user_uidx on leads (telegram_user_id) where telegram_user_id is not null and merged_into is null;
create index if not exists leads_visitor_idx on leads (visitor_id, created_at desc) where visitor_id is not null;
create index if not exists leads_membership_idx on leads (whop_membership_id) where whop_membership_id is not null;
create index if not exists leads_followup_idx on leads (updated_at) where paid = false and chat_id is not null;
create index if not exists leads_learning_idx on leads (closed_at) where outcome is not null and analyzed_at is null;
create index if not exists leads_checkout_idx on leads (checkout_started_at desc) where checkout_started = true and paid = false;
create index if not exists leads_created_idx on leads (created_at desc);

create table if not exists lead_profiles (
  lead_id uuid primary key references leads (id) on delete cascade,
  favorite_team text,
  leagues jsonb not null default '[]'::jsonb,
  prediction_usage text,
  wants jsonb not null default '[]'::jsonb,
  pain_points jsonb not null default '[]'::jsonb,
  objections jsonb not null default '[]'::jsonb,
  style text,
  notes text,
  segment text,
  updated_at timestamptz not null default now()
);

create table if not exists lead_signals (
  lead_id uuid not null references leads (id) on delete cascade,
  key text not null,
  value numeric(3,2) not null default 0,
  evidence text,
  source text not null default 'ai',
  updated_at timestamptz not null default now(),
  primary key (lead_id, key)
);

-- ---------------------------------------------------------------------
--  CONVERSATION
-- ---------------------------------------------------------------------
create table if not exists messages (
  id bigint generated always as identity primary key,
  lead_id uuid not null references leads (id) on delete cascade,
  role text not null check (role in ('user', 'assistant', 'event')),
  content text not null,
  telegram_message_id bigint,
  created_at timestamptz not null default now()
);
create index if not exists messages_lead_idx on messages (lead_id, id);
-- A Telegram retry can never store the same customer message twice.
create unique index if not exists messages_telegram_uidx on messages (lead_id, telegram_message_id) where telegram_message_id is not null;

create table if not exists sales_events (
  id bigint generated always as identity primary key,
  lead_id uuid references leads (id) on delete cascade,
  name text not null,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists sales_events_name_idx on sales_events (name, created_at desc);
create index if not exists sales_events_lead_idx on sales_events (lead_id, created_at desc);

-- ---------------------------------------------------------------------
--  MONEY
-- ---------------------------------------------------------------------
create table if not exists checkouts (
  id bigint generated always as identity primary key,
  lead_id uuid not null references leads (id) on delete cascade,
  plan text not null,
  whop_checkout_id text,
  purchase_url text not null,
  via text not null default 'api',          -- 'api' (carries lead metadata) | 'static' (plain link)
  created_at timestamptz not null default now()
);
create index if not exists checkouts_lead_idx on checkouts (lead_id, plan, created_at desc);

create table if not exists payments (
  id bigint generated always as identity primary key,
  whop_payment_id text not null unique,
  lead_id uuid references leads (id) on delete set null,
  whop_membership_id text,
  whop_plan_id text,
  plan_key text,
  amount numeric(12,2) not null default 0,
  currency text,
  billing_reason text,
  is_first boolean not null default false,
  matched_by text,                           -- 'metadata' | 'membership' | 'recent_checkout' | 'admin' | null = unlinked
  email text,
  status text not null default 'paid',       -- 'paid' | 'refunded'
  raw jsonb,
  created_at timestamptz not null default now(),
  refunded_at timestamptz
);
create index if not exists payments_lead_idx on payments (lead_id);

create table if not exists webhook_events (
  id text primary key,                       -- the "webhook-id" header
  type text,
  status text not null default 'received',   -- received | processed | failed
  error text,
  payload jsonb,
  created_at timestamptz not null default now(),
  processed_at timestamptz
);

create table if not exists telegram_updates (
  update_id bigint primary key,
  status text not null default 'processing', -- processing | done | failed
  reply_sent boolean not null default false,
  attempts integer not null default 1,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
--  LEARNING
-- ---------------------------------------------------------------------
create table if not exists learning_batches (
  id bigint generated always as identity primary key,
  sample_size integer not null default 0,
  won_count integer not null default 0,
  conversion_rate numeric(6,4) not null default 0,
  playbook_version_before integer,
  playbook_version_after integer,
  summary text,
  biggest_leak text,
  changes jsonb not null default '[]'::jsonb,
  raw_output jsonb,
  result text,                               -- proposed | active | unchanged | rejected
  problems jsonb,
  created_at timestamptz not null default now()
);

create table if not exists conversation_analyses (
  lead_id uuid primary key references leads (id) on delete cascade,
  outcome text not null,
  loss_reason text,
  drop_stage text,
  segment text,
  objections jsonb not null default '[]'::jsonb,
  buying_signals jsonb not null default '[]'::jsonb,
  missed_signals jsonb not null default '[]'::jsonb,
  agent_mistakes jsonb not null default '[]'::jsonb,
  what_worked jsonb not null default '[]'::jsonb,
  quality_detail jsonb,
  conversation_quality integer,
  summary text,
  user_messages integer not null default 0,
  playbook_version integer,
  batch_id bigint references learning_batches (id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists analyses_pending_idx on conversation_analyses (created_at) where batch_id is null;

create table if not exists playbooks (
  id bigint generated always as identity primary key,
  version integer not null unique,
  status text not null check (status in ('proposed', 'active', 'retired', 'rejected')),
  content jsonb not null,
  summary text,
  created_by text not null default 'coach',
  based_on_batch bigint references learning_batches (id) on delete set null,
  created_at timestamptz not null default now(),
  activated_at timestamptz,
  retired_at timestamptz
);
-- Version 1 is the hand-written playbook in src/learning/playbook.ts (used while this table has no active row).

create table if not exists experiments (
  id bigint generated always as identity primary key,
  slot text not null,
  name text not null,
  hypothesis text,
  metric text not null default 'purchase',
  variants jsonb not null,
  status text not null default 'draft' check (status in ('draft', 'running', 'won', 'inconclusive', 'stopped')),
  min_sample integer not null default 50,
  max_sample integer not null default 400,
  winner text,
  p_value numeric,
  results jsonb,
  created_by text not null default 'admin',
  created_at timestamptz not null default now(),
  started_at timestamptz,
  ended_at timestamptz
);

create table if not exists experiment_assignments (
  experiment_id bigint not null references experiments (id) on delete cascade,
  lead_id uuid not null references leads (id) on delete cascade,
  variant text not null check (variant in ('A', 'B')),
  exposed boolean not null default false,
  exposed_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (experiment_id, lead_id)
);
create index if not exists assignments_lead_idx on experiment_assignments (lead_id);

-- ---------------------------------------------------------------------
--  INFRA
-- ---------------------------------------------------------------------
create table if not exists rate_limits (
  key text primary key,
  window_start timestamptz not null default now(),
  count integer not null default 0
);

create table if not exists app_state (
  key text primary key,
  value jsonb,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
--  FUNCTIONS
-- ---------------------------------------------------------------------

-- Two quick messages from the same person must not be answered in parallel.
create or replace function acquire_lead_lock(p_lead_id uuid, p_seconds integer)
returns boolean language plpgsql as $$
declare got uuid;
begin
  update leads
     set lock_until = now() + make_interval(secs => p_seconds)
   where id = p_lead_id and (lock_until is null or lock_until < now())
  returning id into got;
  return got is not null;
end $$;

-- Fixed-window rate limiter. true = allowed.
create or replace function check_rate_limit(p_key text, p_limit integer, p_window_seconds integer)
returns boolean language plpgsql as $$
declare current_count integer;
begin
  insert into rate_limits as r (key, window_start, count)
  values (p_key, now(), 1)
  on conflict (key) do update
     set count = case when r.window_start < now() - make_interval(secs => p_window_seconds) then 1 else r.count + 1 end,
         window_start = case when r.window_start < now() - make_interval(secs => p_window_seconds) then now() else r.window_start end
  returning count into current_count;

  if random() < 0.02 then
    delete from rate_limits where window_start < now() - interval '1 day';
    delete from telegram_updates where created_at < now() - interval '14 days';
  end if;
  return current_count <= p_limit;
end $$;

-- Funnel of the leads CREATED since p_since (null = all time).
create or replace function funnel_stats(p_since timestamptz default null)
returns json language sql stable as $$
  select json_build_object(
    'landing_leads',  count(*) filter (where landing_url is not null or visitor_id is not null),
    'started_bot',    count(*) filter (where telegram_user_id is not null),
    'replied',        count(*) filter (where user_turns > 0),
    'invited_free',   count(*) filter (where free_channel_invited),
    'joined_free',    count(*) filter (where free_channel_joined),
    'offered_vip',    count(*) filter (where vip_offer_count > 0),
    'saw_plans',      count(*) filter (where plans_shown_count > 0),
    'checkout',       count(*) filter (where checkout_started),
    'paid',           count(*) filter (where paid),
    'revenue',        coalesce(sum(total_revenue), 0),
    'not_interested', count(*) filter (where stage = 'NOT_INTERESTED'),
    'opted_out',      count(*) filter (where opted_out),
    'blocked',        count(*) filter (where blocked),
    'do_not_sell',    count(*) filter (where do_not_sell)
  )
  from leads
  where merged_into is null and (p_since is null or created_at >= p_since);
$$;

create or replace function campaign_stats(p_since timestamptz default null)
returns json language sql stable as $$
  select coalesce(json_agg(t), '[]'::json) from (
    select campaign, ad,
           count(*) as leads,
           count(*) filter (where telegram_user_id is not null) as started,
           count(*) filter (where free_channel_joined) as joined_free,
           count(*) filter (where checkout_started) as checkout,
           count(*) filter (where paid) as paid,
           coalesce(sum(total_revenue), 0) as revenue
      from leads
     where merged_into is null and (p_since is null or created_at >= p_since)
     group by campaign, ad
     order by count(*) desc
     limit 25
  ) t;
$$;

create or replace function objection_stats(p_since timestamptz default null)
returns json language sql stable as $$
  select coalesce(json_agg(t), '[]'::json) from (
    select e.data ->> 'type' as type,
           count(*) as mentions,
           count(distinct e.lead_id) as leads,
           count(distinct e.lead_id) filter (where l.paid) as paid_leads
      from sales_events e
      join leads l on l.id = e.lead_id
     where e.name = 'OBJECTION' and (p_since is null or e.created_at >= p_since)
     group by 1
     order by count(distinct e.lead_id) desc
  ) t;
$$;

create or replace function playbook_stats()
returns json language sql stable as $$
  select coalesce(json_agg(t), '[]'::json) from (
    select playbook_version,
           count(*) as leads,
           count(*) filter (where user_turns > 0) as replied,
           count(*) filter (where free_channel_joined) as joined_free,
           count(*) filter (where plans_shown_count > 0) as saw_plans,
           count(*) filter (where checkout_started) as checkout,
           count(*) filter (where paid) as paid,
           round(count(*) filter (where paid)::numeric / greatest(count(*), 1), 4) as paid_rate
      from leads
     where merged_into is null and playbook_version is not null
     group by playbook_version
     order by playbook_version
  ) t;
$$;

-- ---------------------------------------------------------------------
--  SECURITY — the app uses the SECRET (service role) key on the server only.
--  RLS is ON with no policies, so the public/anon key can read nothing.
-- ---------------------------------------------------------------------
alter table leads enable row level security;
alter table lead_profiles enable row level security;
alter table lead_signals enable row level security;
alter table messages enable row level security;
alter table sales_events enable row level security;
alter table checkouts enable row level security;
alter table payments enable row level security;
alter table webhook_events enable row level security;
alter table telegram_updates enable row level security;
alter table learning_batches enable row level security;
alter table conversation_analyses enable row level security;
alter table playbooks enable row level security;
alter table experiments enable row level security;
alter table experiment_assignments enable row level security;
alter table rate_limits enable row level security;
alter table app_state enable row level security;

revoke execute on function acquire_lead_lock(uuid, integer) from public, anon, authenticated;
revoke execute on function check_rate_limit(text, integer, integer) from public, anon, authenticated;
revoke execute on function funnel_stats(timestamptz) from public, anon, authenticated;
revoke execute on function campaign_stats(timestamptz) from public, anon, authenticated;
revoke execute on function objection_stats(timestamptz) from public, anon, authenticated;
revoke execute on function playbook_stats() from public, anon, authenticated;
grant execute on function acquire_lead_lock(uuid, integer) to service_role;
grant execute on function check_rate_limit(text, integer, integer) to service_role;
grant execute on function funnel_stats(timestamptz) to service_role;
grant execute on function campaign_stats(timestamptz) to service_role;
grant execute on function objection_stats(timestamptz) to service_role;
grant execute on function playbook_stats() to service_role;

-- ---------------------------------------------------------------------
--  SEED — two starting A/B tests (only when the table is empty).
--  Only NEW leads are enrolled. A winner needs 50 people per variant
--  AND statistical significance; see /experiments in the admin chat.
-- ---------------------------------------------------------------------
insert into experiments (slot, name, hypothesis, metric, variants, status, created_by, started_at)
select * from (values
  (
    'opening',
    'Açılış: tuttuğu takım mı, haftanın maçı mı',
    'Asking about the favourite team gets more replies than asking about this week''s games.',
    'reply',
    '[{"key":"A","instruction":"İlk mesajda kişinin hangi takımı tuttuğunu sor."},{"key":"B","instruction":"İlk mesajda bu hafta en çok hangi maçı takip etmek istediğini sor."}]'::jsonb,
    'running', 'admin', now()
  ),
  (
    'vip_transition',
    'VIP köprüsü: doğrudan mı, izin isteyerek mi',
    'Asking permission before explaining the VIP leads to more checkouts than explaining it right away.',
    'checkout',
    '[{"key":"A","instruction":"VIP köprüsünü kurarken kişinin aradığını söylediği şeyi tek cümlede VIP tam seçkisine bağla ve özünü hemen anlat."},{"key":"B","instruction":"VIP köprüsünü kurarken önce VIP nasıl işliyor anlatmamı isteyip istemediğini sor; ayrıntıya ancak evet dedikten sonra gir."}]'::jsonb,
    'running', 'admin', now()
  )
) as seed (slot, name, hypothesis, metric, variants, status, created_by, started_at)
where not exists (select 1 from experiments);

-- ---------------------------------------------------------------------
--  ADMIN PANEL — the owner's own ratings of conversations (fed to the Sales Coach)
-- ---------------------------------------------------------------------
create table if not exists conversation_reviews (
  lead_id uuid primary key references leads (id) on delete cascade,
  rating integer not null check (rating between 1 and 5),
  note text,
  used_in_batch bigint references learning_batches (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table conversation_reviews enable row level security;

-- ---------------------------------------------------------------------
--  UPDATE 2 — support tickets + automatic clean-up (same as support_and_cleanup.sql)
-- ---------------------------------------------------------------------
-- A customer sent a screenshot / asked for a human → the owner answers from Telegram.
create table if not exists support_tickets (
  id bigint generated always as identity primary key,
  lead_id uuid not null references leads (id) on delete cascade,
  status text not null default 'open' check (status in ('open', 'solved', 'expired')),
  reason text,
  last_activity_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  solved_at timestamptz
);
create index if not exists support_tickets_open_idx on support_tickets (lead_id) where status = 'open';

-- Which message in the OWNER's chat belongs to which ticket (so "reply" in Telegram just works).
create table if not exists support_admin_messages (
  message_id bigint primary key,
  ticket_id bigint not null references support_tickets (id) on delete cascade,
  mode text not null default 'reply',          -- 'reply' → goes to the customer · 'teach' → becomes bot knowledge
  created_at timestamptz not null default now()
);

alter table support_tickets enable row level security;
alter table support_admin_messages enable row level security;

-- ---------------------------------------------------------------------
--  Clean-up (runs every day from /api/cron/learning, AFTER conversations were analysed).
--  Deleted: old chat texts, raw logs, raw webhook payloads.
--  Kept:    leads + scores + profiles (funnel numbers), payments, analyses, your ratings,
--           playbooks, learning rounds, experiments, bot knowledge, settings.
-- ---------------------------------------------------------------------
create or replace function purge_old_data(p_message_days integer default 30, p_event_days integer default 30)
returns json language plpgsql as $$
declare n_messages bigint; n_events bigint; n_webhooks bigint; n_checkouts bigint; n_updates bigint;
begin
  delete from messages m using leads l
   where m.lead_id = l.id
     and m.created_at < now() - make_interval(days => p_message_days)
     -- never delete a transcript that the analyst has not read yet (with a 15-day safety net)
     and (l.analyzed_at is not null or l.created_at < now() - make_interval(days => p_message_days + 15));
  get diagnostics n_messages = row_count;

  delete from sales_events where created_at < now() - make_interval(days => p_event_days) and name <> 'OBJECTION';
  get diagnostics n_events = row_count;
  delete from sales_events where name = 'OBJECTION' and created_at < now() - interval '365 days';

  delete from webhook_events where created_at < now() - make_interval(days => p_event_days);
  get diagnostics n_webhooks = row_count;

  delete from checkouts where created_at < now() - make_interval(days => p_event_days);
  get diagnostics n_checkouts = row_count;

  delete from telegram_updates where created_at < now() - interval '7 days';
  get diagnostics n_updates = row_count;

  update payments set raw = null where raw is not null and lead_id is not null and created_at < now() - make_interval(days => p_event_days);
  update learning_batches set raw_output = null where raw_output is not null and created_at < now() - make_interval(days => p_event_days);
  delete from rate_limits where window_start < now() - interval '1 day';
  delete from support_admin_messages where created_at < now() - interval '45 days';
  delete from support_tickets where status <> 'open' and created_at < now() - interval '180 days';

  return json_build_object('messages', n_messages, 'events', n_events, 'webhooks', n_webhooks, 'checkouts', n_checkouts, 'telegram_updates', n_updates);
end $$;

create or replace function db_usage()
returns json language sql stable as $$
  select json_build_object(
    'bytes', pg_database_size(current_database()),
    'tables', (select coalesce(json_agg(t), '[]'::json) from (
        select c.relname as name, pg_total_relation_size(c.oid) as bytes, greatest(c.reltuples, 0)::bigint as rows
          from pg_class c join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public' and c.relkind = 'r'
         order by 2 desc limit 8) t));
$$;

revoke execute on function purge_old_data(integer, integer) from public, anon, authenticated;
revoke execute on function db_usage() from public, anon, authenticated;
grant execute on function purge_old_data(integer, integer) to service_role;
grant execute on function db_usage() to service_role;

-- ---------------------------------------------------------------------
--  UPDATE 3 — analytics (same as analytics.sql)
-- ---------------------------------------------------------------------
-- What you spent on ads (typed in the admin panel → Analiz). One row per day and campaign.
create table if not exists ad_spend (
  id bigint generated always as identity primary key,
  day date not null,
  campaign text not null default '',          -- '' = general / not tied to one campaign
  amount numeric(12,2) not null check (amount >= 0),
  note text,
  batch text not null,                        -- rows typed in together (a date range) share one batch id
  created_at timestamptz not null default now()
);
create index if not exists ad_spend_day_idx on ad_spend (day);

-- Tiny permanent snapshot of the funnel per arrival day and campaign (a few KB per month).
-- It survives deleting chats, leads or logs: numbers are only ever raised, never lowered.
create table if not exists daily_stats (
  day date not null,
  campaign text not null default '',
  clicks integer not null default 0,          -- tapped the button on the site
  started integer not null default 0,         -- started the bot            (Meta: Lead)
  replied integer not null default 0,
  joined_free integer not null default 0,     -- joined the free channel    (Meta: CompleteRegistration)
  saw_plans integer not null default 0,
  checkouts integer not null default 0,
  customers integer not null default 0,       -- paid at least once
  revenue numeric(12,2) not null default 0,   -- everything these people paid so far (their lifetime value)
  updated_at timestamptz not null default now(),
  primary key (day, campaign)
);

-- needed by analytics_extra() even if admin_panel.sql was never run
create table if not exists conversation_reviews (
  lead_id uuid primary key references leads (id) on delete cascade,
  rating integer not null check (rating between 1 and 5),
  note text,
  used_in_batch bigint references learning_batches (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table ad_spend enable row level security;
alter table daily_stats enable row level security;
alter table conversation_reviews enable row level security;

create or replace function refresh_daily_stats(p_days integer default 120)
returns integer language plpgsql as $$
declare n integer;
begin
  insert into daily_stats as d (day, campaign, clicks, started, replied, joined_free, saw_plans, checkouts, customers, revenue)
  select (created_at at time zone 'Europe/Istanbul')::date, coalesce(campaign, ''),
         count(*) filter (where landing_url is not null or visitor_id is not null),
         count(*) filter (where telegram_user_id is not null),
         count(*) filter (where user_turns > 0),
         count(*) filter (where free_channel_joined),
         count(*) filter (where plans_shown_count > 0),
         count(*) filter (where checkout_started),
         count(*) filter (where paid),
         coalesce(sum(total_revenue), 0)
    from leads
   where merged_into is null and created_at >= now() - make_interval(days => p_days)
   group by 1, 2
  on conflict (day, campaign) do update set
    clicks = greatest(d.clicks, excluded.clicks), started = greatest(d.started, excluded.started), replied = greatest(d.replied, excluded.replied),
    joined_free = greatest(d.joined_free, excluded.joined_free), saw_plans = greatest(d.saw_plans, excluded.saw_plans),
    checkouts = greatest(d.checkouts, excluded.checkouts), customers = greatest(d.customers, excluded.customers),
    revenue = greatest(d.revenue, excluded.revenue), updated_at = now();
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function analytics_extra()
returns json language sql stable as $$
  select json_build_object(
    'stages', (select coalesce(json_agg(t), '[]'::json) from (select stage as k, count(*) as v from leads where merged_into is null and telegram_user_id is not null group by 1 order by 2 desc) t),
    'scores', (select coalesce(json_agg(t), '[]'::json) from (select (least(score, 99) / 10) * 10 as k, count(*) as v from leads where merged_into is null and telegram_user_id is not null group by 1 order by 1) t),
    'days_to_buy', (select coalesce(json_agg(t), '[]'::json) from (select least(floor(extract(epoch from (paid_at - created_at)) / 86400)::int, 30) as k, count(*) as v from leads where paid and paid_at is not null group by 1 order by 1) t),
    'loss_reasons', (select coalesce(json_agg(t), '[]'::json) from (select coalesce(loss_reason, 'OTHER') as k, count(*) as v from conversation_analyses where outcome = 'lost' and user_messages > 0 group by 1 order by 2 desc) t),
    'drop_stages', (select coalesce(json_agg(t), '[]'::json) from (select coalesce(drop_stage, 'NONE') as k, count(*) as v from conversation_analyses where outcome = 'lost' and user_messages > 0 group by 1 order by 2 desc) t),
    'quality_weekly', (select coalesce(json_agg(t), '[]'::json) from (select date_trunc('week', created_at)::date as k, round(avg(conversation_quality)) as v, count(*) as n from conversation_analyses where user_messages > 0 and conversation_quality is not null and created_at > now() - interval '180 days' group by 1 order by 1) t),
    'segments', (select coalesce(json_agg(t), '[]'::json) from (select p.segment as k, count(*) as v, count(*) filter (where l.paid) as paid from lead_profiles p join leads l on l.id = p.lead_id where p.segment is not null and p.segment <> 'unknown' group by 1 order by 2 desc) t),
    'hours', (select coalesce(json_agg(t), '[]'::json) from (select extract(hour from created_at at time zone 'Europe/Istanbul')::int as k, count(*) as v from messages where role = 'user' and created_at > now() - interval '30 days' group by 1 order by 1) t),
    'owner_rating', (select json_build_object('avg', round(avg(rating)::numeric, 2), 'n', count(*)) from conversation_reviews),
    'totals', (select json_build_object('leads', count(*) filter (where telegram_user_id is not null), 'vip_active', count(*) filter (where vip_active), 'customers', count(*) filter (where paid),
                                        'opted_out', count(*) filter (where opted_out), 'blocked', count(*) filter (where blocked)) from leads where merged_into is null)
  );
$$;

revoke execute on function refresh_daily_stats(integer) from public, anon, authenticated;
revoke execute on function analytics_extra() from public, anon, authenticated;
grant execute on function refresh_daily_stats(integer) to service_role;
grant execute on function analytics_extra() to service_role;

-- ---------------------------------------------------------------------
--  GÜNCELLEME 4 — ziyaretçi filtresi (visitor_filter.sql ile aynı)
-- ---------------------------------------------------------------------
-- Her sayfa gösterimi: hangi sayfa gösterildi, neden, ülke, user-agent. IP tutulmaz. 60 gün sonra silinir.
create table if not exists page_visits (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  page text not null,          -- main | safe
  reason text not null,        -- ok | bot | country | no_country | forced | preview | disabled
  country text,
  ua text,
  referer text,
  campaign text,
  source text
);
create index if not exists page_visits_created_idx on page_visits (created_at desc);
alter table page_visits enable row level security;

-- ---------------------------------------------------------------------
--  GÜNCELLEME 5 — kanal paylaşımları (posts.sql ile aynı)
-- ---------------------------------------------------------------------
-- Ücretsiz / VIP kanala gönderilen (ya da zamanlanan) paylaşımlar.
-- Metin ve görsel gönderimden 1 saat sonra silinir; başlık, etiketler, mesaj kimliği ve SAYILAR kalır.
create table if not exists channel_posts (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  channel text not null check (channel in ('free', 'vip')),
  title text not null default '',
  tags text[] not null default '{}',
  text text,                                  -- Telegram-HTML
  media_type text check (media_type in ('photo', 'video')),
  media_path text,                            -- storage: post-media/<path>
  buttons jsonb not null default '[]',        -- [[{"text":"...","type":"plan|planlar|bot|url|free_channel|support","value":"..."}]]
  options jsonb not null default '{}',        -- {"silent":bool,"protect":bool,"pin":bool,"noPreview":bool}
  status text not null default 'draft' check (status in ('draft', 'scheduled', 'sending', 'sent', 'failed')),
  scheduled_at timestamptz,
  sent_at timestamptz,
  telegram_chat_id text,
  telegram_message_id bigint,
  error text,
  content_purged boolean not null default false,
  template_id bigint,
  starts integer not null default 0,          -- paylaşımdaki bir düğmeden botu başlatan kişi
  checkouts integer not null default 0,
  purchases integer not null default 0,
  revenue numeric(12,2) not null default 0
);
create index if not exists channel_posts_status_idx on channel_posts (status, scheduled_at);

-- Kalıcı şablonlar (metin + düğmeler + seçenekler; görsel yolu da kalıcı).
create table if not exists post_templates (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  channel text not null default 'free' check (channel in ('free', 'vip')),
  title text not null,
  tags text[] not null default '{}',
  text text not null,
  media_type text check (media_type in ('photo', 'video')),
  media_path text,
  buttons jsonb not null default '[]',
  options jsonb not null default '{}',
  uses integer not null default 0
);

-- Paylaşımdaki düğmeden botu başlatanlar (kim, hangi post, hangi düğme).
create table if not exists post_clicks (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  post_id bigint not null references channel_posts (id) on delete cascade,
  lead_id uuid not null references leads (id) on delete cascade,
  action text
);
create index if not exists post_clicks_lead_idx on post_clicks (lead_id, created_at desc);

-- Kişi nereden geldi: 'channel_post' = kanal paylaşımındaki düğmeden; yoksa reklam / doğrudan.
alter table leads add column if not exists origin text;
alter table leads add column if not exists origin_post_id bigint;
-- Ödeme hangi paylaşıma bağlandı (son 7 gün içindeki son düğme tıklaması).
alter table payments add column if not exists post_id bigint;

-- Paylaşım türü: 'message' (metin / görsel) ya da 'poll' (anket / bilgi yarışması).
alter table channel_posts add column if not exists kind text not null default 'message';
alter table channel_posts add column if not exists poll jsonb;
alter table post_templates add column if not exists kind text not null default 'message';
alter table post_templates add column if not exists poll jsonb;

alter table channel_posts enable row level security;
alter table post_templates enable row level security;
alter table post_clicks enable row level security;

-- Sayaçları atomik artırır.
create or replace function post_bump(p_id bigint, p_starts integer default 0, p_checkouts integer default 0, p_purchases integer default 0, p_revenue numeric default 0)
returns void language sql as $$
  update channel_posts
     set starts = starts + p_starts, checkouts = checkouts + p_checkouts, purchases = purchases + p_purchases, revenue = revenue + p_revenue, updated_at = now()
   where id = p_id;
$$;
revoke execute on function post_bump(bigint, integer, integer, integer, numeric) from public, anon, authenticated;
grant execute on function post_bump(bigint, integer, integer, integer, numeric) to service_role;

-- Görseller için herkese açık depolama alanı (nesne adları rastgeledir; gönderimden 1 saat sonra silinir).
insert into storage.buckets (id, name, public, file_size_limit)
values ('post-media', 'post-media', true, 20971520)
on conflict (id) do update set public = true;
