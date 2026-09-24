/**
 * TASARIM — açılış sayfası ve Veri Merkezi sayfasının renkleri, yazı tipleri, bölüm görünürlükleri ve özel CSS.
 * Varsayılanlar burada; panel → Gelişmiş Ayarlar → Tasarım (src/lib/settings.ts uygular).
 */
export const THEME = {
  /* --- açılış sayfası --- */
  lpBg1: "#0b3d24",            // üst zemin (çim)
  lpBg2: "#052417",            // alt zemin (gece)
  lpAccent: "#ffd60a",         // vurgu / düğme (sarı)
  lpAccentDeep: "#b59500",     // düğme gölgesi
  lpText: "#f6f4ea",           // ana yazı
  lpMutedOpacity: 78,          // ikincil yazı saydamlığı (%)
  lpCtaText: "#10241a",        // düğme yazısı
  lpFontDisplay: "condensed" as "condensed" | "system" | "serif" | "rounded" | "mono",
  lpFontBody: "system" as "system" | "serif" | "rounded" | "mono",
  lpRadius: 16,                // köşe yuvarlaklığı (px)
  lpStripes: true,             // çim çizgileri
  lpHeroLayout: "side" as "side" | "stack", // geniş ekranda örnek mesaj yanda mı, altta mı
  lpCtaUppercase: false,
  showAgeBadge: true,
  showPreview: true,
  showHow: true,
  showBenefits: true,
  showHonest: true,
  showFaq: true,
  showFinal: true,
  showSticky: true,
  showFooter: true,
  /** Sayfanın sonuna eklenen serbest CSS (yalnızca siz görürsünüz; bilmiyorsanız boş bırakın). */
  lpCustomCss: "",

  /* --- Futbol Veri Merkezi --- */
  sfHeader: "#0f2a44",
  sfAccent: "#0f4c81",
  sfBg: "#f4f6f8",
  sfText: "#14212b",
  sfCustomCss: "",
};
export type ThemeSettings = typeof THEME;

const FONTS: Record<string, string> = {
  condensed: '"Avenir Next Condensed", "Roboto Condensed", "sans-serif-condensed", "Arial Narrow", "Helvetica Neue", Arial, sans-serif',
  system: 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  serif: 'Georgia, "Times New Roman", "Noto Serif", serif',
  rounded: '"SF Pro Rounded", "Nunito", "Varela Round", "Segoe UI", system-ui, sans-serif',
  mono: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
};

const HEX = /^#[0-9a-f]{6}$/i;
const hexToRgb = (h: string) => `${parseInt(h.slice(1, 3), 16)}, ${parseInt(h.slice(3, 5), 16)}, ${parseInt(h.slice(5, 7), 16)}`;
export const isHex = (v: unknown): v is string => typeof v === "string" && HEX.test(v);
/** Özel CSS'i <style> etiketinin içinde tutar. */
export const safeCss = (css: string) => css.replace(/<\/?style/gi, "").replace(/<script/gi, "").slice(0, 8000);

/** Açılış sayfasına eklenen CSS (globals.css'teki değişkenlerin üstüne yazar). */
export function landingThemeCss(): string {
  const t = THEME;
  const vars = [
    isHex(t.lpBg1) && `--pitch:${t.lpBg1}`, isHex(t.lpBg2) && `--night:${t.lpBg2}`, isHex(t.lpAccent) && `--canary:${t.lpAccent}`, isHex(t.lpAccentDeep) && `--canary-deep:${t.lpAccentDeep}`,
    isHex(t.lpText) && `--chalk:${t.lpText}`, isHex(t.lpText) && `--muted:rgba(${hexToRgb(t.lpText)},${Math.min(100, Math.max(20, t.lpMutedOpacity)) / 100})`, isHex(t.lpText) && `--line:rgba(${hexToRgb(t.lpText)},0.15)`,
    isHex(t.lpCtaText) && `--ink:${t.lpCtaText}`, `--display:${FONTS[t.lpFontDisplay] ?? FONTS.condensed}`, `--body:${FONTS[t.lpFontBody] ?? FONTS.system}`,
  ].filter(Boolean).join(";");
  const r = Math.min(40, Math.max(0, t.lpRadius));
  return [
    `:root{${vars}}`,
    `.cta{border-radius:${r}px}.gets{border-radius:${r + 2}px}.tg__phone{border-radius:${r + 8}px}.chip,.eyebrow{border-radius:999px}`,
    t.lpStripes ? "" : "body{background:radial-gradient(90% 55% at 50% -5%, rgba(255,255,255,0.10), transparent 70%),linear-gradient(180deg, var(--pitch) 0%, var(--night) 70%)}",
    t.lpHeroLayout === "stack" ? "@media (min-width: 880px){.hero{grid-template-columns:1fr;justify-items:center;text-align:center}.hero__copy{display:grid;justify-items:center}.lead,.micro{margin-left:auto;margin-right:auto}}" : "",
    t.lpCtaUppercase ? ".cta span{text-transform:uppercase}" : "",
    safeCss(t.lpCustomCss),
  ].join("\n");
}

export function safeThemeCss(): string {
  const t = THEME;
  return [
    `.sf{${isHex(t.sfBg) ? `background:${t.sfBg};` : ""}${isHex(t.sfText) ? `color:${t.sfText};` : ""}}`,
    isHex(t.sfHeader) ? `.sf__top{background:${t.sfHeader}}.sf__hero h1,.sf__section h2{color:${t.sfHeader}}` : "",
    isHex(t.sfAccent) ? `.sf a,.sf__cards b{color:${t.sfAccent}}` : "",
    safeCss(t.sfCustomCss),
  ].join("\n");
}
