-- =====================================================================
--  TAHMİN10 — güncelleme 5: kanal paylaşımları (post oluşturma, zamanlama, şablonlar, post bazlı satış takibi).
--  Supabase → SQL Editor'de BİR KEZ çalıştırın. Tekrar çalıştırmak güvenlidir.
-- =====================================================================

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
