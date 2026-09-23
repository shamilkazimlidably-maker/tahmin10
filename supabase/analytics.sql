-- =====================================================================
--  TAHMİN10 — güncelleme 3: analytics dashboard (ad spend, daily snapshots).
--  Run ONCE in Supabase → SQL Editor. Safe to run again.
-- =====================================================================

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
