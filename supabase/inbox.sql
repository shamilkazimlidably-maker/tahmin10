-- =====================================================================
--  TAHMİN10 — güncelleme 6: GELEN KUTUSU (insan operatör modu: mesajlar panele düşer, oradan cevaplanır).
--  Supabase → SQL Editor'de BİR KEZ çalıştırın. Tekrar çalıştırmak güvenlidir.
-- =====================================================================

-- Konuşma üst bilgileri
alter table leads add column if not exists unread_count integer not null default 0;
alter table leads add column if not exists last_message_at timestamptz;
alter table leads add column if not exists last_message_preview text;
alter table leads add column if not exists last_agent_reply_at timestamptz;
alter table leads add column if not exists inbox_status text not null default 'open';   -- open | closed
alter table leads add column if not exists tags text[] not null default '{}';
alter table leads add column if not exists starred boolean not null default false;
alter table leads add column if not exists note text;
alter table leads add column if not exists last_notified_at timestamptz;
create index if not exists leads_inbox_idx on leads (inbox_status, last_message_at desc);

-- Mesajlara medya ve gönderen bilgisi (ses, fotoğraf, video, dosya panelden görülür/dinlenir)
alter table messages add column if not exists media_type text;      -- photo | voice | audio | video | video_note | document | sticker
alter table messages add column if not exists media_file_id text;   -- Telegram file_id (panel /api/admin/media ile indirir)
alter table messages add column if not exists media_name text;      -- dosya adı / mime
alter table messages add column if not exists agent text;           -- 'agent' (panelden insan), null = bot/yapay zekâ

-- Etiketler (klasör gibi)
create table if not exists inbox_tags (
  id bigint generated always as identity primary key,
  name text not null unique,
  color text not null default '#1f6fd1',
  position integer not null default 0,
  created_at timestamptz not null default now()
);

-- Hazır cevaplar (şablonlar). "/" ile editörde aranır.
create table if not exists canned_replies (
  id bigint generated always as identity primary key,
  title text not null,
  shortcut text,                 -- ör. "selam" → /selam
  text text not null,
  action text,                   -- null | invite | plans  (gönderirken düğme ekler)
  category text not null default '',
  uses integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table inbox_tags enable row level security;
alter table canned_replies enable row level security;

insert into inbox_tags (name, color, position) values ('sıcak', '#c0392b', 1), ('vip-sordu', '#b59500', 2), ('fiyat-itirazı', '#7a4fd1', 3), ('güven-sorunu', '#e09b00', 4), ('takip-et', '#1f6fd1', 5), ('müşteri', '#0b7a3b', 6)
on conflict (name) do nothing;

insert into canned_replies (title, shortcut, text, action, category) values
 ('Selam + kanal daveti', 'selam', 'Selam{name}! 👋 Hoş geldin. Ücretsiz kanala aşağıdaki düğmeden katılabilirsin; her gün veriye dayalı 1 tahmin paylaşıyoruz.', 'invite', 'giriş'),
 ('Kanala hoş geldin', 'hosgeldin', 'Kanala hoş geldin 🙌 Bugünün tahmini kanalda. Hangi takımı tutuyorsun, bu hafta hangi maçlara bakıyorsun?', null, 'giriş'),
 ('VIP nedir', 'vip', 'VIP''de günün eksiksiz seçkisini alıyorsun: günde 8–10 tahmin, farklı marketler, uygun olduğunda kombine. Ücretsiz kanaldaki tahminle aynı yöntem; fark hacim. Planları göndereyim mi?', null, 'satış'),
 ('Planları gönder', 'planlar', 'Planlar aşağıda 👇 Hepsi aynı VIP erişimi, sadece süre değişiyor. Abonelik otomatik yenilenir, Whop''tan istediğin an iptal edebilirsin.', 'plans', 'satış'),
 ('Güven itirazı', 'guven', 'Temkinli olman çok normal, bu piyasa "banko" vaatleriyle dolu. Biz garanti vermiyoruz; tahmin veriye dayalı bir görüştür. Birkaç gün ücretsiz kanalı takip et, kararını hiç para ödemeden ver.', null, 'itiraz'),
 ('Fiyat itirazı', 'fiyat', 'Anlıyorum. Haftalık planla 7 gün deneyip sana uyup uymadığına bakabilirsin; uymazsa uzatmazsın. Ücretsiz kanal da her zaman açık.', null, 'itiraz'),
 ('Sonra bakarım', 'sonra', 'Tamam, acele yok 🙂 Ücretsiz kanal senin için orada. Aklına bir şey takılırsa buradan yaz.', null, 'itiraz'),
 ('Ödeme nasıl', 'odeme', 'Ödeme Whop üzerinden kartla, Türk lirasıyla; kart bilgin bize ulaşmaz. Onaylanınca VIP linki buradan hemen gelir. İstediğin an Whop hesabından iptal edebilirsin.', 'plans', 'satış')
on conflict do nothing;
