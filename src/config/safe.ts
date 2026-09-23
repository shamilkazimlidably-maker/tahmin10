/**
 * "GÜVENLİ" SAYFA — Futbol Veri Merkezi. Botlara, tarayıcı robotlarına ve izin verilen ülkeler
 * dışından gelen ziyaretçilere ana açılış sayfası yerine bu sayfa gösterilir (kurallar: src/config/gate.ts,
 * panel → Ziyaretçi Filtresi). Metinlerin tamamı panel → "Veri Merkezi Sayfası" bölümünden düzenlenir.
 * Bu sayfada Telegram düğmesi, Meta pikseli ve satışla ilgili hiçbir şey yoktur.
 */
export const SAFE = {
  brand: "Futbol Veri Merkezi",
  title: "Futbol Veri Merkezi — Maç İstatistikleri ve Takım Analizleri",
  metaDescription: "Türkiye ve Avrupa liglerinden güncel futbol istatistikleri, takım form grafikleri, oyuncu performans verileri ve maç öncesi analizler. Ücretsiz futbol veri platformu.",
  h1: "Maç İstatistikleri ve Takım Analizleri",
  tagline: "Türkiye ve Avrupa liglerinden güncel futbol verileri, tek çatı altında.",
  card1Title: "5+ lig",
  card1Text: "Süper Lig, Premier Lig, La Liga, Serie A ve Bundesliga",
  card2Title: "~2 saat",
  card2Text: "Maç sonrası verilerin güncellenme süresi",
  card3Title: "Her pazartesi",
  card3Text: "Haftalık özet raporu",
  introTitle: "Giriş",
  intro: "Futbol, dünyanın en çok takip edilen spor dalıdır ve bu ilginin arkasında yalnızca heyecan değil, aynı zamanda ciddi bir veri birikimi vardır. Futbol Veri Merkezi olarak, futbolseverlere ve spor analistlerine yönelik kapsamlı istatistiksel içerikler sunuyoruz. Amacımız, maçları izlerken veya takımları değerlendirirken ihtiyaç duyduğunuz sayısal verileri tek bir çatı altında toplamaktır.",
  s1Title: "Neler Sunuyoruz?",
  s1p1: "Platformumuzda Süper Lig, Premier Lig, La Liga, Serie A ve Bundesliga başta olmak üzere birçok ligden güncel veriler bulabilirsiniz. Takım puan durumları, gol istatistikleri, asist tabloları, kart ve faul verileri, topa sahip olma oranları ve maç başına şut sayıları gibi onlarca farklı metrik düzenli olarak güncellenmektedir.",
  s1p2: "Oyuncu bazında ise; oynanan dakika, gol katkısı, pas isabet oranı, ikili mücadele kazanma yüzdesi ve koşu mesafesi gibi detaylı performans verileri sunulmaktadır. Bu veriler, futbolseverlerin favori oyuncularını daha yakından takip etmesini sağlarken, spor yazarları ve analistler için de objektif bir değerlendirme zemini oluşturur.",
  s2Title: "Maç Öncesi Analizler",
  s2p1: "Her hafta oynanacak karşılaşmalar öncesinde, takımların son beş maçlık form grafiklerini, karşılıklı istatistiklerini ve saha avantajı verilerini içeren analiz dosyaları hazırlıyoruz. Bu analizler, herhangi bir sonuç öngörüsü içermez; yalnızca geçmiş verilerin düzenli bir şekilde sunulmasından oluşur. Okuyucularımız bu verileri kendi değerlendirmeleri için referans olarak kullanabilir.",
  s2p2: "",
  s3Title: "Taktiksel İçerikler",
  s3p1: "Futbolun taktiksel boyutu, modern oyunun en çok konuşulan alanlarından biridir. Diziliş sistemleri, pres kurguları, geçiş hücumları ve duran top organizasyonları gibi konularda hazırladığımız yazılar, oyunu daha derinlemesine anlamak isteyenler için hazırlanmıştır. Bu içerikler, görsel destekli anlatımlarla zenginleştirilir.",
  s3p2: "",
  s4Title: "Veri Kaynakları ve Güncelleme",
  s4p1: "Kullandığımız veriler, resmi lig istatistik sağlayıcılarından ve kamuya açık spor veri tabanlarından derlenmektedir. Maç günlerinde veriler, karşılaşmaların tamamlanmasının ardından ortalama iki saat içinde güncellenir. Haftalık özet raporlarımız ise her pazartesi yayımlanır.",
  s4p2: "",
  s5Title: "Topluluk ve Geri Bildirim",
  s5p1: "Futbol Veri Merkezi, yalnızca bir veri sitesi değil; aynı zamanda futbolseverlerin bir araya geldiği bir platformdur. Okuyucularımızdan gelen geri bildirimler, hangi verilerin daha fazla öne çıkarılması gerektiği konusunda bize yol gösterir. Öneri, eleştiri ve katkılarınızı iletişim sayfamızdan bize iletebilirsiniz.",
  s5p2: "",
  contactTitle: "İletişim",
  contactText: "Öneri, eleştiri ve katkılarınız için bize yazabilirsiniz:",
  contactEmail: "",
  footer: "© Futbol Veri Merkezi. İstatistik ve analiz içerikleri bilgilendirme amaçlıdır; sonuç öngörüsü içermez.",
};
export type SafeKey = keyof typeof SAFE;

/** Panelde boş bırakılabilen alanlar; boşsa o öğe sayfadan kalkar. */
export const SAFE_OPTIONAL_KEYS: SafeKey[] = ["tagline", "card1Title", "card1Text", "card2Title", "card2Text", "card3Title", "card3Text", "s1p2", "s2p2", "s3p2", "s4p2", "s5p2", "contactText", "contactEmail"];
