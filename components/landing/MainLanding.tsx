import Link from "next/link";
import JoinFreeButton, { StickyJoin } from "@/components/JoinFreeButton";
import MetaPixel from "@/components/MetaPixel";
import { metaConfig } from "@/src/lib/integrations";
import { BUSINESS } from "@/src/config/business";
import { LANDING, type LandingKey } from "@/src/config/landing";
import { fill } from "@/src/config/texts";
import { loadSettings } from "@/src/lib/settings";
import { landingThemeCss, THEME } from "@/src/config/theme";

/** Ana açılış sayfası (gerçek ziyaretçiler). Metinler panel → Açılış Sayfası. */
export default async function MainLanding() {
  await loadSettings();
  const L = (key: LandingKey) => fill(LANDING[key]).trim();
  const trust = [L("trust1"), L("trust2"), L("trust3")].filter(Boolean);
  const faq = ([1, 2, 3, 4] as const).map((n) => ({ q: L(`faq${n}Q`), a: L(`faq${n}A`) })).filter((f) => f.q && f.a);
  const steps = ([1, 2, 3] as const).map((n) => ({ title: L(`step${n}Title`), text: L(`step${n}Text`) }));
  const gets = BUSINESS.freeChannel.whatWePost.filter(Boolean);
  const bm = (L("brandMark") || BUSINESS.brand).match(/^(.*?)(\d+)$/);
  const brandMark = bm ? (<>{bm[1]}<b>{bm[2]}</b></>) : L("brandMark") || BUSINESS.brand;
  const T = THEME;

  return (
    <main className="page">
      <style dangerouslySetInnerHTML={{ __html: landingThemeCss() }} />
      <header className="top">
        <span className="brand">{brandMark}</span>
        {T.showAgeBadge && <span className="age" title={`${BUSINESS.minimumAge} yaş üstü için içerik`}>{L("ageBadge") || `+${BUSINESS.minimumAge}`}</span>}
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

        {T.showPreview && <figure className="tg" aria-label="Tahminin Telegram'a nasıl geldiğinin örneği. Gerçek bir tahmin değildir.">
          <p className="tg__heading">{L("previewTitle")}</p>
          <div className="tg__phone">
            <div className="tg__bar">
              <span className="tg__avatar" aria-hidden="true">{L("previewAvatar")}</span>
              <span className="tg__name">
                {BUSINESS.freeChannel.name}
                {L("previewSmall") && <small>{L("previewSmall")}</small>}
              </span>
            </div>
            <div className="tg__msg">
              <p className="tg__title">⚽ {L("previewLabel")}</p>
              <dl>
                <div><dt>{L("previewRow1")}</dt><dd><i className="sk" style={{ width: "72%" }} /></dd></div>
                <div><dt>{L("previewRow2")}</dt><dd><i className="sk" style={{ width: "48%" }} /></dd></div>
                <div><dt>{L("previewRow3")}</dt><dd><i className="sk" style={{ width: "94%" }} /><i className="sk" style={{ width: "63%" }} /></dd></div>
              </dl>
              {L("previewTime") && <span className="tg__time">{L("previewTime")}</span>}
            </div>
          </div>
          {L("previewCaption") && <figcaption>{L("previewCaption")}</figcaption>}
        </figure>}
      </section>

      {T.showHow && <section className="block" aria-labelledby="how-title">
        <h2 id="how-title">{L("howTitle")}</h2>
        <ol className="steps">
          {steps.map((s) => (
            <li key={s.title}>
              <b>{s.title}</b>
              <span>{s.text}</span>
            </li>
          ))}
        </ol>
      </section>}

      {T.showBenefits && gets.length > 0 && (
        <section className="block" aria-labelledby="gets-title">
          <h2 id="gets-title">{L("benefitsTitle")}</h2>
          <ul className="gets">
            {gets.map((g) => (
              <li key={g}>{g}</li>
            ))}
          </ul>
        </section>
      )}

      {T.showHonest && <section className="block honest" aria-labelledby="honest-title">
        <h2 id="honest-title">{L("honestTitle")}</h2>
        <p>{L("honestText")}</p>
      </section>}

      {T.showFaq && faq.length > 0 && (
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

      {T.showFinal && <section className="block final">
        <JoinFreeButton label={L("cta2")} hint={L("fallbackHint")} />
        {trust.length > 0 && <p className="micro">{trust.join(" · ")}</p>}
      </section>}

      {T.showFooter && <footer className="foot">
        <p>
          <strong>+{BUSINESS.minimumAge}.</strong> {L("footer")}
        </p>
        <p>
          <Link href="/gizlilik">Gizlilik</Link>
        </p>
      </footer>}

      {T.showSticky && <StickyJoin text={L("stickyText")} label={L("cta")} />}
      <MetaPixel pixelId={metaConfig().pixelId} />
    </main>
  );
}
