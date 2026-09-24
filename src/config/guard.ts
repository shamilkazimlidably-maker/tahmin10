/**
 * GÜVENLİK FİLTRESİ AYARLARI — botun (ve koçun) yazamayacağı ifadeler, olumsuzluk kelimeleri,
 * "mesaj istemiyorum" kalıpları. Varsayılanlar burada; panel → Gelişmiş Ayarlar → Güvenlik filtresi
 * bölümünden her kural kapatılabilir, silinebilir, yenisi eklenebilir (src/lib/settings.ts uygular).
 *
 * Kural türleri:
 *  - "word":  düz kelime/ifade. Türkçe eklerle de eşleşir ("garanti" → garantili, garantisi…).
 *  - "regex": JavaScript düzenli ifadesi (küçük harfe çevrilmiş metne uygulanır; Türkçe harfler için
 *             \b yerine (?<![a-zçğıöşüâîû]) / (?![a-zçğıöşüâîû]) kullanın).
 * "weakNegation": kalıbın kendisi "yok" içeriyorsa ("risk yok") "yok" olumsuzluk sayılmaz.
 */
export type GuardRule = { id: string; label: string; kind: "word" | "regex"; value: string; enabled: boolean; weakNegation?: boolean };

export const GUARD = {
  /** Tamamen kapatmak için false (önerilmez: yanıltıcı reklam riski). */
  enabled: true,
  rules: [
    { id: "guaranteed_result", label: "Garanti", kind: "word", value: "garanti", enabled: true },
    { id: "guaranteed_result", label: "Banko", kind: "word", value: "banko", enabled: true },
    { id: "guaranteed_result", label: "Kesin kazanç / kesin tutar", kind: "regex", value: "(?<![a-zçğıöşüâîû])kesin(likle)?\\s+(kazan|gelir|tutar|tuttur|isabet|sonuç|kupon|tahmin|green|para)", enabled: true },
    { id: "guaranteed_result", label: "Kazanç garanti / isabet kesin", kind: "regex", value: "(?<![a-zçğıöşüâîû])(kazanç|kazanc|isabet|kâr|kar|tutma|green)[a-zçğıöşüâîû]*\\s+(garanti|kesin)", enabled: true },
    { id: "guaranteed_result", label: "Şaşmaz / kaçmaz / kaybetmez", kind: "regex", value: "(?<![a-zçğıöşüâîû])(şaşmaz|kaçmaz|kaybetmez|kaybedemezsin|kaybetmen\\s+imkansız|tutmama\\s+(ihtimali|şansı)\\s+yok)", enabled: true, weakNegation: true },
    { id: "risk_free", label: "Risksiz", kind: "word", value: "risksiz", enabled: true },
    { id: "risk_free", label: "Risk yok / sıfır risk", kind: "regex", value: "(?<![a-zçğıöşüâîû])(risk\\s+(yok|sıfır)|sıfır\\s+risk|riski\\s+yok|kayıp\\s+riski\\s+yok|kaybetme\\s+(riski|ihtimali|şansı)\\s+yok)", enabled: true, weakNegation: true },
    { id: "easy_money", label: "Kolay para / zengin ol", kind: "regex", value: "(?<![a-zçğıöşüâîû])(kolay\\s+para|para\\s+bas(ma|ıyor|arsın|acaksın)|zengin\\s+ol|ek\\s+gelir\\s+garanti|maaş\\s+gibi|geçim\\s+kaynağı|paran[ıi]\\s+(ikiye|üçe)\\s+katla|katlayacaksın)", enabled: true },
    { id: "certainty", label: "%100 / şike / içeriden bilgi", kind: "regex", value: "(%\\s?100|100\\s?%|(?<![a-zçğıöşüâîû])yüzde\\s+yüz|(?<![a-zçğıöşüâîû])kesinlikle\\s+tut|(?<![a-zçğıöşüâîû])şike|(?<![a-zçğıöşüâîû])ayarlanmış\\s+maç|(?<![a-zçğıöşüâîû])anlaşmalı\\s+maç|(?<![a-zçğıöşüâîû])maç\\s+(satıldı|ayarlı)|(?<![a-zçğıöşüâîû])içeriden\\s+bilgi|(?<![a-zçğıöşüâîû])sağlam\\s+bilgi\\s+var)", enabled: true },
    { id: "fake_scarcity", label: "Sahte aciliyet / kontenjan", kind: "regex", value: "(?<![a-zçğıöşüâîû])(son\\s+(\\d+\\s+)?(yer|kişi|kontenjan|üye|koltuk)|kontenjan[a-zçğıöşüâîû]*\\s+(dol|sınırlı|az|bit)|sınırlı\\s+(sayıda|kontenjan|süre)|sadece\\s+bug[üu]n|bug[üu]ne\\s+özel|son\\s+(şans|fırsat|gün|saat)|fırsatı\\s+kaçırma|kaçırma(yın)?(?![a-zçğıöşüâîû])|acele\\s+et(?!me)|hemen\\s+(al|katıl|kap)(?![a-zçğıöşüâîû])|kampanya\\s+(bitiyor|sona\\s+eriyor))", enabled: true },
    { id: "chasing_losses", label: "Kaybı telafi etmeye teşvik", kind: "regex", value: "(?<![a-zçğıöşüâîû])(kayb[a-zçğıöşüâîû]*\\s+(geri\\s+al|telafi|kapat|çıkar)|telafi\\s+(et|kupon|için|kupona)|açığı\\s+kapat|zarar[a-zçğıöşüâîû]*\\s+(geri|çıkar|kapat)|paran[ıi]\\s+(geri\\s+al|kurtar|çıkar)|iki\\s+katına\\s+(oyna|çık|bas)|hepsini\\s+(oyna|bas|koy|yatır)|borç\\s+al[a-zçğıöşüâîû]*\\s+oyna|kredi\\s+çek)", enabled: true },
    { id: "betting_site", label: "Bahis sitesi önerme", kind: "regex", value: "(?<![a-zçğıöşüâîû])((bahis|iddaa)\\s+sitesi\\s+(öner|tavsiye)|(site|platform|uygulama)(ye|de|da|den|dan)\\s+(oyna|üye\\s+ol|kayıt\\s+ol|gir)|(şu|bu|şuradan|buradan)\\s+(site|platform|uygulama)[a-zçğıöşüâîû]*\\s+(oyna|gir|kayıt))", enabled: true },
  ] as GuardRule[],

  /** Eşleşmeden SONRA aynı cümlede bu kelimelerden biri varsa cümle dürüst sayılır ("garanti yok"). */
  negationAfter: "yok, yoktur, değil, değiliz, değildir, değilim, olmaz, olamaz, olmadığı, etmiyoruz, etmiyorum, etmiyor, etmez, etmeyiz, edemez, edemeyiz, edemem, edilmez, etmem, vermiyoruz, vermiyorum, vermiyor, vermez, veremez, veremeyiz, veremem, verilmez, demiyoruz, demiyorum, demiyor, demem, demeyiz, denmez, söylemem, söylemeyiz, söylemiyoruz, sunmuyoruz, satmıyoruz, yapmıyoruz, yapmayız, önermiyoruz, önermeyiz, öneremem, önermem, çalışma, çalışmayın, kalkma, kalkışma, etme, etmeyin, yapma, yapmayın, alma, oynama, koyma, çekme, inanma, inanmayın, kanma, kanmayın",
  /** "yok" içeren kalıplarda kullanılan daha dar liste. */
  negationWeak: "değil, değildir, olmaz, olamaz, etmiyoruz, etmiyorum, etmiyor, etmez, vermiyoruz, inanma, inanmayın, kanma, kanmayın",
  /** Eşleşmeden ÖNCE (aynı cümlede, 45 karakter içinde) gelirse dürüst sayılır. */
  negationBefore: "hiçbir, hiç, asla, kimse, hiç kimse, ne",

  /** Tek kelimelik mesaj olarak bunlardan biri gelirse kişi mesaj istemiyor demektir. */
  optOutWhole: "dur, durdur, stop, abonelikten çık, listeden çıkar",
  /** Mesajın içinde geçerse (düzenli ifade parçaları; virgülle). */
  optOutPhrases: "(mesaj|bildirim)\\w*\\s+(atma|atmayın|gönderme|göndermeyin|yollama|yollamayın|yazma|yazmayın|durdur|kapat), bir\\s+daha\\s+(yazma|mesaj|rahatsız), rahatsız\\s+etme, beni\\s+(rahat\\s+bırak|listeden\\s+çıkar|sil|çıkar), artık\\s+yazma, yazmayı\\s+(bırak|kes), spam\\s+yapma, engelleyece[ğg]im, (istemiyorum|almak\\s+istemiyorum)[^.!?\\n]{0,20}(mesaj|bildirim), (mesaj|bildirim)[^.!?\\n]{0,25}(istemiyorum|almayayım)",

  /** Yüzde / birim sayısı bunların yanındaysa "sonuç iddiası" sayılır ve yalnızca İşletme Bilgileri'ndeki sayılar yazılabilir. */
  checkStats: true,
  resultWords: "isabet, tuttur, tutan, başarı, kazanç, kazanc, kâr, kar, roi, getiri, green, win rate, oran",
  /** Aktif kampanya yokken bu kelimeler geçerse "uydurma kampanya". */
  promoWords: "indirim, kupon kodu, promosyon, kampanya, bedava gün, bedava hafta, bedava ay, ücretsiz deneme",
  /** Botun mesajında çıplak link (http, t.me, www) yasak — düğmeleri sistem ekler. */
  checkLinks: true,
};
export type GuardSettings = typeof GUARD;
