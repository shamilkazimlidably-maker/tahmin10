-- =====================================================================
--  İSTEĞE BAĞLI ama zamanlanmış paylaşımlar için GEREKLİ: Supabase her dakika siteye
--  "sırası gelen paylaşım var mı?" diye sorar. (Ücretsiz Vercel planında dakikalık cron yoktur.)
--  YOUR-DOMAIN ve YOUR_CRON_SECRET yerlerini doldurup Supabase → SQL Editor'de bir kez çalıştırın.
-- =====================================================================
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule(jobname) from cron.job where jobname in ('tahmin10-posts');

select cron.schedule(
  'tahmin10-posts',
  '* * * * *',
  $$ select net.http_get(url := 'https://YOUR-DOMAIN/api/cron/posts?secret=YOUR_CRON_SECRET', timeout_milliseconds := 60000) $$
);

-- Kontrol:  select * from cron.job;
-- Kaldırmak için:  select cron.unschedule('tahmin10-posts');
