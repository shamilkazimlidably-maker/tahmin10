import Link from "next/link";
import JoinFreeButton, { StickyJoin } from "@/components/JoinFreeButton";
import { BUSINESS } from "@/src/config/business";
import { LANDING, type LandingKey } from "@/src/config/landing";
import { fill } from "@/src/config/texts";
import { loadSettings } from "@/src/lib/settings";

// Re-generated at most every 2 minutes so edits made in the admin panel show up here.
export const revalidate = 120;

export default async function Home() {
  await loadSettings();
  const L = (key: LandingKey) => fill(LANDING[key]).trim();
  const trust = [L("trust1"), L("trust2"), L("trust3")].filter(Boolean);
  const faq = ([1, 2, 3, 4] as const).map((n) => ({ q: L(`faq${n}Q`), a: L(`faq${n}A`) })).filter((f) => f.q && f.a);
  const steps = ([1, 2, 3] as const).map((n) => ({ title: L(`step${n}Title`), text: L(`step${n}Text`) }));
  const gets = BUSINESS.freeChannel.whatWePost.filter(Boolean);
  const bm = BUSINESS.brand.match(/^(.*?)(\d+)$/);
  const brandMark = bm ? (<>{bm[1]}<b>{bm[2]}</b></>) : BUSINESS.brand;

  return (
    <main className="page">
      <header className="top">
        <span className="brand">{brandMark}</span>
        <span className="age" title={`${BUSINESS.minimumAge} yaş üstü için içerik`}>+{BUSINESS.minimumAge}</span>
      </header>

      <section className="hero">
        <div className="hero__copy">
          {L("eyebrow") && <p className="chip">{L("eyebrow")}</p>}
          <h1>
            <span>{L("headline1")}</span>
            {L("headlineHighlight") && <span className="h1__mark">{L("headlineHighlight")}</span>}
            {L("headline2") && <span>{L("headline2")}</span>}
          </h1>
          <p className="lead">{L("lead")}</p>
          <JoinFreeButton id="hero-cta" label={L("cta")} hint={L("fallbackHint")} />
          {trust.length > 0 && (
            <ul className="trust">
              {trust.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          )}
          {L("micro") && <p className="micro">{L("micro")}</p>}
        </div>

        <figure className="tg" aria-label="Tahminin Telegram'a nasıl geldiğinin örneği. Gerçek bir tahmin değildir.">
          <p className="tg__heading">{L("previewTitle")}</p>
          <div className="tg__phone">
            <div className="tg__bar">
              <span className="tg__avatar" aria-hidden="true">10</span>
              <span className="tg__name">
                {BUSINESS.freeChannel.name}
                <small>kanal</small>
              </span>
            </div>
            <div className="tg__msg">
              <p className="tg__title">⚽ {L("previewLabel")}</p>
              <dl>
                <div><dt>Maç</dt><dd><i className="sk" style={{ width: "72%" }} /></dd></div>
                <div><dt>Market</dt><dd><i className="sk" style={{ width: "48%" }} /></dd></div>
                <div><dt>Neden</dt><dd><i className="sk" style={{ width: "94%" }} /><i className="sk" style={{ width: "63%" }} /></dd></div>
              </dl>
              <span className="tg__time">her gün</span>
            </div>
          </div>
          {L("previewCaption") && <figcaption>{L("previewCaption")}</figcaption>}
        </figure>
      </section>

      <section className="block" aria-labelledby="how-title">
        <h2 id="how-title">{L("howTitle")}</h2>
        <ol className="steps">
          {steps.map((s) => (
            <li key={s.title}>
              <b>{s.title}</b>
              <span>{s.text}</span>
            </li>
          ))}
        </ol>
      </section>

      {gets.length > 0 && (
        <section className="block" aria-labelledby="gets-title">
          <h2 id="gets-title">{L("benefitsTitle")}</h2>
          <ul className="gets">
            {gets.map((g) => (
              <li key={g}>{g}</li>
            ))}
          </ul>
        </section>
      )}

      <section className="block honest" aria-labelledby="honest-title">
        <h2 id="honest-title">{L("honestTitle")}</h2>
        <p>{L("honestText")}</p>
      </section>

      {faq.length > 0 && (
        <section className="block" aria-labelledby="faq-title">
          <h2 id="faq-title">{L("faqTitle")}</h2>
          <div className="faq">
            {faq.map((f) => (
              <details key={f.q}>
                <summary>{f.q}</summary>
                <p>{f.a}</p>
              </details>
            ))}
          </div>
        </section>
      )}

      <section className="block final">
        <JoinFreeButton label={L("cta2")} hint={L("fallbackHint")} />
        {trust.length > 0 && <p className="micro">{trust.join(" · ")}</p>}
      </section>

      <footer className="foot">
        <p>
          <strong>+{BUSINESS.minimumAge}.</strong> {L("footer")}
        </p>
        <p>
          <Link href="/gizlilik">Gizlilik</Link>
        </p>
      </footer>

      <StickyJoin text={L("stickyText")} label={L("cta")} />
    </main>
  );
}
