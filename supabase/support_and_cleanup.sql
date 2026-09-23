-- =====================================================================
--  TAHMİN10 — güncelleme 2: support tickets + automatic data clean-up.
--  Run ONCE in Supabase → SQL Editor. Safe to run again.
--  (Already included at the end of schema.sql for new installs.)
-- =====================================================================

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
