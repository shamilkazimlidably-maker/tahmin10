import { SAFE, type SafeKey } from "@/src/config/safe";
import { safeThemeCss } from "@/src/config/theme";

/** "Futbol Veri Merkezi" — botlara ve izin verilen ülkeler dışından gelenlere gösterilen bilgi sayfası. Telegram düğmesi ve piksel yoktur. */
export default function SafeLanding() {
  const S = (k: SafeKey) => SAFE[k].trim();
  const slug = (t: string) => t.toLowerCase().replace(/[^a-z0-9ğüşıöç]+/gi, "-").replace(/(^-|-$)/g, "").slice(0, 40) || "bolum";
  const cards = ([1, 2, 3] as const).map((n) => ({ t: S(`card${n}Title` as SafeKey), x: S(`card${n}Text` as SafeKey) })).filter((c) => c.t && c.x);
  const sections = ([1, 2, 3, 4, 5] as const)
    .map((n) => ({ title: S(`s${n}Title` as SafeKey), paras: [S(`s${n}p1` as SafeKey), S(`s${n}p2` as SafeKey)].filter(Boolean) }))
    .filter((s) => s.title && s.paras.length);
  const email = S("contactEmail");
  return (
    <div className="sf">
      <style dangerouslySetInnerHTML={{ __html: safeThemeCss() }} />
      <header className="sf__top">
        <span className="sf__brand">{S("brand")}</span>
        <nav className="sf__nav" aria-label="Bölümler">
          {sections.slice(0, 4).map((s) => (
            <a key={s.title} href={`#${slug(s.title)}`}>{s.title}</a>
          ))}
        </nav>
      </header>
      <main className="sf__main">
        <section className="sf__hero">
          <h1>{S("h1")}</h1>
          {S("tagline") && <p className="sf__tagline">{S("tagline")}</p>}
        </section>
        {cards.length > 0 && (
          <ul className="sf__cards">
            {cards.map((c) => (
              <li key={c.t}><b>{c.t}</b><span>{c.x}</span></li>
            ))}
          </ul>
        )}
        <section className="sf__section">
          <h2>{S("introTitle")}</h2>
          <p>{S("intro")}</p>
        </section>
        {sections.map((s) => (
          <section key={s.title} id={slug(s.title)} className="sf__section">
            <h2>{s.title}</h2>
            {s.paras.map((p, i) => <p key={i}>{p}</p>)}
          </section>
        ))}
        <section className="sf__section">
          <h2>{S("contactTitle")}</h2>
          <p>
            {S("contactText")} {email && <a href={`mailto:${email}`}>{email}</a>}
          </p>
        </section>
      </main>
      <footer className="sf__foot">
        <p>{S("footer")}</p>
      </footer>
    </div>
  );
}
