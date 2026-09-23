-- =====================================================================
--  TAHMİN10 — yönetim paneli eklentisi. Run ONCE in Supabase → SQL Editor.
--  (Already included at the end of schema.sql for new installs.)
-- =====================================================================
create table if not exists conversation_reviews (
  lead_id uuid primary key references leads (id) on delete cascade,
  rating integer not null check (rating between 1 and 5),
  note text,
  used_in_batch bigint references learning_batches (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table conversation_reviews enable row level security;
