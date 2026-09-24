import { allowedStatNumbers, BUSINESS } from "../config/business";
import { GUARD, type GuardRule } from "../config/guard";

/**
 * Prompt rica eder; bu dosya UYGULAR. Kurallar src/config/guard.ts'ten (panelden düzenlenebilir) derlenir.
 * Türkçede olumsuzluk kelimeden SONRA gelir ("garanti yok", "banko diye bir şey yok"); dürüst cümleleri
 * ayırmak için eşleşmeden sonraki kelimelere de bakılır.
 */

/** Türkçe büyük/küçük harf: "İ"→"i", "I"→"ı" (JS toLowerCase bunu yanlış yapar). Uzunluk korunur. */
function norm(text: string): string {
  return text.replace(/İ/g, "i").replace(/I/g, "ı").toLowerCase();
}

const L = "a-zçğıöşüâîû";
const B = `(?<![${L}])`;
const E = `(?![${L}])`;
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const splitList = (s: string) => s.split(",").map((x) => norm(x.trim())).filter(Boolean);

type Compiled = {
  rules: { id: string; re: RegExp; weak: boolean }[];
  negAfter: RegExp | null; negWeak: RegExp | null; negBefore: RegExp | null;
  optWhole: RegExp | null; optPhrases: RegExp | null; resultWord: RegExp | null; promo: RegExp | null;
};
let cache: { sig: string; c: Compiled } | null = null;

function wordList(list: string, suffix = true): RegExp | null {
  const words = splitList(list);
  if (!words.length) return null;
  return new RegExp(`^(${words.map((w) => esc(w).replace(/\s+/g, "\\s+") + (suffix ? `[${L}]*` : "")).join("|")})[.,!?;:]*$`);
}

function compile(): Compiled {
  const sig = JSON.stringify(GUARD);
  if (cache?.sig === sig) return cache.c;
  const rules: Compiled["rules"] = [];
  for (const r of GUARD.rules as GuardRule[]) {
    if (!r.enabled || !r.value.trim()) continue;
    try {
      const source = r.kind === "word" ? `${B}${esc(norm(r.value.trim())).replace(/\s+/g, "\\s+")}[${L}]*` : r.value;
      rules.push({ id: r.id, re: new RegExp(source, "g"), weak: Boolean(r.weakNegation) });
    } catch { /* bozuk regex: kural atlanır (panel kaydederken zaten reddedilir) */ }
  }
  const negAfter = wordList(GUARD.negationAfter, false);
  const negWeak = wordList(GUARD.negationWeak, false);
  const before = splitList(GUARD.negationBefore);
  const negBefore = before.length ? new RegExp(`(${before.map((w) => esc(w).replace(/\s+/g, "\\s+")).join("|")})\\s+[^.!?\\n]{0,30}$`) : null;
  const whole = splitList(GUARD.optOutWhole);
  const optWhole = whole.length ? new RegExp(`^\\s*\\/?(${whole.map((w) => esc(w).replace(/\s+/g, "\\s*")).join("|")})[\\s.!]*$`) : null;
  let optPhrases: RegExp | null = null;
  const phrases = GUARD.optOutPhrases.split(",").map((x) => x.trim()).filter(Boolean);
  if (phrases.length) { try { optPhrases = new RegExp(phrases.map((p) => `(?:${p})`).join("|")); } catch { optPhrases = null; } }
  const rw = splitList(GUARD.resultWords);
  const resultWord = rw.length ? new RegExp(rw.map((w) => (w.length <= 3 ? `${B}${esc(w)}${E}` : esc(w).replace(/\s+/g, "\\s?"))).join("|")) : null;
  const pw = splitList(GUARD.promoWords);
  const promo = pw.length ? new RegExp(`${B}(${pw.map((w) => esc(w).replace(/\s+/g, "\\s+")).join("|")})`) : null;
  const c: Compiled = { rules, negAfter, negWeak, negBefore, optWhole, optPhrases, resultWord, promo };
  cache = { sig, c };
  return c;
}

/* ------------------------------------------------------------------ */
/*  Mesaj almak istemiyor                                              */
/* ------------------------------------------------------------------ */

export function isOptOut(text: string): boolean {
  const c = compile();
  const t = norm(text);
  return Boolean(c.optWhole?.test(t) || c.optPhrases?.test(t));
}

/* ------------------------------------------------------------------ */
/*  Yasak vaatler                                                      */
/* ------------------------------------------------------------------ */

const DIYE_YOK = /^diye\s+bir\s+şey\s+(yok|olmaz)/;

/** "garanti yok", "banko diye bir şey yok", "kimse garanti veremez" DÜRÜST cümlelerdir — izin ver. */
function isNegated(c: Compiled, t: string, index: number, matchLength: number, weak = false): boolean {
  const before = t.slice(Math.max(0, index - 45), index);
  if (c.negBefore?.test(before)) return true;
  const sentence = t.slice(index + matchLength).split(/[.!?\n]/)[0] ?? "";
  if (DIYE_YOK.test(sentence.trim())) return true;
  const tokens = sentence.trim().split(/\s+/).filter(Boolean).slice(0, 7);
  const re = weak ? c.negWeak : c.negAfter;
  return Boolean(re) && tokens.some((tok) => re!.test(tok));
}

const PERCENT = /%\s?(\d{1,3}(?:[.,]\d+)?)|(\d{1,3}(?:[.,]\d+)?)\s?%|yüzde\s+(\d{1,3}(?:[.,]\d+)?)/g;

function percentIn(t: string): { value: number; index: number; length: number }[] {
  PERCENT.lastIndex = 0;
  const out: { value: number; index: number; length: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = PERCENT.exec(t))) out.push({ value: Number((m[1] ?? m[2] ?? m[3] ?? "").replace(",", ".")), index: m.index, length: m[0].length });
  return out;
}

function hasUnverifiedStatistic(c: Compiled, t: string): boolean {
  if (!GUARD.checkStats || !c.resultWord) return false;
  const allowed = new Set(allowedStatNumbers().map((n) => Number(n.replace(",", "."))));
  for (const p of percentIn(t)) {
    const around = t.slice(Math.max(0, p.index - 45), p.index + p.length + 45);
    if (!c.resultWord.test(around)) continue;
    if (!allowed.has(p.value)) return true;
  }
  return false;
}

/** Metin geçmiş sonuç sayıları içeriyorsa true → zorunlu uyarı cümlesi gelmeli. */
export function quotesResults(text: string): boolean {
  const c = compile();
  if (!c.resultWord) return false;
  const t = norm(text);
  for (const p of percentIn(t)) {
    const around = t.slice(Math.max(0, p.index - 45), p.index + p.length + 45);
    if (c.resultWord.test(around)) return true;
  }
  return /birim/.test(t) && c.resultWord.test(t);
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
  if (!GUARD.enabled) return [];
  const c = compile();
  const t = norm(text);
  const found = new Set<string>();
  if (hasUnverifiedStatistic(c, t)) found.add("unverified_statistic");
  for (const rule of c.rules) {
    rule.re.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = rule.re.exec(t))) {
      if (!isNegated(c, t, match.index, match[0].length, rule.weak)) found.add(rule.id);
      if (match.index === rule.re.lastIndex) rule.re.lastIndex++;
    }
  }
  if (!BUSINESS.vip.activePromotion && c.promo) {
    const m = c.promo.exec(t);
    if (m && !isNegated(c, t, m.index, m[0].length)) found.add("invented_promotion");
  }
  if (GUARD.checkLinks && /https?:\/\/|t\.me\/|www\./.test(t)) found.add("raw_link");
  return [...found];
}

/** Panel testi: hangi kural hangi parçaya takıldı. */
export function explainClaims(text: string): { rule: string; label: string; match: string }[] {
  const c = compile();
  const t = norm(text);
  const out: { rule: string; label: string; match: string }[] = [];
  const labels = new Map<string, string>();
  for (const r of GUARD.rules as GuardRule[]) if (r.enabled) labels.set(r.value, r.label);
  for (const rule of c.rules) {
    rule.re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = rule.re.exec(t))) {
      if (!isNegated(c, t, m.index, m[0].length, rule.weak)) out.push({ rule: rule.id, label: labels.get(rule.re.source) ?? labels.get(rule.re.source.replace(new RegExp(`^${esc(B)}`), "").replace(new RegExp(`\\[${esc(L)}\\]\\*$`), "")) ?? rule.id, match: m[0] });
      if (m.index === rule.re.lastIndex) rule.re.lastIndex++;
    }
  }
  if (hasUnverifiedStatistic(c, t)) out.push({ rule: "unverified_statistic", label: "Doğrulanmamış isabet/kazanç yüzdesi", match: "%…" });
  if (!BUSINESS.vip.activePromotion && c.promo) { const m = c.promo.exec(t); if (m && !isNegated(c, t, m.index, m[0].length)) out.push({ rule: "invented_promotion", label: "Aktif kampanya yokken kampanya sözü", match: m[0] }); }
  if (GUARD.checkLinks && /https?:\/\/|t\.me\/|www\./.test(t)) out.push({ rule: "raw_link", label: "Çıplak link", match: "http/t.me/www" });
  return out;
}

/** Model tekrar tekrar güvensiz bir şey üretirse ya da çalışmıyorsa. */
export const SAFE_FALLBACK_REPLY = "İyi soru. Yanlış bilgi vermemek için bunu ekibe bir sorayım, olur mu?";
export const TECHNICAL_FALLBACK_REPLY = "Bir saniye takıldım 😅 Tekrar yazar mısın?";
