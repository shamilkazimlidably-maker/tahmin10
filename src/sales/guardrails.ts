import { allowedStatNumbers, BUSINESS } from "../config/business";

/**
 * Prompt rica eder; bu dosya UYGULAR.
 * Botun göndermek üzere olduğu her mesaj — ve Satış Koçu'nun playbook'a eklemek
 * istediği her cümle — findForbiddenClaims() filtresinden geçer.
 *
 * Türkçede olumsuzluk kelimeden SONRA gelir ("garanti yok", "garanti etmiyoruz",
 * "banko diye bir şey yok"), bu yüzden dürüst cümleleri ayırmak için eşleşmeden
 * sonraki kelimelere bakılır.
 */

/** Türkçe büyük/küçük harf: "İ"→"i", "I"→"ı" (JS toLowerCase bunu yanlış yapar). Uzunluk korunur. */
function norm(text: string): string {
  return text.replace(/İ/g, "i").replace(/I/g, "ı").toLowerCase();
}

// Türkçe harfler için kelime sınırı (\b yalnızca ASCII bilir).
const L = "a-zçğıöşüâîû";
const B = `(?<![${L}])`;
const E = `(?![${L}])`;
const rx = (s: string) => new RegExp(s, "g");

/* ------------------------------------------------------------------ */
/*  Mesaj almak istemiyor                                              */
/* ------------------------------------------------------------------ */

// "dur" tek başına sohbette de geçebilir ("dur bakayım"); o yüzden yalnızca TEK KELİMELİK mesaj sayılır.
const OPT_OUT_WHOLE = /^\s*\/?(dur|durdur|stop|abonelikten\s*çık|listeden\s*çıkar)[\s.!]*$/;
const OPT_OUT_PHRASE =
  /(mesaj|bildirim)\w*\s+(atma|atmayın|gönderme|göndermeyin|yollama|yollamayın|yazma|yazmayın|durdur|kapat)|bir\s+daha\s+(yazma|mesaj|rahatsız)|rahatsız\s+etme|beni\s+(rahat\s+bırak|listeden\s+çıkar|sil|çıkar)|artık\s+yazma|yazmayı\s+(bırak|kes)|spam\s+yapma|engelleyece[ğg]im|(istemiyorum|almak\s+istemiyorum)[^.!?\n]{0,20}(mesaj|bildirim)|(mesaj|bildirim)[^.!?\n]{0,25}(istemiyorum|almayayım)/;

export function isOptOut(text: string): boolean {
  const t = norm(text);
  return OPT_OUT_WHOLE.test(t) || OPT_OUT_PHRASE.test(t);
}

/* ------------------------------------------------------------------ */
/*  Yasak vaatler                                                      */
/* ------------------------------------------------------------------ */

type Rule = { id: string; pattern: RegExp; /** "yok" içeren kalıplar için (orada "yok" iddianın kendisidir) */ weakNegation?: boolean };

const RULES: Rule[] = [
  { id: "guaranteed_result", pattern: rx(`${B}garanti[${L}]*`) },
  { id: "guaranteed_result", pattern: rx(`${B}banko[${L}]*`) },
  { id: "guaranteed_result", pattern: rx(`${B}kesin(likle)?\\s+(kazan|gelir|tutar|tuttur|isabet|sonuç|kupon|tahmin|green|para)`) },
  { id: "guaranteed_result", pattern: rx(`${B}(kazanç|kazanc|isabet|kâr|kar|tutma|green)[${L}]*\\s+(garanti|kesin)`) },
  { id: "guaranteed_result", pattern: rx(`${B}(şaşmaz|kaçmaz|kaybetmez|kaybedemezsin|kaybetmen\\s+imkansız|tutmama\\s+(ihtimali|şansı)\\s+yok)`), weakNegation: true },
  { id: "risk_free", pattern: rx(`${B}risksiz`) },
  { id: "risk_free", pattern: rx(`${B}(risk\\s+(yok|sıfır)|sıfır\\s+risk|riski\\s+yok|kayıp\\s+riski\\s+yok|kaybetme\\s+(riski|ihtimali|şansı)\\s+yok)`), weakNegation: true },
  { id: "easy_money", pattern: rx(`${B}(kolay\\s+para|para\\s+bas(ma|ıyor|arsın|acaksın)|zengin\\s+ol|ek\\s+gelir\\s+garanti|maaş\\s+gibi|geçim\\s+kaynağı|paran[ıi]\\s+(ikiye|üçe)\\s+katla|katlayacaksın)`) },
  { id: "certainty", pattern: rx(`(%\\s?100|100\\s?%|${B}yüzde\\s+yüz|${B}kesinlikle\\s+tut|${B}şike|${B}ayarlanmış\\s+maç|${B}anlaşmalı\\s+maç|${B}maç\\s+(satıldı|ayarlı)|${B}içeriden\\s+bilgi|${B}sağlam\\s+bilgi\\s+var)`) },
  { id: "fake_scarcity", pattern: rx(`${B}(son\\s+(\\d+\\s+)?(yer|kişi|kontenjan|üye|koltuk)|kontenjan[${L}]*\\s+(dol|sınırlı|az|bit)|sınırlı\\s+(sayıda|kontenjan|süre)|sadece\\s+bug[üu]n|bug[üu]ne\\s+özel|son\\s+(şans|fırsat|gün|saat)|fırsatı\\s+kaçırma|kaçırma(yın)?${E}|acele\\s+et(?!me)|hemen\\s+(al|katıl|kap)${E}|kampanya\\s+(bitiyor|sona\\s+eriyor))`) },
  { id: "chasing_losses", pattern: rx(`${B}(kayb[${L}]*\\s+(geri\\s+al|telafi|kapat|çıkar)|telafi\\s+(et|kupon|için|kupona)|açığı\\s+kapat|zarar[${L}]*\\s+(geri|çıkar|kapat)|paran[ıi]\\s+(geri\\s+al|kurtar|çıkar)|iki\\s+katına\\s+(oyna|çık|bas)|hepsini\\s+(oyna|bas|koy|yatır)|borç\\s+al[${L}]*\\s+oyna|kredi\\s+çek)`) },
  { id: "betting_site", pattern: rx(`${B}((bahis|iddaa)\\s+sitesi\\s+(öner|tavsiye)|(site|platform|uygulama)(ye|de|da|den|dan)\\s+(oyna|üye\\s+ol|kayıt\\s+ol|gir)|(şu|bu|şuradan|buradan)\\s+(site|platform|uygulama)[${L}]*\\s+(oyna|gir|kayıt))`) },
];

// "yok" da olumsuzluk sayılır — "garanti yok" dürüst bir cümledir.
const NEG_AFTER_STRONG = /^(yok|yoktur|değil|değiliz|değildir|değilim|olmaz|olamaz|olmadığı|etmiyor(uz|um)?|etmez|etmeyiz|edemez|edemeyiz|edemem|edilmez|etmem|vermiyor(uz|um)?|vermez|veremez|veremeyiz|veremem|verilmez|demiyor(uz|um)?|demem|demeyiz|denmez|söylemem|söylemeyiz|söylemiyoruz|sunmuyoruz|satmıyoruz|yapmıyoruz|yapmayız|önermiyoruz|önermeyiz|öneremem|önermem|çalışma|çalışmayın|kalkma|kalkışma|etme|etmeyin|yapma|yapmayın|alma|oynama|koyma|çekme|inanma|inanmayın|kanma|kanmayın)[.,!?;:]*$/;
// "yok" HARİÇ (kalıbın kendisinde "yok" varsa) — "diye bir şey yok", "değil", "olmaz" yine dürüsttür.
const NEG_AFTER_WEAK = /^(değil|değildir|olmaz|olamaz|etmiyor(uz|um)?|etmez|vermiyoruz|inanma|inanmayın|kanma|kanmayın)[.,!?;:]*$/;
const NEG_BEFORE = /(hiçbir|hiç|asla|kimse|hiç\s+kimse|ne)\s+[^.!?\n]{0,30}$/;
const DIYE_YOK = /^diye\s+bir\s+şey\s+(yok|olmaz)/;

/** "garanti yok", "banko diye bir şey yok", "kimse garanti veremez" DÜRÜST cümlelerdir — izin ver. */
function isNegated(t: string, index: number, matchLength: number, weak = false): boolean {
  const before = t.slice(Math.max(0, index - 45), index);
  if (NEG_BEFORE.test(before)) return true;
  const rest = t.slice(index + matchLength).replace(/^[^.!?\n]*/, (m) => m); // aynı cümle
  const sentence = rest.split(/[.!?\n]/)[0] ?? "";
  if (DIYE_YOK.test(sentence.trim())) return true;
  const tokens = sentence.trim().split(/\s+/).filter(Boolean).slice(0, 7);
  const re = weak ? NEG_AFTER_WEAK : NEG_AFTER_STRONG;
  return tokens.some((tok) => re.test(tok));
}

// İsabet / ROI yüzdeleri: yalnızca business.ts trackRecord'dan HESAPLANAN sayılar yazılabilir.
const PERCENT = /%\s?(\d{1,3}(?:[.,]\d+)?)|(\d{1,3}(?:[.,]\d+)?)\s?%|yüzde\s+(\d{1,3}(?:[.,]\d+)?)/g;
const RESULT_WORD = new RegExp(`isabet|tuttur|tutan|başarı|kazan[cç]|${B}kâr${E}|${B}kar${E}|${B}roi${E}|getiri|green|win\\s?rate|oran[ıi]?\\s*%`);

function percentIn(t: string): { value: number; index: number; length: number }[] {
  PERCENT.lastIndex = 0;
  const out: { value: number; index: number; length: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = PERCENT.exec(t))) {
    const raw = m[1] ?? m[2] ?? m[3] ?? "";
    out.push({ value: Number(raw.replace(",", ".")), index: m.index, length: m[0].length });
  }
  return out;
}

function hasUnverifiedStatistic(t: string): boolean {
  const allowed = new Set(allowedStatNumbers().map((n) => Number(n.replace(",", "."))));
  for (const p of percentIn(t)) {
    const around = t.slice(Math.max(0, p.index - 45), p.index + p.length + 45);
    if (!RESULT_WORD.test(around)) continue;
    if (!allowed.has(p.value)) return true;
  }
  return false;
}

/** Metin geçmiş sonuç sayıları içeriyorsa true → zorunlu uyarı cümlesi gelmeli. */
export function quotesResults(text: string): boolean {
  const t = norm(text);
  for (const p of percentIn(t)) {
    const around = t.slice(Math.max(0, p.index - 45), p.index + p.length + 45);
    if (RESULT_WORD.test(around)) return true;
  }
  return /birim/.test(t) && RESULT_WORD.test(t);
}

/** Model sonuç sayıları yazıp uyarıyı unuttuysa uyarıyı ekler. */
export function ensureResultsDisclaimer(messages: string[]): string[] {
  const t = BUSINESS.vip.trackRecord;
  const joined = norm(messages.join("\n"));
  if (!t || !quotesResults(joined)) return messages;
  if (/geçmiş|garanti\s*(etmez|değil|yok|vermez|veremez)|garantisi\s+yok/.test(joined)) return messages;
  return [...messages, t.disclaimer];
}

export function findForbiddenClaims(text: string): string[] {
  const t = norm(text);
  const found = new Set<string>();
  if (hasUnverifiedStatistic(t)) found.add("unverified_statistic");

  for (const rule of RULES) {
    rule.pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = rule.pattern.exec(t))) {
      if (!isNegated(t, match.index, match[0].length, rule.weakNegation)) found.add(rule.id);
      if (match.index === rule.pattern.lastIndex) rule.pattern.lastIndex++;
    }
  }
  if (!BUSINESS.vip.activePromotion) {
    const promo = new RegExp(`${B}(indirim|kupon\\s+kodu|promosyon|kampanya|bedava\\s+(gün|hafta|ay)|ücretsiz\\s+deneme)`);
    const m = promo.exec(t);
    if (m && !isNegated(t, m.index, m[0].length)) found.add("invented_promotion");
  }
  if (/https?:\/\/|t\.me\/|www\./.test(t)) found.add("raw_link");
  return [...found];
}

/** Model tekrar tekrar güvensiz bir şey üretirse ya da çalışmıyorsa. */
export const SAFE_FALLBACK_REPLY = "İyi soru. Yanlış bilgi vermemek için bunu ekibe bir sorayım, olur mu?";
export const TECHNICAL_FALLBACK_REPLY = "Bir saniye takıldım 😅 Tekrar yazar mısın?";
