-- =====================================================================
--  TAHMİN10 — güncelleme 4: ziyaretçi filtresi (bot / ülke ayrımı, sayfa ziyaret kaydı).
--  Supabase → SQL Editor'de BİR KEZ çalıştırın. Tekrar çalıştırmak güvenlidir.
-- =====================================================================

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
