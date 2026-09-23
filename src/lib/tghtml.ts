/**
 * Telegram-HTML: yalnızca Telegram'ın kabul ettiği etiketler geçer, gerisi düz metin olur.
 * Hem sunucuda (göndermeden önce) hem panelde (önizleme) kullanılır; bağımlılığı yoktur.
 * İzinli: <b> <i> <u> <s> <tg-spoiler> <code> <pre> <blockquote> <a href="http(s)://…|tg://…">
 */
const TAGS = new Set(["b", "i", "u", "s", "tg-spoiler", "code", "pre", "blockquote"]);
const TAG_RE = /<\/?([a-z-]+)((?:\s+href="[^"<>]*")?)\s*>/gi;

export function sanitizeTelegramHtml(input: string): string {
  const text = input.replace(/\r\n/g, "\n");
  let out = "";
  let last = 0;
  const open: string[] = [];
  TAG_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TAG_RE.exec(text))) {
    out += escapeText(text.slice(last, m.index));
    last = m.index + m[0].length;
    const closing = m[0].startsWith("</");
    const tag = m[1]!.toLowerCase();
    const attr = m[2] ?? "";
    let keep = false;
    if (tag === "a") {
      const href = attr.match(/href="([^"]*)"/)?.[1] ?? "";
      keep = closing ? open.at(-1) === "a" : /^(https?:\/\/|tg:\/\/)/i.test(href);
      if (keep && !closing) { out += `<a href="${href.replace(/&/g, "&amp;")}">`; open.push("a"); continue; }
    } else if (TAGS.has(tag)) {
      keep = closing ? open.at(-1) === tag : true;
    }
    if (!keep) { out += escapeText(m[0]); continue; }
    if (closing) { open.pop(); out += `</${tag}>`; } else { open.push(tag); out += `<${tag}>`; }
  }
  out += escapeText(text.slice(last));
  while (open.length) out += `</${open.pop()}>`; // kapatılmamış etiketleri kapat
  return out;
}

function escapeText(s: string): string {
  return s.replace(/&(?!(amp|lt|gt|quot|#\d+);)/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Etiketler hariç görünen karakter sayısı (Telegram sınırı: metin 4096, görsel altı 1024). */
export function visibleLength(html: string): number {
  return sanitizeTelegramHtml(html).replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").length;
}

/** Panel önizlemesi için tarayıcı HTML'i (spoiler ve alıntı stillenir). */
export function previewHtml(html: string): string {
  return sanitizeTelegramHtml(html)
    .replace(/<tg-spoiler>/g, '<span class="tg-spoiler">').replace(/<\/tg-spoiler>/g, "</span>")
    .replace(/<a href="/g, '<a target="_blank" rel="noreferrer" href="')
    .replace(/\n/g, "<br/>");
}
