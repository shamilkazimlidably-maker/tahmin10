# TAHMİN10 — Telegram satış botu (Türkiye)

Meta reklamı → açılış sayfası → Telegram'da yapay zekâ satış asistanı → ücretsiz tahmin kanalı → Whop üzerinden TL ile VIP aboneliği → VIP kanal erişimi → Meta'ya dönüşüm olayları. Yönetim paneli, analiz, destek talepleri ve kendi kendine öğrenen satış rehberi dahil.

> **Marka adı "TAHMİN10" bir yer tutucudur.** `src/config/business.ts` içindeki `brand`, `freeChannel.name`, `vip.name` alanlarını ve panel başlıklarındaki `TAHMİN` metnini (`app/admin/page.tsx`, `app/layout.tsx`) kendi markanızla değiştirin.

## Yığın

Next.js 15 (App Router, Vercel) · Supabase (Postgres) · Telegram Bot API · DeepSeek (`deepseek-flash`; koç için isteğe bağlı `deepseek-v4-pro`) · Whop (ödeme, TRY, abonelik) · Meta Pixel + Conversions API.

## Klasörler

| Yol | İçerik |
|---|---|
| `app/page.tsx` | Açılış sayfası (mobil öncelikli, metinler panelden düzenlenir) |
| `app/gizlilik` | Gizlilik sayfası (KVKK) |
| `components/landing/` | `MainLanding` (gerçek ziyaretçiler) ve `SafeLanding` ("Futbol Veri Merkezi": botlar, link önizleyiciler, izin verilen ülkeler dışı). Karar `src/lib/gate.ts`, kurallar panel → Ziyaretçi Filtresi, metinler panel → Veri Merkezi Sayfası. Ziyaretler `page_visits` tablosuna kaydedilir (`supabase/visitor_filter.sql`) |
| `app/admin` | Yönetim paneli (Türkçe) — `/admin`, şifre `ADMIN_PASSWORD` |
| `app/api/lead/start` | Sitedeki düğme: kişi kaydı + Meta "Contact" + Telegram'a yönlendirme |
| `app/api/telegram/webhook` | Bot: mesajlar, /start, /planlar, /kanal, /dur, kanal üyelik kontrolü, destek |
| `app/api/checkout/redirect` | Plan düğmesi → kişiye bağlı Whop ödeme sayfası |
| `app/api/webhooks/whop` | Ödeme / iade / üyelik bildirimleri → VIP erişimi ver / kaldır |
| `app/api/cron/*` | Günlük öğrenme + takip mesajları (Vercel cron) |
| `src/config/` | **Sizin düzenleyeceğiniz her şey:** `business.ts` (bilgiler, planlar), `prompts.ts` (satış kişiliği), `texts.ts` (sabit mesajlar), `landing.ts` (sayfa metinleri), `funnel.ts` (puanlama, takip kuralları, Meta olayları) |
| `src/sales/` | Satış motoru, yapay zekâ ajanı, güvenlik filtresi (Türkçe), takip mesajları, ödemeler, destek talepleri |
| `src/learning/` | Analist → koç → playbook → A/B deneyleri |
| `src/lib/` | Supabase, Telegram, Whop, Meta, DeepSeek, ayarlar, analiz |
| `supabase/` | `schema.sql` (tam şema, güncellemeler dahil) ve isteğe bağlı `optional_hourly_cron.sql` |

## Kurulum (sırayla)

### 1. GitHub
Bu klasörü bir GitHub deposuna yükleyin (depo kökünde `app`, `src`, `supabase`, `package.json` olacak şekilde).

### 2. Supabase
Yeni proje → SQL Editor → `supabase/schema.sql` dosyasının tamamını yapıştırıp **Run**. (Tek dosya: yönetim paneli, destek, analiz, ziyaretçi filtresi ve kanal paylaşımı tabloları da içinde.) Daha önce kurduysanız yalnızca yeni parçayı: `supabase/posts.sql`.
Project Settings → API → `SUPABASE_URL` ve **Secret key** (`sb_secret_...`).

### 3. Telegram
1. @BotFather → yeni bot → token. Ayrıca kullanıcı adını not edin.
2. İki **kanal** açın: ücretsiz ve VIP. Her ikisinde botu **yönetici** yapın ("kullanıcı ekleme / davet linki" yetkisiyle).
3. Kanal ID'leri (`-100...`): kanala bir mesaj iletip @userinfobot'a gönderin ya da web.telegram.org adres çubuğundan okuyun.
4. Ücretsiz kanal için kalıcı bir davet linki oluşturun (`TELEGRAM_FREE_CHANNEL_URL`).
5. Kendi Telegram ID'nizi @userinfobot'tan alın (`TELEGRAM_ADMIN_CHAT_ID`) ve bota bir kez `/start` yazın (bot size yazabilsin).
6. Destek için kullanılacak hesabın kullanıcı adı (`SUPPORT_USERNAME`).

### 4. Whop
1. Bir ürün (access pass) ve üç **abonelik** planı oluşturun: haftalık, aylık, 3 aylık — para birimi **TRY**. Plan ID'lerini (`plan_...`) `WHOP_PLAN_*` değişkenlerine yazın (ödeme linki de olur).
2. Developer → API keys → şirket API anahtarı. İzinler: `checkout_configuration:create`, `checkout_configuration:basic:read`, `plan:create`, `access_pass:create`, `access_pass:update`.
3. Developer → Webhooks → yeni webhook → URL: `https://ALANADINIZ/api/webhooks/whop`. Olaylar: `payment.succeeded`, `payment.failed`, `refund.created`, `membership.activated`, `membership.deactivated`. Secret (`ws_...`) → `WHOP_WEBHOOK_SECRET`.
4. `src/config/business.ts` içindeki fiyatları Whop'taki fiyatlarla **aynı** yapın (ya da yayına aldıktan sonra panel → İşletme Bilgileri).
5. Whop'un kendi Telegram uygulaması VIP kanalını yönetiyorsa kaldırın; aksi hâlde bot ile çakışır.

### 5. DeepSeek
platform.deepseek.com → API anahtarı → bakiye yükleyin. `DEEPSEEK_MODEL=deepseek-flash`.

### 6. Vercel
1. Depoyu içe aktarın. Kök dizin: uygulamanın olduğu klasör.
2. Settings → Environment Variables: `.env.example` dosyasındaki **her** satırı girin. `SETUP_SECRET`, `CRON_SECRET`, `TELEGRAM_WEBHOOK_SECRET` için `openssl rand -hex 24`.
3. Deploy. Bittiğinde `APP_URL` değişkenini gerçek adresle güncelleyip yeniden deploy edin.

### 7. Bağlantıyı kurun
Tarayıcıda açın: `https://ALANADINIZ/api/setup/telegram?secret=SETUP_SECRET`
Telegram webhook'u ve komutları kaydeder, veritabanını, kanal yetkilerini, Whop planlarını ve API anahtarını kontrol eder; sonucu JSON olarak gösterir. `"ok": false` olan satırları düzeltip tekrar açın.

### 8. Panel ve test
`https://ALANADINIZ/admin` → şifre. İşletme Bilgileri'ni gerçek bilgilerle doldurun (iade politikası, geçmiş sonuçlar yalnızca gerçekse).
İkinci bir Telegram hesabıyla huninin tamamını deneyin: site → bot → ücretsiz kanal → "Katıldım" → `/planlar` → haftalık planla ödeme → VIP linki → Whop'tan iade → VIP'ten çıkarılma. Sonra o hesabı panelden silin.

### 9. Meta
Panel → Entegrasyonlar → Pixel ID, Conversions API token ve test kodu. "Bağlantıyı test et". Events Manager → Test events'te Contact, Lead, CompleteRegistration, InitiateCheckout, Purchase görünmeli. Yayından önce test kodunu silin. Panel → Hedef Kitleler sekmesi yeniden hedefleme tariflerini içerir.

## İki çalışma modu

- **İnsan operatör (varsayılan):** bota gelen her mesaj (yazı, ses, fotoğraf, video, dosya) panel → Gelen Kutusu'na düşer; siz ya da operatörünüz oradan cevaplar, cevap bot üzerinden gider. Yapay zekâ cevap yazmaz; puanlar, cevap önerir, yazdığınızı samimi Türkçeye çevirir, "bugün kime yazmalıyım" listesi çıkarır ve her 10 konuşmada koç raporu verir. Karşılama + kanal düğmesi, "Katıldım" doğrulaması, komutlar ve ödeme sonrası VIP linki yine otomatik. Kurulum: `supabase/inbox.sql`.
- **Yapay zekâ satış asistanı:** Gelen Kutusu → Şablonlar & ayarlar → Mod'dan açılır; bot kendisi konuşur ve satar.

## Günlük kullanım

- **Konuşmalar**: her sohbeti okuyun, 1–5 puan verin, not yazın — koçun en güçlü girdisi.
- **Öğrenme**: her 10 biten konuşmada koç yeni bir rehber önerir; Telegram'da `/approve N` ya da panelden onaylayın.
- **Destek**: ekran görüntüsü gönderen ya da insan isteyen müşteriler Telegram'ınıza "Cevapla / Çözüldü / Yapay zekâya öğret" düğmeleriyle düşer.
- **Kanal Paylaşımları**: ücretsiz/VIP kanala post yazın (kalın, spoiler, alıntı, emoji, görsel), zamanlayın ya da hemen gönderin, şablon ve etiket kullanın. Plan düğmeleri botu açar → satış o paylaşıma yazılır; "bot mu sattı, kanal mı" ayrımı panelde. Gönderilen postun metni 1 saat sonra silinir, sayıları kalır. Zamanlama için `supabase/post_scheduler.sql` (her dakika).
- **Gelişmiş Ayarlar**: promptun sabit kuralları ve tüm yapay zekâ talimatları (analist, koç, takip, öğretme, analiz), güvenlik filtresinin her kuralı (kapat/sil/ekle, olumsuzluk ve “mesaj istemiyorum” kelimeleri, test kutusu), tasarım (renkler, yazı tipi, bölüm görünürlükleri, serbest CSS; Veri Merkezi sayfası dahil), bot komut adları ve “satın alma” anahtar kelimeleri. Hepsinde “Varsayılana dön”.
- **Analiz**: reklam harcamasını girin → CAC, ROAS, LTV, elde tutma; "Yapay zekâ yorumu" düğmesi ne yapmanız gerektiğini söyler.
- Takip mesajları ücretsiz Vercel planında günde bir kez (Türkiye saatiyle 12:00) gider; saatlik gönderim için `supabase/optional_hourly_cron.sql`.

## Güvenlik kuralları (kodda, değiştirilemez)

Bot asla: "banko", "kesin", "garanti", "risksiz" demez; sonuç, yorum, kampanya ya da kontenjan uydurmaz; kaybı telafi etmeye teşvik etmez; **hiçbir bahis sitesi önermez ya da adını vermez**; 18 yaş altına ya da kumar sorunu işareti gösterenlere satış yapmaz (YEDAM 115'e yönlendirir); "DUR" yazana bir daha yazmaz; link yazmaz. Kurallar `src/config/guard.ts` varsayılanlarıyla `src/sales/guardrails.ts` içinde uygulanır ve panel → Gelişmiş Ayarlar → Güvenlik filtresi bölümünden düzenlenebilir; koçun önerilerine de aynı filtre uygulanır.

## Yasal not

Türkiye'de bahis yalnızca lisanslı kurumlar üzerinden yasaldır; yasa dışı bahis reklamı ve yönlendirmesi suçtur. Bu sistem tahmin/analiz içeriği satar, bahis oynatmaz ve site önermez; yine de reklam metinlerinizi, açılış sayfanızı ve Meta'nın bahisle ilgili reklam politikasını bir uzmana danışarak kontrol edin. Uydurma sonuç ve kazanç vaadi yanıltıcı reklamdır.
