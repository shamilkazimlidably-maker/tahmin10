import { BUSINESS } from "./business";

/**
 * Botun yapay zekâya sormadan gönderdiği SABİT MESAJLAR (Türkçe). Varsayılanlar burada;
 * sahip bunları yönetim paneli → "Hazır Mesajlar" bölümünden düzenler (src/lib/settings.ts uygular).
 * Değişkenler: {brand} {vip} {age} {frequency} — belirtilen yerlerde {plan} {support}.
 */
export const TEXTS = {
  welcome: "Selam{name}! 👋 Futbol tahmin kanalımıza girmek istiyorsun galiba — doğru yerdesin.\n\nÜcretsiz kanala katılmak için aşağıdaki düğmeye dokun; her gün veriye dayalı 1 tahmin geliyor. Katıldığını ben görüyorum; sonra hangi takımı tuttuğunu yaz, sohbet edelim 🙂",
  plansIntro: "{vip} planları:",
  plansFooter: "Hepsi aynı VIP erişimini veriyor — sadece süre değişiyor. Bunlar abonelik: otomatik yenilenir, Whop üzerinden istediğin an iptal edebilirsin.\n\nGüvenli ödeme sayfasını açmak için bir plana dokun 👇",
  freeInviteFallback: "Bu arada {brand}'un Telegram'da ücretsiz bir kanalı var. Bir göz atmak ister misin? Buraya dokunman yeterli 👇",
  canal: "{brand} ücretsiz kanalında {frequency} var. Buraya dokunman yeterli 👇",
  joinConfirmed: "Onaylandı ✅",
  joinNotFound: "Seni kanalda henüz göremedim. Önce “Ücretsiz kanala katıl” düğmesiyle gir, sonra buraya tekrar dokun.",
  alreadyVipStart: "Zaten {vip} üyesisin 👑 Erişimle ilgili yardım lazım olursa yazman yeterli.",
  alreadyVip: "Zaten {vip} üyesisin 👑",
  doNotSell: "Şu an sana VIP'i buradan sunamıyorum. İçerik yalnızca {age} yaş üstü ve sorumlu oynayan kişiler için.",
  optOutDone: "Tamam, buradan sana bir daha mesaj göndermeyeceğim. Fikrini değiştirirsen /start yazman yeterli. Görüşürüz 👋",
  help: "Komutlar: /planlar (VIP'i gör) · /kanal (ücretsiz kanal) · /dur (mesaj almayı bırak). Ya da bana normal yaz 🙂",
  handoffContact: "{brand} ekibinden biriyle konuşmak için: {support}",
  audioReply: "Şu an sesli mesajı dinleyemiyorum 🙏 Yazıyla gönderir misin? Hemen cevaplayayım.",
  nonTextReply: "Şimdilik sadece yazılı mesajları okuyabiliyorum 🙂 Buraya yaz, cevaplayayım.",
  imageReceived: "Görselini aldım 👍 Ben buradan görsel göremiyorum, o yüzden ekibe ilettim. Sana buradan dönüş yapacaklar.",
  imageNoTeam: "Buradan görsel göremiyorum 😕 Ekranda ne yazdığını bana yazıyla anlatır mısın?",
  ticketAck: "Aldım 👍 Ekip bakıyor, sana buradan dönüş yapacak.",
  vipDelivered: "Ödemen onaylandı! ✅\n\n{vip}'e hoş geldin ({plan}). VIP kanala girmek için aşağıdaki düğmeye dokun.\n\nBu link sadece sana özel — paylaşma.",
  vipDeliveredNoLink: "Ödemen onaylandı! ✅\n\n{vip}'e hoş geldin ({plan}). Erişimin Whop üzerinden açılıyor — birkaç dakika içinde gelmezse buradan yaz, ekip halleder.",
  vipEnded: "{vip} erişimin sona erdi. Bizimle takip ettiğin için teşekkürler! Geri dönmek istersen /planlar yazman yeterli. Ücretsiz kanal senin için açık kalmaya devam ediyor.",
  paymentFailed: "Ödemenin onaylanmadığını gördüm 😕 Bazen banka ya da kart kaynaklı oluyor. Tekrar denemek istersen /planlar yaz — yardım gerekirse de söyle.",
  technicalFallback: "Bir saniye takıldım 😅 Tekrar yazar mısın?",
  safeFallback: "İyi soru. Yanlış bilgi vermemek için bunu ekibe bir sorayım, olur mu?",
  btnJoinFree: "📲 Ücretsiz kanala katıl",
  btnJoined: "✅ Katıldım",
  btnVip: "👑 VIP kanala gir",
  btnSupport: "💬 Ekiple konuş",
};
export type TextKey = keyof typeof TEXTS;

export function fill(template: string, vars: Record<string, string | number | null | undefined> = {}): string {
  const all: Record<string, string | number | null | undefined> = {
    brand: BUSINESS.brand,
    vip: BUSINESS.vip.name,
    age: BUSINESS.minimumAge,
    frequency: BUSINESS.freeChannel.postingFrequency ?? "ücretsiz tahminler",
    ...vars,
  };
  return template.replace(/\{(\w+)\}/g, (whole, key: string) => (all[key] === undefined || all[key] === null ? whole : String(all[key])));
}
export const tx = (key: TextKey, vars?: Record<string, string | number | null | undefined>) => fill(TEXTS[key], vars);
