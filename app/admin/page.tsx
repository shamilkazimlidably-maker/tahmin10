"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { previewHtml } from "@/src/lib/tghtml";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

/* =====================================================================
 *  TAHMİN10 — Yönetim Paneli  (/admin)
 *  Tek dosya. Tüm işlemler /api/admin üzerinden yapılır.
 *  Arayüz ve bot Türkçe.
 * ===================================================================== */

type Any = any;
class AuthError extends Error {}

async function api(action: string, body: Record<string, unknown> = {}): Promise<Any> {
  const r = await fetch("/api/admin", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, ...body }) });
  const j = await r.json().catch(() => ({ error: "Sunucudan geçersiz cevap geldi." }));
  if (r.status === 401 && action !== "login") throw new AuthError("Oturum süresi doldu.");
  if (!r.ok) throw new Error(j.error || "Bir hata oluştu.");
  return j;
}
const notify = (text: string, bad = false) => window.dispatchEvent(new CustomEvent("adm-toast", { detail: { text, bad } }));

function useBusy() {
  const [busy, setBusy] = useState<string | null>(null);
  const run = useCallback(async (key: string, fn: () => Promise<void>, ok?: string) => {
    setBusy(key);
    try {
      await fn();
      if (ok) notify(ok);
    } catch (e) {
      if (e instanceof AuthError) window.dispatchEvent(new Event("adm-auth"));
      else notify((e as Error).message, true);
    } finally {
      setBusy(null);
    }
  }, []);
  return [busy, run] as const;
}

function setIn<T>(obj: T, path: (string | number)[], value: unknown): T {
  if (!path.length) return value as T;
  const [k, ...rest] = path;
  const copy: Any = Array.isArray(obj) ? [...obj] : { ...(obj as Any) };
  copy[k!] = setIn(copy[k!], rest, value);
  return copy;
}
const when = (iso?: string | null) => (iso ? new Date(iso).toLocaleString("tr-TR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "–");
const pct = (a: number, b: number) => (b > 0 ? `%${((a / b) * 100).toFixed(1)}` : "–");
const money = (v: unknown) => `₺${Number(v ?? 0).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const STAGE_TR: Record<string, string> = { NEW: "Yeni geldi", DISCOVERY: "Tanışma", FREE_INVITED: "Ücretsiz kanala davet edildi", ENGAGED: "Ücretsiz kanalda", VIP_OFFERED: "VIP teklif edildi", CHECKOUT: "Ödeme sayfasında", PAID: "VIP müşteri", NOT_INTERESTED: "VIP istemiyor", ANY: "Her aşama" };
const PLAN_TR: Record<string, string> = { weekly: "Haftalık", monthly: "Aylık", three_months: "3 Aylık" };
const SIGNAL_TR: Record<string, string> = {
  follows_football: "Futbol takip ediyor", uses_predictions: "Tahmin kullanıyor / kullanmak istiyor", frequent_user: "Tahminleri sık takip ediyor", follows_specific_league: "Belirli bir lig/takım söyledi",
  values_analysis: "Analize değer veriyor", compares_sources: "Başka kanalları da takip ediyor", paid_before: "Daha önce tahmin için para ödemiş", wants_more_content: "Daha fazla tahmin istiyor",
  positive_reaction: "Ücretsiz içeriğe olumlu tepki", asks_about_vip: "VIP'i kendisi sordu", asks_whats_included: "VIP'te ne var diye sordu", asks_about_price: "Fiyat sordu", asks_about_access: "Nasıl girilir / ödenir diye sordu",
  asks_about_results: "Sonuçları / geçmişi sordu", explicit_purchase_intent: "Açıkça satın almak istediğini söyledi", objection_resolved: "İtirazı çözüldü, devam etti", renewed_interest: "Tereddütten sonra yeniden ilgilendi",
  objection_price: "İtiraz: pahalı", objection_trust: "İtiraz: güvenmiyor", objection_value: "İtiraz: ücretsizden farkını görmüyor", explicit_no: "Açıkça istemediğini söyledi",
  returned_to_bot: "Başka bir gün geri yazdı", joined_free_channel: "Ücretsiz kanala girdi (doğrulandı)", clicked_vip_plan: "Bir plana tıkladı", checkout_started: "Ödeme sayfasını açtı",
};
const QUALITY_TR: Record<string, string> = { answered_questions: "Sorulara cevap verdi", brevity: "Kısa ve net", relevance: "Konuyla ilgili", no_repetition: "Kendini tekrar etmedi", offer_timing: "Teklif zamanlaması", honesty: "Dürüstlük" };

/* ------------------------------ stil ------------------------------ */
const CSS = `
.adm{position:fixed;inset:0;overflow:auto;background:#fff;color:#17231c;font:15px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;z-index:10}
.adm *{box-sizing:border-box}
.adm h1,.adm h2,.adm h3{font-family:inherit;letter-spacing:0;color:#0f1a14;margin:0;text-wrap:initial}
.adm h1{font-size:19px;line-height:1.2;font-weight:800}.adm h2{font-size:18px;line-height:1.3;font-weight:700}.adm h3{font-size:15px;font-weight:700}
.adm p{margin:0}.adm a{color:#0b7a3b}
.a-top{position:sticky;top:0;z-index:5;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 18px;background:#fff;border-bottom:1px solid #e6ebe8}
.a-top b{color:#0b7a3b}
.a-shell{display:grid;grid-template-columns:230px 1fr;min-height:calc(100vh - 56px)}
.a-nav{border-right:1px solid #e6ebe8;padding:14px 10px;display:flex;flex-direction:column;gap:4px;background:#fafcfb}
.a-nav button{all:unset;cursor:pointer;padding:11px 12px;border-radius:10px;font-weight:600;color:#33443b;display:flex;justify-content:space-between;align-items:center;gap:8px}
.a-nav button:hover{background:#eef4f0}.a-nav button.on{background:#0b7a3b;color:#fff}
.a-main{padding:22px;max-width:1180px;width:100%}
.a-intro{color:#55655c;margin:4px 0 18px;max-width:70ch}
.a-card{border:1px solid #e1e8e4;border-radius:14px;padding:18px;margin-bottom:16px;background:#fff}
.a-card>header{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:12px;flex-wrap:wrap}
.a-desc{color:#5b6b62;font-size:13.5px;margin-top:3px;max-width:75ch}
.a-field{margin-bottom:14px}.a-field>label{display:block;font-weight:650;margin-bottom:4px}
.a-help{color:#66776d;font-size:13px;margin:2px 0 6px}
.adm input,.adm textarea,.adm select{width:100%;font:inherit;color:inherit;background:#fff;border:1.5px solid #cfd9d3;border-radius:10px;padding:9px 11px}
.adm textarea{resize:vertical;line-height:1.45}.adm input:focus,.adm textarea:focus,.adm select:focus{outline:none;border-color:#0b7a3b;box-shadow:0 0 0 3px #0b7a3b22}
.a-mono{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:13px}
.a-btn{all:unset;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:6px;padding:10px 16px;border-radius:10px;font-weight:700;background:#0b7a3b;color:#fff;text-align:center;min-height:22px}
.a-btn:hover{filter:brightness(1.07)}.a-btn:focus-visible{outline:3px solid #0b7a3b55;outline-offset:2px}
.a-btn.ghost{background:#fff;color:#0b7a3b;box-shadow:inset 0 0 0 1.5px #0b7a3b}.a-btn.soft{background:#eef4f0;color:#1d3a2a}.a-btn.danger{background:#fff;color:#b3261e;box-shadow:inset 0 0 0 1.5px #b3261e}
.a-btn.small{padding:6px 11px;font-size:13.5px}.a-btn[aria-disabled=true]{opacity:.55;pointer-events:none}
.a-row{display:flex;gap:10px;flex-wrap:wrap;align-items:center}.a-grid2{display:grid;grid-template-columns:1fr 1fr;gap:14px}.a-grid3{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}
.a-pill{display:inline-block;padding:2px 9px;border-radius:999px;font-size:12.5px;font-weight:700;background:#eef2f0;color:#3c4d44;white-space:nowrap}
.a-pill.green{background:#dff3e7;color:#0b6a33}.a-pill.red{background:#fde7e5;color:#a3241d}.a-pill.amber{background:#fff1d6;color:#8a5a00}.a-pill.blue{background:#e3edff;color:#1f3fbf}
.a-stats{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:16px}
.a-stat{border:1px solid #e1e8e4;border-radius:14px;padding:14px}.a-stat b{display:block;font-size:26px;line-height:1.1}.a-stat span{color:#5b6b62;font-size:13px}
.a-bar{height:10px;border-radius:6px;background:#eef2f0;overflow:hidden}.a-bar>i{display:block;height:100%;background:#0b7a3b;border-radius:6px}
.a-funnel{display:grid;grid-template-columns:230px 1fr 130px;gap:10px;align-items:center;padding:7px 0;border-bottom:1px dashed #e6ebe8;font-size:14px}
.a-warn{background:#fff7e0;border:1px solid #f1d58a;color:#6b4a00;border-radius:12px;padding:12px 14px;margin-bottom:14px;font-size:14px}
.a-info{background:#eef6ff;border:1px solid #c6dbfb;color:#1b3a73;border-radius:12px;padding:12px 14px;margin-bottom:14px;font-size:14px}
.a-lock{background:#f6f7f6;border:1px dashed #b9c5be;border-radius:12px;padding:12px 14px;white-space:pre-wrap;font-size:13px;color:#44544b;max-height:320px;overflow:auto}
.a-table{width:100%;border-collapse:collapse;font-size:14px}.a-table th{text-align:left;color:#5b6b62;font-weight:650;font-size:12.5px;padding:6px 8px;border-bottom:1.5px solid #e1e8e4}.a-table td{padding:8px;border-bottom:1px solid #eef2f0;vertical-align:top}
.a-scroll{overflow-x:auto}
.a-conv{display:grid;grid-template-columns:340px 1fr;gap:16px;align-items:start}
.a-list{border:1px solid #e1e8e4;border-radius:14px;overflow:hidden;max-height:78vh;overflow-y:auto}
.a-item{all:unset;display:block;cursor:pointer;padding:11px 13px;border-bottom:1px solid #eef2f0;width:100%}.a-item:hover{background:#f5f9f6}.a-item.on{background:#e7f4ec}
.a-chat{display:flex;flex-direction:column;gap:8px;max-height:60vh;overflow-y:auto;padding:12px;background:#f7faf8;border-radius:12px;border:1px solid #e6ebe8}
.a-msg{max-width:82%;padding:8px 12px;border-radius:14px;white-space:pre-wrap;word-break:break-word;font-size:14.5px}
.a-msg.user{align-self:flex-start;background:#fff;border:1px solid #dfe7e2}.a-msg.assistant{align-self:flex-end;background:#d9f2e2}.a-msg.event{align-self:center;background:none;color:#7a8a81;font-size:12.5px;text-align:center;padding:2px}
.a-msg small{display:block;color:#7a8a81;font-size:11.5px;margin-top:3px}.a-msg em{display:block;font-style:normal;color:#1f3fbf;border-top:1px dashed #b9c5be;margin-top:5px;padding-top:4px}
.a-del{all:unset;cursor:pointer;float:right;margin-left:10px;opacity:.3;font-size:13px}.a-del:hover{opacity:1}
.a-stars button{all:unset;cursor:pointer;font-size:30px;line-height:1;color:#cfd9d3;padding:0 3px}.a-stars button.on{color:#f0a800}
.a-toast{position:fixed;right:16px;bottom:16px;z-index:50;max-width:min(440px,92vw);padding:12px 16px;border-radius:12px;background:#0f1a14;color:#fff;white-space:pre-wrap;box-shadow:0 8px 30px #0003;font-size:14px}.a-toast.bad{background:#a3241d}
.a-login{min-height:100vh;display:grid;place-items:center;padding:20px;background:#f7faf8}.a-login form,.a-login .a-card{width:min(400px,100%)}
.a-listedit{display:flex;gap:8px;margin-bottom:8px;align-items:flex-start}
@media (max-width:900px){.a-shell{grid-template-columns:1fr}.a-nav{flex-direction:row;overflow-x:auto;border-right:0;border-bottom:1px solid #e6ebe8;padding:8px}.a-nav button{white-space:nowrap;padding:9px 12px}
.a-main{padding:14px}.a-stats{grid-template-columns:1fr 1fr}.a-grid2,.a-grid3{grid-template-columns:1fr}.a-conv{grid-template-columns:1fr}.a-conv.open .a-listwrap{display:none}.a-conv:not(.open) .a-detail{display:none}.a-funnel{grid-template-columns:1fr 90px}.a-funnel .a-bar{display:none}}
`;

/* ------------------------------ parçalar ------------------------------ */
function Card({ title, desc, right, children }: { title?: ReactNode; desc?: ReactNode; right?: ReactNode; children?: ReactNode }) {
  return (
    <section className="a-card">
      {(title || right) && (
        <header>
          <div>
            {title && <h2>{title}</h2>}
            {desc && <p className="a-desc">{desc}</p>}
          </div>
          {right}
        </header>
      )}
      {children}
    </section>
  );
}
function Field({ label, help, children }: { label: ReactNode; help?: ReactNode; children: ReactNode }) {
  return (
    <div className="a-field">
      <label>{label}</label>
      {help && <p className="a-help">{help}</p>}
      {children}
    </div>
  );
}
function Txt({ value, onChange, rows, placeholder, mono }: { value: string | null | undefined; onChange: (v: string) => void; rows?: number; placeholder?: string; mono?: boolean }) {
  return rows ? (
    <textarea className={mono ? "a-mono" : ""} rows={rows} value={value ?? ""} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
  ) : (
    <input value={value ?? ""} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
  );
}
function Num({ value, onChange, min, max, step }: { value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number }) {
  return <input type="number" inputMode="decimal" value={Number.isFinite(value) ? value : 0} min={min} max={max} step={step ?? 1} onChange={(e) => onChange(e.target.value === "" ? 0 : Number(e.target.value))} />;
}
function Btn({ children, onClick, kind, small, busy, disabled }: { children: ReactNode; onClick?: () => void; kind?: "ghost" | "soft" | "danger"; small?: boolean; busy?: boolean; disabled?: boolean }) {
  return (
    <button type="button" className={`a-btn ${kind ?? ""} ${small ? "small" : ""}`} aria-disabled={busy || disabled} onClick={onClick}>
      {busy ? "Bekleyin…" : children}
    </button>
  );
}
function Pill({ children, tone }: { children: ReactNode; tone?: "green" | "red" | "amber" | "blue" }) {
  return <span className={`a-pill ${tone ?? ""}`}>{children}</span>;
}
function ListEdit({ items, onChange, placeholder, rows }: { items: string[]; onChange: (v: string[]) => void; placeholder?: string; rows?: number }) {
  return (
    <div>
      {items.map((it, i) => (
        <div className="a-listedit" key={i}>
          <Txt value={it} rows={rows} onChange={(v) => onChange(items.map((x, j) => (j === i ? v : x)))} />
          <Btn kind="danger" small onClick={() => onChange(items.filter((_, j) => j !== i))}>Sil</Btn>
        </div>
      ))}
      <Btn kind="soft" small onClick={() => onChange([...items, ""])}>+ {placeholder ?? "Satır ekle"}</Btn>
    </div>
  );
}
function SaveBar({ onSave, onReset, busy, dirty }: { onSave: () => void; onReset: () => void; busy: string | null; dirty: boolean }) {
  return (
    <div className="a-row" style={{ position: "sticky", bottom: 0, background: "#fff", padding: "12px 0", borderTop: "1px solid #e6ebe8", zIndex: 2 }}>
      <Btn onClick={onSave} busy={busy === "save"}>Kaydet ve hemen uygula</Btn>
      <Btn kind="danger" onClick={() => window.confirm("Bu bölümdeki TÜM değişiklikleriniz silinsin ve ilk ayarlara dönülsün mü?") && onReset()} busy={busy === "reset"}>Varsayılana dön</Btn>
      {dirty && <Pill tone="amber">Kaydedilmemiş değişiklik var</Pill>}
      <span className="a-help">Kaydettikten sonra bot yaklaşık 30 saniye içinde yeni ayarları kullanır. Yeniden yayınlamaya (redeploy) gerek yok.</span>
    </div>
  );
}

/* =====================================================================
 *  1. GENEL BAKIŞ
 * ===================================================================== */
const FUNNEL_STEPS: [string, string][] = [
  ["landing_leads", "Sitede butona basan"], ["started_bot", "Botu başlatan"], ["replied", "Bota cevap yazan"], ["invited_free", "Ücretsiz kanala davet edilen"],
  ["joined_free", "Ücretsiz kanala giren"], ["saw_plans", "VIP planlarını gören"], ["checkout", "Ödeme sayfasını açan"], ["paid", "Satın alan"],
];

function Overview({ go }: { go: (tab: string) => void }) {
  const [days, setDays] = useState(7);
  const [d, setD] = useState<Any>(null);
  const [, run] = useBusy();
  useEffect(() => {
    run("load", async () => setD(await api("overview", { days })));
  }, [days, run]);
  const f = d?.period ?? {};
  const top = Math.max(1, ...FUNNEL_STEPS.map(([k]) => Number(f[k] ?? 0)));
  return (
    <>
      <h1>Genel Bakış</h1>
      <p className="a-intro">Seçtiğiniz dönemde gelen kişilerin satış hunisinde nereye kadar ilerlediğini gösterir. En büyük düşüşün olduğu adım, geliştirmeniz gereken yerdir.</p>
      <div className="a-row" style={{ marginBottom: 14 }}>
        {[[1, "Son 24 saat"], [7, "Son 7 gün"], [30, "Son 30 gün"], [0, "Tüm zamanlar"]].map(([v, l]) => (
          <Btn key={v} small kind={days === v ? undefined : "soft"} onClick={() => setDays(Number(v))}>{l}</Btn>
        ))}
      </div>
      {d && (d.alerts.needsHuman > 0 || d.alerts.unlinked > 0 || d.alerts.proposals > 0 || d.alerts.tickets > 0) && (
        <div className="a-warn">
          <b>Sizi bekleyen işler:</b>
          <div className="a-row" style={{ marginTop: 8 }}>
            {d.alerts.tickets > 0 && <Btn small kind="ghost" onClick={() => go("destek")}>{d.alerts.tickets} destek talebi açık (Telegram'dan “Cevapla” ile cevaplayın)</Btn>}
            {d.alerts.needsHuman > 0 && <Btn small kind="ghost" onClick={() => go("konusmalar")}>{d.alerts.needsHuman} kişi insan desteği istiyor</Btn>}
            {d.alerts.unlinked > 0 && <Btn small kind="ghost" onClick={() => go("odemeler")}>{d.alerts.unlinked} ödeme kişiye bağlanamadı</Btn>}
            {d.alerts.proposals > 0 && <Btn small kind="ghost" onClick={() => go("ogrenme")}>{d.alerts.proposals} yeni satış önerisi onayınızı bekliyor</Btn>}
          </div>
        </div>
      )}
      <div className="a-stats">
        <div className="a-stat"><b>{f.started_bot ?? 0}</b><span>Botu başlatan kişi</span></div>
        <div className="a-stat"><b>{f.joined_free ?? 0}</b><span>Ücretsiz kanala giren</span></div>
        <div className="a-stat"><b>{f.paid ?? 0}</b><span>Satın alan · dönüşüm {pct(f.paid ?? 0, f.started_bot ?? 0)}</span></div>
        <div className="a-stat"><b>{money(f.revenue)}</b><span>Bu kişilerden gelen gelir</span></div>
      </div>
      <Card title="Satış hunisi" desc="Her satırdaki yüzde, bir önceki adıma göre kaç kişinin devam ettiğini gösterir.">
        {FUNNEL_STEPS.map(([k, label], i) => {
          const v = Number(f[k] ?? 0);
          const prev = i ? Number(f[FUNNEL_STEPS[i - 1]![0]] ?? 0) : 0;
          return (
            <div className="a-funnel" key={k}>
              <span>{label}</span>
              <div className="a-bar"><i style={{ width: `${(v / top) * 100}%` }} /></div>
              <span><b>{v}</b> {i > 0 && <span className="a-help">({pct(v, prev)})</span>}</span>
            </div>
          );
        })}
        <p className="a-help" style={{ marginTop: 10 }}>VIP istemeyen: {f.not_interested ?? 0} · Mesaj istemeyen: {f.opted_out ?? 0} · Botu engelleyen: {f.blocked ?? 0} · Satış kapatılan (yaş/risk): {f.do_not_sell ?? 0}</p>
      </Card>
      <div className="a-grid2">
        <Card title="Reklam kampanyaları" desc="Hangi kampanya / reklam gerçekten satış getiriyor?">
          <div className="a-scroll">
            <table className="a-table">
              <thead><tr><th>Kampanya / reklam</th><th>Gelen</th><th>Başlatan</th><th>Kanal</th><th>Ödeme</th><th>Satış</th><th>Gelir</th></tr></thead>
              <tbody>
                {(d?.campaigns ?? []).map((c: Any, i: number) => (
                  <tr key={i}><td>{c.campaign ?? "(kampanyasız)"}<br /><span className="a-help">{c.ad ?? ""}</span></td><td>{c.leads}</td><td>{c.started}</td><td>{c.joined_free}</td><td>{c.checkout}</td><td><b>{c.paid}</b></td><td>{money(c.revenue)}</td></tr>
                ))}
                {!d?.campaigns?.length && <tr><td colSpan={7} className="a-help">Henüz veri yok.</td></tr>}
              </tbody>
            </table>
          </div>
        </Card>
        <Card title="İnsanlar neye itiraz ediyor?" desc="Botun konuşmalarda yakaladığı itirazlar.">
          {(d?.objections ?? []).map((o: Any) => (
            <div className="a-funnel" style={{ gridTemplateColumns: "1fr 170px" }} key={o.type}>
              <span>{({ price: "Fiyat (pahalı)", trust: "Güven (dolandırıcılık mı?)", value: "Değer (ücretsizden farkı ne?)", timing: "Zaman (sonra bakarım)", results: "Sonuç / garanti", other: "Diğer" } as Any)[o.type] ?? o.type}</span>
              <span><b>{o.leads}</b> kişi · {o.paid_leads} tanesi yine de aldı</span>
            </div>
          ))}
          {!d?.objections?.length && <p className="a-help">Henüz itiraz kaydı yok.</p>}
        </Card>
      </div>
      <Card title="Son ödemeler">
        <div className="a-scroll">
          <table className="a-table">
            <thead><tr><th>Tarih</th><th>Kişi</th><th>Plan</th><th>Tutar</th><th>Durum</th></tr></thead>
            <tbody>
              {(d?.sales ?? []).map((s: Any) => (
                <tr key={s.whop_payment_id}><td>{when(s.created_at)}</td><td>{s.leads?.first_name ?? "Bağlanmamış"} {s.leads?.username ? `@${s.leads.username}` : ""}</td><td>{PLAN_TR[s.plan_key] ?? s.plan_key ?? "–"}</td><td>{money(s.amount)}</td>
                  <td>{s.status === "refunded" ? <Pill tone="red">İade</Pill> : s.is_first ? <Pill tone="green">Yeni satış</Pill> : <Pill tone="blue">Yenileme</Pill>}</td></tr>
              ))}
              {!d?.sales?.length && <tr><td colSpan={5} className="a-help">Henüz ödeme yok.</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}

/* =====================================================================
 *  2. KONUŞMALAR  (oku · Türkçeye çevir · puan ver · bot adına yaz)
 * ===================================================================== */
const FILTERS: [string, string][] = [["all", "Hepsi"], ["needs_human", "İnsan desteği istiyor"], ["hot", "Sıcak (puan 60+)"], ["checkout", "Ödemeyi yarıda bıraktı"], ["paid", "Satın aldı"], ["lost", "Kaybedildi"]];

function LeadDetail({ id, back, changed }: { id: string; back: () => void; changed: () => void }) {
  const [d, setD] = useState<Any>(null);
  const [tr, setTr] = useState<Record<number, string>>({});
  const [rating, setRating] = useState(0);
  const [note, setNote] = useState("");
  const [say, setSay] = useState("");
  const [busy, run] = useBusy();
  const load = useCallback(() => run("load", async () => {
    const r = await api("lead", { id });
    setD(r); setRating(r.review?.rating ?? 0); setNote(r.review?.note ?? "");
  }), [id, run]);
  useEffect(() => { setD(null); setTr({}); load(); }, [load]);
  if (!d) return <Card><p className="a-help">Yükleniyor…</p></Card>;
  const L = d.lead;
  const act = (op: string, ok: string, extra: Record<string, unknown> = {}) => run(op, async () => { await api("lead_action", { id, op, ...extra }); await load(); changed(); }, ok);
  const q = d.analysis?.quality_detail ?? null;
  return (
    <div>
      <div className="a-row" style={{ marginBottom: 10 }}><Btn small kind="soft" onClick={back}>← Listeye dön</Btn></div>
      <Card
        title={<>{L.first_name ?? "İsimsiz"} {L.username && <span className="a-help">@{L.username}</span>}</>}
        desc={<>Telegram ID: {L.telegram_user_id} · İlk geliş: {when(L.created_at)} · Kampanya: {L.campaign ?? "–"} · Kaynak: {L.origin === "channel_post" ? <Pill tone="amber">📣 Kanal paylaşımı #{L.origin_post_id}</Pill> : L.landing_url || (L.source && L.source !== "telegram_direct") ? <Pill tone="blue">Reklam / site</Pill> : <Pill>Doğrudan bot</Pill>}</>}
        right={<div className="a-row"><Pill tone="blue">{STAGE_TR[L.stage] ?? L.stage}</Pill>{L.paid && <Pill tone="green">Ödedi · {money(L.total_revenue)}</Pill>}{L.needs_human && <Pill tone="amber">İnsan bekliyor</Pill>}{L.do_not_sell && <Pill tone="red">Satış kapalı</Pill>}{L.opted_out && <Pill tone="red">Mesaj istemiyor</Pill>}{L.blocked && <Pill tone="red">Botu engelledi</Pill>}</div>}
      >
        <div className="a-row" style={{ marginBottom: 12 }}>
                    {L.needs_human ? <Btn small onClick={() => act("human_done", "İşaret kaldırıldı, bot devam ediyor.")}>İlgilendim, işareti kaldır</Btn> : <Btn small kind="soft" onClick={() => act("human_needed", "İşaretlendi.")}>“İnsan ilgilenecek” diye işaretle</Btn>}
          {L.do_not_sell ? <Btn small kind="soft" onClick={() => act("sell_on", "Satış tekrar açıldı.")}>Satışı tekrar aç</Btn> : <Btn small kind="danger" onClick={() => act("sell_off", "Bu kişiye artık satış yapılmayacak.")}>Bu kişiye satış yapma</Btn>}
        </div>
        <div className="a-chat">
          {d.messages.map((m: Any) => (
            <div key={m.id} className={`a-msg ${m.role}`}>
              <button className="a-del" title="Bu mesajı veritabanından sil" onClick={() => window.confirm("Bu mesaj veritabanından silinsin mi? (Müşterinin Telegram'ından silinmez.)") && run(`m${m.id}`, async () => { await api("message_delete", { id: m.id }); await load(); })}>🗑</button>
              {m.content}
              {tr[m.id] && <em>{tr[m.id]}</em>}
              {m.role !== "event" && <small>{m.role === "user" ? "Müşteri" : "Bot"} · {when(m.created_at)}</small>}
            </div>
          ))}
          {!d.messages.length && <p className="a-help">Mesaj yok. (Eski mesaj metinleri yer açmak için otomatik silinir; analiz, puan ve profil kalır.)</p>}
        </div>
      </Card>

      <Card title="Bu konuşmaya puan verin" desc="Botun bu konuşmadaki satış performansını değerlendirin. Puanınız ve notunuz, yapay zekâ koçuna EN GÜÇLÜ kanıt olarak gönderilir ve bir sonraki satış önerisini doğrudan etkiler. Notu Türkçe yazabilirsiniz.">
        <div className="a-stars" style={{ marginBottom: 8 }}>
          {[1, 2, 3, 4, 5].map((n) => <button key={n} className={n <= rating ? "on" : ""} onClick={() => setRating(n)} aria-label={`${n} yıldız`}>★</button>)}
          <span className="a-help" style={{ marginLeft: 8 }}>{["Puan seçin", "Çok kötü", "Kötü", "Orta", "İyi", "Mükemmel"][rating]}</span>
        </div>
        <Txt rows={3} value={note} onChange={setNote} placeholder="Örn: Fiyatı çok erken söyledi. Önce kişinin ne aradığını sormalıydı. / Çok iyi: itirazı sakin karşıladı." />
        <div className="a-row" style={{ marginTop: 10 }}>
          <Btn onClick={() => run("rev", async () => { await api("review_save", { lead_id: id, rating, note }); changed(); }, "Puanınız kaydedildi. Koç bir sonraki öğrenme turunda kullanacak.")} busy={busy === "rev"} disabled={!rating}>Puanı kaydet</Btn>
          {d.review?.used_in_batch && <Pill tone="green">Koç bu puanı kullandı (tur #{d.review.used_in_batch})</Pill>}
        </div>
      </Card>

      <div className="a-grid2">
        <Card title={`İlgi puanı: ${L.score}/100`} desc="Bot, kişinin yazdıklarından kanıt toplar; puanı sistem hesaplar. Ağırlıkları “Kurallar ve Puanlama” sekmesinden değiştirebilirsiniz.">
          <div className="a-bar" style={{ marginBottom: 10 }}><i style={{ width: `${L.score}%` }} /></div>
          {d.signals.map((s: Any) => (
            <p key={s.key} style={{ fontSize: 14, marginBottom: 6 }}>• <b>{SIGNAL_TR[s.key] ?? s.key}</b>{s.evidence ? <span className="a-help"> — “{s.evidence}”</span> : null}</p>
          ))}
          {!d.signals.length && <p className="a-help">Henüz sinyal yok.</p>}
          {d.profile && <p className="a-help" style={{ marginTop: 8 }}>Hafıza: takım {d.profile.favorite_team ?? "?"} · aradığı: {(d.profile.wants ?? []).join("; ") || "?"} · itirazlar: {(d.profile.objections ?? []).join(", ") || "yok"}</p>}
        </Card>
        <Card title="Yapay zekâ analizi" desc="Konuşma bittiğinde (satış, ret veya 7 gün sessizlik) otomatik yapılır. İngilizcedir.">
          {d.analysis ? (
            <>
              <p style={{ marginBottom: 8 }}><Pill tone={d.analysis.outcome === "won" ? "green" : "red"}>{d.analysis.outcome === "won" ? "Kazanıldı" : `Kaybedildi · ${d.analysis.loss_reason ?? ""}`}</Pill> <Pill>Kalite {d.analysis.conversation_quality}/100</Pill></p>
              {q && Object.entries(QUALITY_TR).map(([k, l]) => (
                <div className="a-funnel" style={{ gridTemplateColumns: "170px 1fr 40px", padding: "3px 0", border: 0 }} key={k}><span style={{ fontSize: 13 }}>{l}</span><div className="a-bar"><i style={{ width: `${(q[k] ?? 0) * 10}%` }} /></div><b>{q[k] ?? "–"}</b></div>
              ))}
              <p style={{ margin: "8px 0", fontSize: 14 }}>{d.analysis.summary}</p>
              {(d.analysis.agent_mistakes ?? []).length > 0 && <p style={{ fontSize: 14 }}><b>Botun hataları:</b> {d.analysis.agent_mistakes.join(" · ")}</p>}
              {(d.analysis.what_worked ?? []).length > 0 && <p style={{ fontSize: 14 }}><b>İşe yarayanlar:</b> {d.analysis.what_worked.join(" · ")}</p>}
            </>
          ) : <p className="a-help">Bu konuşma henüz analiz edilmedi (hâlâ açık).</p>}
        </Card>
      </div>

      <Card title="Silme işlemleri" desc="Geri alınamaz. Tek bir mesajı silmek için konuşmadaki mesajın sağ üstündeki 🗑 simgesine basın. Buradan silinenler yalnızca SİZİN veritabanınızdan silinir; müşterinin Telegram'ındaki sohbet olduğu gibi kalır.">
        <div className="a-row">
          <Btn kind="danger" onClick={() => window.confirm("Bu kişinin TÜM mesaj metinleri silinsin mi? Profil, puan, ödeme ve analiz kalır.") && run("w1", async () => { await api("lead_wipe", { id, mode: "messages" }); await load(); }, "Mesajlar silindi.")} busy={busy === "w1"}>Tüm mesajlarını sil</Btn>
          <Btn kind="danger" onClick={() => window.confirm("Kişi SIFIRLANSIN mı? Konuşma, puan, profil, analiz, puanınız ve takip geçmişi silinir; kişi botla en baştan başlar. Ödeme / VIP bilgisi korunur. (Kendi hesabınızla test etmek için idealdir.)") && run("w2", async () => { await api("lead_wipe", { id, mode: "reset" }); await load(); changed(); }, "Kişi sıfırlandı.")} busy={busy === "w2"}>Kişiyi sıfırla (baştan başlasın)</Btn>
          <Btn kind="danger" onClick={() => window.confirm(`${L.first_name ?? "Bu kişi"} veritabanından TAMAMEN silinsin mi?\n\nKonuşma, profil, puan, analiz, destek talepleri silinir. Ödeme kayıtları muhasebe için kalır ama kişiden ayrılır ve e-postası silinir.${L.vip_active ? "\n\nDİKKAT: Bu kişi şu an VIP. Silmek onu VIP kanalından ÇIKARMAZ ve aboneliği bittiğinde otomatik çıkarma da çalışmaz." : ""}`) && run("w3", async () => { await api("lead_wipe", { id, mode: "delete" }); changed(); back(); }, "Kişi tamamen silindi.")} busy={busy === "w3"}>Kişiyi tamamen sil</Btn>
        </div>
      </Card>

      <Card title="Bot adına mesaj gönder" desc="Yazdığınız metin müşteriye AYNEN gider.">
        <Txt rows={3} value={say} onChange={setSay} placeholder="Selam! TAHMİN10 ekibinden yazıyorum…" />
        <div style={{ marginTop: 10 }}><Btn onClick={() => act("say", "Mesaj gönderildi.", { text: say }).then(() => setSay(""))} busy={busy === "say"} disabled={!say.trim()}>Gönder</Btn></div>
      </Card>
    </div>
  );
}

function Conversations({ initial }: { initial?: string | null }) {
  const [filter, setFilter] = useState("all");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(0);
  const [d, setD] = useState<Any>(null);
  const [sel, setSel] = useState<string | null>(initial ?? null);
  const [, run] = useBusy();
  const load = useCallback(() => run("load", async () => setD(await api("leads", { filter, q, page }))), [filter, q, page, run]);
  useEffect(() => { const t = setTimeout(load, q ? 350 : 0); return () => clearTimeout(t); }, [load, q]);
  return (
    <>
      <h1>Konuşmalar</h1>
      <p className="a-intro">Botun müşterilerle yaptığı bütün konuşmalar. Bir kişiye tıklayın: konuşmayı okuyun, Türkçeye çevirin, bota puan verin veya bot adına kendiniz yazın.</p>
      <div className="a-row" style={{ marginBottom: 10 }}>
        {FILTERS.map(([k, l]) => <Btn key={k} small kind={filter === k ? undefined : "soft"} onClick={() => { setFilter(k); setPage(0); }}>{l}</Btn>)}
      </div>
      <div className={`a-conv ${sel ? "open" : ""}`}>
        <div className="a-listwrap">
          <input placeholder="İsim, @kullanıcı adı veya Telegram ID ara…" value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} style={{ marginBottom: 10 }} />
          <div className="a-list">
            {(d?.leads ?? []).map((l: Any) => (
              <button key={l.id} className={`a-item ${sel === l.id ? "on" : ""}`} onClick={() => setSel(l.id)}>
                <div className="a-row" style={{ justifyContent: "space-between" }}><b>{l.first_name ?? "İsimsiz"}</b><span className="a-help">{when(l.last_user_message_at)}</span></div>
                <div className="a-row" style={{ gap: 6, marginTop: 4 }}>
                  <Pill>{STAGE_TR[l.stage] ?? l.stage}</Pill><Pill tone={l.score >= 60 ? "green" : undefined}>puan {l.score}</Pill>
                  {l.paid && <Pill tone="green">ödedi</Pill>}{l.needs_human && <Pill tone="amber">insan bekliyor</Pill>}{l.rating && <Pill tone="blue">★ {l.rating}</Pill>}
                </div>
              </button>
            ))}
            {d && !d.leads.length && <p className="a-help" style={{ padding: 14 }}>Bu filtrede kimse yok.</p>}
          </div>
          <div className="a-row" style={{ marginTop: 10 }}>
            {page > 0 && <Btn small kind="soft" onClick={() => setPage(page - 1)}>← Önceki</Btn>}
            {d?.hasMore && <Btn small kind="soft" onClick={() => setPage(page + 1)}>Sonraki →</Btn>}
          </div>
        </div>
        <div className="a-detail">{sel ? <LeadDetail id={sel} back={() => setSel(null)} changed={load} /> : <Card><p className="a-help">Soldan bir kişi seçin.</p></Card>}</div>
      </div>
    </>
  );
}

/* =====================================================================
 *  Ayar sekmeleri için ortak yardımcı
 * ===================================================================== */
function useSection(section: "business" | "prompts" | "rules" | "texts" | "landing" | "safe" | "gate" | "integrations" | "prompts_full" | "guard" | "theme" | "commands") {
  const [s, setS] = useState<Any>(null);
  const [draft, setDraft] = useState<Any>(null);
  const [busy, run] = useBusy();
  const take = useCallback((r: Any) => { setS(r); setDraft(r[section]); }, [section]);
  useEffect(() => { run("load", async () => take(await api("settings_get"))); }, [run, take]);
  return {
    s, draft, busy,
    dirty: Boolean(s) && JSON.stringify(s[section]) !== JSON.stringify(draft),
    upd: (path: (string | number)[], v: unknown) => setDraft((d: Any) => setIn(d, path, v)),
    save: () => run("save", async () => take(await api("settings_save", { section, value: draft })), "Kaydedildi. Bot yeni ayarları kullanıyor."),
    reset: () => run("reset", async () => take(await api("settings_reset", { section })), "İlk ayarlara dönüldü."),
  };
}

/* =====================================================================
 *  3. İŞLETME BİLGİLERİ  (botun söyleyebileceği TEK gerçekler)
 * ===================================================================== */
function Business() {
  const { s, draft: b, upd, save, reset, busy, dirty } = useSection("business");
  if (!b) return <p className="a-help">Yükleniyor…</p>;
  const tr = b.vip.trackRecord;
  const emptyTr = s.defaults.business.vip.trackRecord ?? { periods: [], scope: "", disclaimer: "Geçmiş sonuçlar gelecekteki sonuçları garanti etmez. İsabet ya da kazanç garantisi yoktur." };
  return (
    <>
      <h1>İşletme Bilgileri</h1>
      <p className="a-intro">Bot müşteriye YALNIZCA burada yazan bilgileri söyleyebilir. Boş bıraktığınız bir bilgi sorulursa bot uydurmaz; “ekibe sorup döneyim” der.</p>
      <div className="a-warn">Garanti, “kesin kazanç”, “risksiz”, “son yerler” gibi ifadeler kaydedilemez — sistem reddeder. Bu hem yasal koruma hem de Meta reklam hesabınızın güvenliği içindir.</div>

      <Card title="Genel">
        <div className="a-grid2">
          <Field label="Marka adı"><Txt value={b.brand} onChange={(v) => upd(["brand"], v)} /></Field>
          <Field label="En küçük yaş" help="18'in altına inemez."><Num value={b.minimumAge} min={18} max={25} onChange={(v) => upd(["minimumAge"], v)} /></Field>
        </div>
      </Card>

      <Card title="Ücretsiz kanal" desc="Bot ücretsiz kanalı anlatırken bunları kullanır.">
        <div className="a-grid2">
          <Field label="Kanalın adı"><Txt value={b.freeChannel.name} onChange={(v) => upd(["freeChannel", "name"], v)} /></Field>
          <Field label="Paylaşım sıklığı" help="Örn: günde 1 ücretsiz tahmin"><Txt value={b.freeChannel.postingFrequency} onChange={(v) => upd(["freeChannel", "postingFrequency"], v)} /></Field>
        </div>
        <Field label="Kanalda neler paylaşılıyor?"><ListEdit items={b.freeChannel.whatWePost} onChange={(v) => upd(["freeChannel", "whatWePost"], v)} placeholder="Madde ekle" /></Field>
        <Field label="Konumlandırma" help="Ücretsiz ile VIP arasındaki farkı bot nasıl anlatsın? (Ücretsizi kötülemeden.)"><Txt rows={3} value={b.freeChannel.positioning} onChange={(v) => upd(["freeChannel", "positioning"], v)} /></Field>
      </Card>

      <Card title="VIP" desc="Yalnızca GERÇEK faydaları yazın. Bot bu listeyi sayar, başka bir şey eklemez.">
        <div className="a-grid2">
          <Field label="VIP'in adı"><Txt value={b.vip.name} onChange={(v) => upd(["vip", "name"], v)} /></Field>
          <Field label="Erişim nasıl veriliyor?"><Txt value={b.vip.delivery} onChange={(v) => upd(["vip", "delivery"], v)} /></Field>
        </div>
        <Field label="Faydalar"><ListEdit items={b.vip.benefits} onChange={(v) => upd(["vip", "benefits"], v)} placeholder="Fayda ekle" /></Field>
        <div className="a-grid2">
          <Field label="Günde kaç tahmin?"><Txt rows={2} value={b.vip.volume} onChange={(v) => upd(["vip", "volume"], v)} /></Field>
          <Field label="Ligler / şampiyonalar" help="Şu an: “lig farkı yok, veriye göre seçiliyor”."><Txt rows={2} value={b.vip.coverage} onChange={(v) => upd(["vip", "coverage"], v)} /></Field>
          <Field label="Market türleri"><Txt rows={3} value={b.vip.marketTypes} onChange={(v) => upd(["vip", "marketTypes"], v)} /></Field>
          <Field label="Kombine (COMBO) önerileri"><Txt rows={3} value={b.vip.combos} onChange={(v) => upd(["vip", "combos"], v)} /></Field>
          <Field label="İptal koşulu"><Txt rows={2} value={b.vip.cancellation} onChange={(v) => upd(["vip", "cancellation"], v)} /></Field>
          <Field label="İade politikası" help="Boşsa bot “ekibe sorayım” der. Örn: Whop üzerinden 7 gün içinde iade."><Txt rows={2} value={b.vip.refundPolicy} onChange={(v) => upd(["vip", "refundPolicy"], v)} /></Field>
        </div>
        <Field label="Aktif promosyon" help="Yalnızca GERÇEK ve şu an geçerli bir kampanya varsa yazın. Boşken bot indirim, kupon veya süre sınırından asla bahsetmez.">
          <Txt value={b.vip.activePromotion} onChange={(v) => upd(["vip", "activePromotion"], v)} placeholder="Boş = promosyon yok" />
        </Field>
        <label className="a-row"><input type="checkbox" style={{ width: 20 }} checked={b.vip.plansDifferOnlyInDuration} onChange={(e) => upd(["vip", "plansDifferOnlyInDuration"], e.target.checked)} /> Tüm planlar aynı VIP erişimini verir, yalnızca süre farklıdır</label>
      </Card>

      <Card title="Planlar ve fiyatlar" desc="Buradaki fiyat botun SÖYLEDİĞİ fiyattır. Müşterinin gerçekte ödediği tutarı Whop belirler — ikisini aynı tutun. Plan–Whop eşleşmesi (WHOP_PLAN_… değişkenleri) Vercel'de kalır.">
        <div className="a-grid3">
          {b.plans.map((p: Any, i: number) => (
            <div key={p.key} style={{ border: "1px solid #e1e8e4", borderRadius: 12, padding: 12 }}>
              <h3 style={{ marginBottom: 8 }}>{PLAN_TR[p.key]} planı</h3>
              <Field label="Buton / plan adı"><Txt value={p.name} onChange={(v) => upd(["plans", i, "name"], v)} /></Field>
              <Field label="Fiyat yazısı" help="Müşteriye aynen böyle yazılır."><Txt value={p.priceLabel} onChange={(v) => upd(["plans", i, "priceLabel"], v)} /></Field>
              <Field label="Fiyat (sayı, ₺)" help="Meta'ya gönderilen değer."><Num value={p.price} step={0.01} min={0} onChange={(v) => upd(["plans", i, "price"], v)} /></Field>
              <Field label="Ödeme tipi"><select value={p.billingType} onChange={(e) => upd(["plans", i, "billingType"], e.target.value)}><option value="recurring">Abonelik (otomatik yenilenir)</option><option value="one_time">Tek seferlik</option></select></Field>
              <Field label="Ödeme açıklaması" help="Otomatik yenilemeyi asla gizlemeyin."><Txt rows={3} value={p.billingLabel} onChange={(v) => upd(["plans", i, "billingLabel"], v)} /></Field>
              <Field label="Kime uygun?"><Txt rows={2} value={p.bestFor} onChange={(v) => upd(["plans", i, "bestFor"], v)} /></Field>
            </div>
          ))}
        </div>
      </Card>

      <Card title="Geçmiş sonuçlar (kanıt)" desc="Bot bu sayıları yalnızca biri sonuçları / güveni sorduğunda söyler; her seferinde dönemi ve “geçmiş sonuç geleceği garanti etmez” uyarısını ekler. İsabet oranı ve ROI aşağıdaki sayılardan OTOMATİK hesaplanır; bot başka hiçbir yüzde söyleyemez.">
        <div className="a-warn"><b>Yalnızca GERÇEK ve kanıtlayabileceğiniz sonuçları girin.</b> Uydurma sonuç yanıltıcı reklamdır (Reklam Kurulu cezası) ve Meta hesabının kapanmasına yol açar. Emin değilseniz kapalı tutun.</div>
        <label className="a-row" style={{ marginBottom: 12 }}><input type="checkbox" style={{ width: 20 }} checked={Boolean(tr)} onChange={(e) => upd(["vip", "trackRecord"], e.target.checked ? emptyTr : null)} /> Botun geçmiş sonuçlardan bahsetmesine izin ver</label>
        {tr && (
          <>
            <div className="a-scroll">
              <table className="a-table" style={{ minWidth: 820 }}>
                <thead><tr><th style={{ width: 190 }}>Dönem</th><th>Toplam</th><th>Kazanan</th><th>Kaybeden</th><th>İptal</th><th>Ort. oran</th><th>Kâr (birim)</th><th>İsabet</th><th>ROI</th><th /></tr></thead>
                <tbody>
                  {tr.periods.map((p: Any, i: number) => (
                    <tr key={i}>
                      <td><Txt value={p.label} onChange={(v) => upd(["vip", "trackRecord", "periods", i, "label"], v)} placeholder="01/08/2026 a 31/08/2026" /></td>
                      {(["total", "won", "lost", "void"] as const).map((k) => <td key={k}><Num value={p[k]} min={0} onChange={(v) => upd(["vip", "trackRecord", "periods", i, k], v)} /></td>)}
                      <td><Num value={p.averageOdds} step={0.01} onChange={(v) => upd(["vip", "trackRecord", "periods", i, "averageOdds"], v)} /></td>
                      <td><Num value={p.profitUnits} step={0.1} onChange={(v) => upd(["vip", "trackRecord", "periods", i, "profitUnits"], v)} /></td>
                      <td><b>{pct(p.won, p.won + p.lost)}</b></td><td><b>{pct(p.profitUnits, p.total)}</b></td>
                      <td><Btn small kind="danger" onClick={() => upd(["vip", "trackRecord", "periods"], tr.periods.filter((_: Any, j: number) => j !== i))}>Sil</Btn></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ margin: "10px 0 14px" }}><Btn small kind="soft" onClick={() => upd(["vip", "trackRecord", "periods"], [...tr.periods, { label: "", total: 0, won: 0, lost: 0, void: 0, averageOdds: 1.8, profitUnits: 0 }])}>+ Dönem ekle</Btn></div>
            <div className="a-grid2">
              <Field label="Kapsam notu"><Txt value={tr.scope} onChange={(v) => upd(["vip", "trackRecord", "scope"], v)} /></Field>
              <Field label="Zorunlu uyarı cümlesi"><Txt value={tr.disclaimer} onChange={(v) => upd(["vip", "trackRecord", "disclaimer"], v)} /></Field>
            </div>
          </>
        )}
      </Card>

      <Card title="Müşteri yorumları" desc="Bot en fazla BİR yorumu, kelimesi kelimesine ve isimle aktarır; yalnızca biri kullananların fikrini sorarsa. Yalnızca gerçek ve izin alınmış yorumları girin.">
        {b.vip.testimonials.map((t: Any, i: number) => (
          <div className="a-listedit" key={i}>
            <div style={{ width: 170 }}><Txt value={t.author} placeholder="Mehmet K." onChange={(v) => upd(["vip", "testimonials", i, "author"], v)} /></div>
            <Txt rows={3} value={t.text} onChange={(v) => upd(["vip", "testimonials", i, "text"], v)} />
            <Btn small kind="danger" onClick={() => upd(["vip", "testimonials"], b.vip.testimonials.filter((_: Any, j: number) => j !== i))}>Sil</Btn>
          </div>
        ))}
        <Btn small kind="soft" onClick={() => upd(["vip", "testimonials"], [...b.vip.testimonials, { author: "", text: "" }])}>+ Yorum ekle</Btn>
      </Card>

      <div className="a-grid2">
        <Card title="Üslup örnekleri" desc="Botun ilham alacağı, sizin tarzınızdaki cümleler (senaryo değil)."><ListEdit items={b.voiceExamples} onChange={(v) => upd(["voiceExamples"], v)} placeholder="Cümle ekle" /></Card>
        <Card title="Bot ASLA bunları söylemesin" desc="Yerleşik güvenlik kurallarına EK olarak sizin yasaklarınız. Türkçe yazabilirsiniz."><ListEdit items={b.neverSay} onChange={(v) => upd(["neverSay"], v)} placeholder="Yasak ekle" rows={2} /></Card>
      </div>
      <SaveBar onSave={save} onReset={reset} busy={busy} dirty={dirty} />
    </>
  );
}

/* =====================================================================
 *  4. SATIŞ ASİSTANI  (prompt'lar + deneme sohbeti)
 * ===================================================================== */
const BLOCKS: [string, string, string, number][] = [
  ["mission", "Görev", "Botun kim olduğu ve neyi amaçladığı.", 6],
  ["style", "Yazı tarzı", "Mesaj uzunluğu, ton, emoji kullanımı, yasak kalıplar.", 10],
  ["method", "Satış yöntemi (adım adım)", "Botun izlediği danışman-satış sırası. Adımları değiştirebilir veya ekleyebilirsiniz.", 10],
  ["buying", "Satın alma sinyalleri", "Müşteri fiyat / VIP sorduğunda botun ne yapacağı.", 4],
  ["objections", "İtirazlara cevap", "Fiyat, güven, değer, zaman itirazları. {{PLANO_ENTRADA}} yazan yere en ucuz planın adı ve fiyatı otomatik gelir.", 8],
  ["extra", "Sizin ek talimatlarınız", "Buraya istediğinizi yazabilirsiniz. Örn: “Galatasaraylılarla daha samimi ol.” Güvenlik kurallarıyla çelişirse güvenlik kuralları kazanır.", 5],
];
const ACTION_TR: Record<string, string> = { none: "Sadece cevap verdi", invite_free: "Ücretsiz kanala davet etmek istiyor", offer_vip: "Kendi isteğiyle VIP teklif etmek istiyor", show_plans: "Müşteri sordu → planları göstermek istiyor", handoff_human: "İnsana devretmek istiyor", stop_selling: "Satışı bırakmak istiyor" };
const SCENARIOS: [string, string][] = [["new", "Yeni gelen biri (henüz kanalda değil)"], ["invited", "Kanala davet edildi, daha girmedi"], ["engaged", "Ücretsiz kanalda, ilgili (puan 70)"], ["offered", "VIP teklif edildi"], ["checkout", "Ödeme sayfasını açtı, bitirmedi"], ["paid", "VIP müşteri"]];

function TestChat() {
  const [scenario, setScenario] = useState("new");
  const [history, setHistory] = useState<Any[]>([]);
  const [input, setInput] = useState("");
    const [busy, run] = useBusy();
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ block: "nearest" }); }, [history]);
  const send = () => {
    const text = input.trim();
    if (!text) return;
    const next = [...history, { role: "user", content: text }];
    setHistory(next); setInput("");
    run("chat", async () => {
      const out = await api("test_chat", { scenario, history: next.map((m) => ({ role: m.role, content: m.content })) });
      const t: string[] = [];
      const meta = `${ACTION_TR[out.next_action] ?? out.next_action}${Object.keys(out.signals ?? {}).length ? ` · yakaladığı sinyaller: ${Object.keys(out.signals).map((k) => SIGNAL_TR[k] ?? k).join(", ")}` : ""}${out.guardrailHits?.length ? ` · ⚠️ güvenlik filtresi devreye girdi: ${out.guardrailHits.join(", ")}` : ""}`;
      setHistory([...next, ...out.messages.map((m: string, i: number) => ({ role: "assistant", content: m, tr: t[i], meta: i === out.messages.length - 1 ? meta : undefined }))]);
    });
  };
  return (
    <Card title="Deneme sohbeti" desc="Gerçek botu, Telegram'a girmeden test edin. Siz müşteri gibi yazın; bot KAYDEDİLMİŞ ayarlarla cevap verir. Hiçbir müşteriye mesaj gitmez. Her mesaj küçük bir DeepSeek ücreti harcar.">
      <div className="a-grid2" style={{ marginBottom: 10 }}>
        <Field label="Senaryo"><select value={scenario} onChange={(e) => { setScenario(e.target.value); setHistory([]); }}>{SCENARIOS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
      </div>
      <div className="a-chat" style={{ minHeight: 160 }}>
        {history.map((m, i) => (
          <div key={i} className={`a-msg ${m.role}`}>{m.content}{m.tr && <em>{m.tr}</em>}{m.meta && <small>Botun kararı: {m.meta}</small>}</div>
        ))}
        {!history.length && <p className="a-help">Örnek: “selam”, “vip kaç para?”, “bu dolandırıcılık mı?”, “16 yaşındayım”, “bütün paramı kaybettim”…</p>}
        <div ref={end} />
      </div>
      <div className="a-row" style={{ marginTop: 10 }}>
        <div style={{ flex: 1, minWidth: 200 }}><input value={input} placeholder="Müşteri olarak yazın…" onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && busy !== "chat" && send()} /></div>
        <Btn onClick={send} busy={busy === "chat"}>Gönder</Btn>
        <Btn kind="soft" onClick={() => setHistory([])}>Sıfırla</Btn>
      </div>
    </Card>
  );
}

function Knowledge({ initial }: { initial: Any[] }) {
  const [kb, setKb] = useState<Any[]>(initial);
  const [busy, run] = useBusy();
  const dirty = JSON.stringify(kb) !== JSON.stringify(initial);
  return (
    <Card title={`Botun bildiği sorunlar ve çözümleri (${kb.length})`} desc="Teknik bir sorunu Telegram'da çözdükten sonra “🧠 Yapay zekâya öğret” düğmesiyle öğrettiğiniz her şey buraya düşer; buradan da elle ekleyebilirsiniz. Bot aynı sorunu bir daha duyduğunda bu çözümü kendi cümleleriyle anlatır; çözemezse yine size devreder. Metinler Türkçe olmalı. Bot link gönderemez; “whop.com” gibi adresleri http olmadan yazın.">
      {kb.map((k, i) => (
        <div key={k.id ?? i} style={{ borderTop: "1px solid #eef2f0", padding: "12px 0" }}>
          <div className="a-grid2">
            <Field label="Sorun (müşteri nasıl anlatır?)"><Txt rows={3} value={k.issue} onChange={(v) => setKb(setIn(kb, [i, "issue"], v))} /></Field>
            <Field label="Çözüm (bot ne desin?)"><Txt rows={3} value={k.solution} onChange={(v) => setKb(setIn(kb, [i, "solution"], v))} /></Field>
          </div>
          <div className="a-row"><Btn small kind="danger" onClick={() => setKb(kb.filter((_, j) => j !== i))}>Sil</Btn>{k.ticket_id && <span className="a-help">Destek talebi #{k.ticket_id} · {when(k.created_at)}</span>}</div>
        </div>
      ))}
      {!kb.length && <p className="a-help">Henüz kayıt yok. İlk teknik sorunu çözdüğünüzde Telegram'daki “🧠 Yapay zekâya öğret” düğmesini kullanın.</p>}
      <div className="a-row" style={{ marginTop: 10 }}>
        <Btn small kind="soft" onClick={() => setKb([...kb, { id: `m${Date.now()}`, issue: "", solution: "" }])}>+ Elle ekle</Btn>
        <Btn onClick={() => run("kb", async () => setKb((await api("kb_save", { entries: kb })).knowledge), "Kaydedildi. Bot yaklaşık 30 saniye içinde kullanmaya başlar.")} busy={busy === "kb"} disabled={!dirty}>Bilgileri kaydet</Btn>
      </div>
    </Card>
  );
}

function Assistant() {
  const { s, draft: p, upd, save, reset, busy, dirty } = useSection("prompts");
  const [showFull, setShowFull] = useState(false);
  if (!p) return <p className="a-help">Yükleniyor…</p>;
  return (
    <>
      <h1>Satış Asistanı</h1>
      <p className="a-intro">Botun “beyni”. Aşağıdaki bölümler botun her cevabından önce okuduğu talimatlardır. Talimatlar Türkçedir. Değiştirdikten sonra kaydedin ve alttaki <b>Deneme sohbeti</b> ile test edin.</p>
      {dirty && <div className="a-info">Deneme sohbeti KAYDEDİLMİŞ ayarları kullanır. Önce kaydedin.</div>}
      <Card title="Düzenleyebileceğiniz talimatlar">
        {BLOCKS.map(([k, label, help, rows]) => (
          <Field key={k} label={label} help={help}><Txt rows={rows} value={p.blocks[k]} onChange={(v) => upd(["blocks", k], v)} /></Field>
        ))}
      </Card>
      <Card title="Aşamaya göre talimatlar" desc="Bot, kişinin hunideki yerine göre bu ek talimatlardan yalnızca birini görür.">
        {Object.keys(p.stages).map((k) => (
          <Field key={k} label={STAGE_TR[k] ?? k}><Txt rows={3} value={p.stages[k]} onChange={(v) => upd(["stages", k], v)} /></Field>
        ))}
      </Card>
      <Card title="🔒 Kilitli güvenlik kuralları" desc="Bunlar panelden DEĞİŞTİRİLEMEZ: garanti vermeme, reşit olmayanlara ve kumar sorunu yaşayanlara satış yapmama, robot olduğunu gizlememe, kayıpları “geri kazan” dememe. Bunlar müşterilerinizi, reklam hesabınızı ve sizi korur. Ayrıca botun her mesajı gönderilmeden önce otomatik filtreden geçer.">
        <div className="a-lock">{s.lockedPrompt}</div>
        <div style={{ marginTop: 10 }}><Btn small kind="soft" onClick={() => setShowFull(!showFull)}>{showFull ? "Gizle" : "Botun gördüğü TAM talimatı göster"}</Btn></div>
        {showFull && <div className="a-lock" style={{ marginTop: 10, maxHeight: 520 }}>{s.fullPrompt}</div>}
      </Card>
      <SaveBar onSave={save} onReset={reset} busy={busy} dirty={dirty} />
      <div style={{ height: 16 }} />
      <Knowledge initial={s.knowledge ?? []} />
      <TestChat />
    </>
  );
}

/* =====================================================================
 *  5. KURALLAR VE PUANLAMA
 * ===================================================================== */
const RULE_TR: Record<string, [string, string]> = {
  minRepliesBeforeFreeInvite: ["Ücretsiz kanala davet için en az cevap", "Kişi bota en az bu kadar mesaj yazmadan bot kanala davet edemez."],
  forceFreeInviteAfterReplies: ["Bu kadar cevaptan sonra daveti zorunlu yap", "Bot unutsa bile sistem daveti kendisi gönderir."],
  minRepliesAfterJoinBeforeOffer: ["Kanala girdikten sonra VIP teklifi için en az cevap", "Kişi önce ücretsiz içeriği görsün, biraz konuşsun."],
  vipScoreThreshold: ["VIP teklifi için gereken ilgi puanı (0–100)", "Düşürürseniz bot daha erken teklif eder; yükseltirseniz daha seçici olur."],
  offerDueAfterEligibleTurns: ["Uygun olduktan kaç mesaj sonra “şimdi teklif et” densin", "0 = hemen."],
  maxProactiveOffers: ["Bot kendi isteğiyle en fazla kaç kez VIP teklif etsin", "Müşteri kendisi sorarsa bu sınıra takılmaz, her zaman cevap alır."],
  offerCooldownHours: ["İki teklif arasında bekleme (saat)", ""],
  closeAsLostAfterSilentDays: ["Kaç gün sessizlikten sonra “kaybedildi” sayılsın", "O zaman konuşma analiz edilir. Kişi tekrar yazarsa otomatik yeniden açılır."],
  historyMessages: ["Bot her cevapta son kaç mesajı okusun", "Fazlası daha pahalı, azı daha unutkan."],
  maxPerLeadTotal: ["Bir kişiye en fazla kaç takip mesajı", ""], maxSinceLastReply: ["Cevap gelmeden art arda en fazla kaç takip mesajı", ""],
  sendFromHour: ["Takip mesajı başlangıç saati (Türkiye saati)", ""], sendUntilHour: ["Takip mesajı bitiş saati (Türkiye saati)", ""], maxPerRun: ["Tek çalışmada en fazla kaç mesaj gönderilsin", ""],
  messageDays: ["Konuşma metinleri kaç gün saklansın", "Bu süreden eski ve analizi bitmiş mesaj METİNLERİ silinir. Analiz sonuçları, puanlarınız, profil, ödeme ve huni sayıları silinmez."],
  eventDays: ["Teknik kayıtlar kaç gün saklansın", "Olay kayıtları, Whop / Telegram ham verileri, eski ödeme bağlantıları."],
  autoReleaseHours: ["Destek talebi kaç saat sahipsiz kalırsa bot devralsın", "Siz uyurken müşteri sessizlikte kalmasın diye. Talebe cevap yazarsanız yeniden açılır."],
  coachBatchSize: ["Kaç analiz birikince koç yeni öneri hazırlasın", "Az = sık ama zayıf kanıtlı öneriler."], defaultMinSamplePerVariant: ["A/B testinde varyant başına en az kişi", "Kazanan ilan etmek için gereken en küçük örnek."],
};
const FOLLOWUP_TR: Record<string, string> = { checkout_1: "Ödeme yarıda kaldı — 1. hatırlatma", checkout_2: "Ödeme yarıda kaldı — 2. ve son hatırlatma", offer_1: "VIP teklifinden sonra sustu — 1", offer_2: "VIP teklifinden sonra sustu — 2 (son)", free_1: "Kanala davet edildi, girmedi — 1", free_2: "Kanala davet edildi, girmedi — 2 (son)", engaged_1: "Kanalda ama sessiz — 1", engaged_2: "Kanalda ama sessiz — 2", discovery_1: "En başta sustu" };

function Rules() {
  const { s, draft: r, upd, save, reset, busy, dirty } = useSection("rules");
  if (!r) return <p className="a-help">Yükleniyor…</p>;
  const group = (g: string, title: string, desc: string) => (
    <Card title={title} desc={desc}>
      <div className="a-grid2">
        {Object.keys(s.specs[g]).map((k) => (
          <Field key={k} label={RULE_TR[k]?.[0] ?? k} help={<>{RULE_TR[k]?.[1]} <span>İzin verilen: {s.specs[g][k][0]}–{s.specs[g][k][1]} · ilk ayar: {s.defaults.rules[g][k]}</span></>}>
            <Num value={r[g][k]} min={s.specs[g][k][0]} max={s.specs[g][k][1]} onChange={(v) => upd([g, k], v)} />
          </Field>
        ))}
      </div>
    </Card>
  );
  return (
    <>
      <h1>Kurallar ve Puanlama</h1>
      <p className="a-intro">Yapay zekâ yalnızca ÖNERİR; ne zaman davet edileceğine, ne zaman VIP teklif edileceğine bu kurallar karar verir. Böylece bot kimseyi sıkıştıramaz ve satın almak isteyeni de bekletmez.</p>
      {group("funnel", "Satış hunisi kuralları", "Davet ve teklif zamanlaması.")}
      {group("followups", "Takip mesajı sınırları", "Sessiz kalan kişilere gönderilen hatırlatmalar. Kişi “DUR” yazarsa hepsi durur.")}
      <Card title="Takip mesajları" desc="Her mesaj kişi başına en fazla bir kez gönderilir. “Hedef” yapay zekâya verilen talimattır; “Yedek metin” yapay zekâ çalışmazsa AYNEN gönderilir.">
        {Object.entries(s.followupBuckets).map(([bucket, rules]: Any) => rules.map((fr: Any) => (
          <div key={fr.key} style={{ borderTop: "1px solid #eef2f0", padding: "12px 0" }}>
            <h3 style={{ marginBottom: 8 }}>{FOLLOWUP_TR[fr.key] ?? fr.key} <span className="a-help">({STAGE_TR[bucket] ?? bucket}{fr.keyboard === "plans" ? " · plan butonlarıyla" : fr.keyboard === "free_channel" ? " · kanal butonuyla" : ""})</span></h3>
            <div className="a-grid2">
              <Field label="Kaç saat sessizlikten sonra?"><Num value={r.followupRules[fr.key].afterSilentHours} min={1} max={720} onChange={(v) => upd(["followupRules", fr.key, "afterSilentHours"], v)} /></Field>
              <Field label="Hedef (yapay zekâya talimat)"><Txt rows={3} value={r.followupRules[fr.key].goal} onChange={(v) => upd(["followupRules", fr.key, "goal"], v)} /></Field>
            </div>
            <Field label="Yedek metin"><Txt rows={2} value={r.followupRules[fr.key].fallback} onChange={(v) => upd(["followupRules", fr.key, "fallback"], v)} /></Field>
          </div>
        )))}
        <p className="a-help">Not: Ücretsiz Vercel planında takip mesajları günde bir kez (Türkiye saatiyle 12:00) gönderilir. Saatlik gönderim için supabase/optional_hourly_cron.sql dosyasını çalıştırın.</p>
      </Card>
      <Card title="İlgi puanı ağırlıkları" desc="Her sinyal kişinin puanına bu kadar “puan” ekler (eksi değerler düşürür). 30 puan = 100/100. Örn: “Fiyat sordu” ağırlığını artırırsanız fiyat soranlar teklif eşiğine daha hızlı ulaşır. 🔒 işaretli sinyalleri yapay zekâ değil sistem doğrular.">
        <div className="a-grid2">
          {s.signals.map((sg: Any) => (
            <div className="a-row" key={sg.key} style={{ justifyContent: "space-between", borderBottom: "1px dashed #e6ebe8", paddingBottom: 6 }}>
              <span style={{ flex: 1 }}>{sg.source === "system" ? "🔒 " : ""}{SIGNAL_TR[sg.key] ?? sg.key} <span className="a-help">(ilk: {s.defaults.rules.weights[sg.key]})</span></span>
              <div style={{ width: 90 }}><Num value={r.weights[sg.key]} min={-20} max={20} onChange={(v) => upd(["weights", sg.key], v)} /></div>
            </div>
          ))}
        </div>
      </Card>
      {group("learning", "Öğrenme ayarları", "Koçun ve A/B testlerinin ne kadar veriyle karar vereceği.")}
      {group("support", "Destek talepleri", "Müşteri ekran görüntüsü gönderdiğinde veya insan istediğinde talep açılır ve o kişi için yapay zekâ susar. Siz Telegram'dan cevap verirsiniz; “Çözüldü” deyince bot devam eder.")}
      {group("retention", "Veri saklama (ücretsiz Supabase = 500 MB)", "Temizlik her gün, konuşmalar analiz edildikten SONRA çalışır. Öğrenilen her şey (rehberler, analizler, puanlarınız, bot bilgisi, ayarlar) kalıcıdır.")}
      <SaveBar onSave={save} onReset={reset} busy={busy} dirty={dirty} />
    </>
  );
}

/* =====================================================================
 *  6. ÖĞRENME  (öneriler · onay · playbook · A/B testleri)
 * ===================================================================== */
const SLOT_TR: Record<string, string> = { opening: "Açılış mesajı", free_invite: "Ücretsiz kanala davet", engagement: "Kanaldaki sohbet", vip_transition: "VIP'e geçiş cümlesi", objection_handling: "İtiraz yönetimi" };
const METRIC_TR: Record<string, string> = { reply: "Cevap yazma", free_join: "Kanala girme", vip_offer: "VIP teklifine ulaşma", checkout: "Ödeme sayfasını açma", purchase: "Satın alma" };
const COACH_TR: Record<string, string> = { waiting: "bekliyor (yeterli analiz birikmedi)", proposed: "yeni bir öneri hazırladı — aşağıda onayınızı bekliyor", activated: "yeni playbook'u yayına aldı", unchanged: "değişiklik gerekmediğine karar verdi", rejected: "önerisi güvenlik kontrolünden geçemedi", error: "hata verdi" };
const OBJ_KEYS: [string, string][] = [["price", "Fiyat"], ["trust", "Güven"], ["value", "Değer / fark"], ["timing", "Zaman"], ["results", "Sonuç / garanti"], ["other", "Diğer"]];

function diffGuidelines(a: Any[], b: Any[]) {
  const A = new Map(a.map((g) => [g.id, g.text]));
  const B = new Map(b.map((g) => [g.id, g.text]));
  const out: { t: string; text: string; old?: string }[] = [];
  for (const g of b) { if (!A.has(g.id)) out.push({ t: "Eklendi", text: g.text }); else if (A.get(g.id) !== g.text) out.push({ t: "Değişti", text: g.text, old: A.get(g.id) }); }
  for (const g of a) if (!B.has(g.id)) out.push({ t: "Silindi", text: g.text });
  return out;
}

function Learning() {
  const [d, setD] = useState<Any>(null);
  const [pb, setPb] = useState<Any>(null);
  const [summary, setSummary] = useState("");
  const [force, setForce] = useState(false);
  const [exp, setExp] = useState<Any>({ slot: "opening", name: "", hypothesis: "", metric: "reply", variantA: "", variantB: "", start: true });
  const [busy, run] = useBusy();
  const load = useCallback(() => run("load", async () => { const r = await api("learning"); setD(r); setPb(r.active.content); }), [run]);
  useEffect(() => { load(); }, [load]);
  if (!d || !pb) return <p className="a-help">Yükleniyor…</p>;
  const pbDirty = JSON.stringify(pb) !== JSON.stringify(d.active.content);
  return (
    <>
      <h1>Öğrenme</h1>
      <p className="a-intro">Bot kendi kendine satış davranışını DEĞİŞTİRMEZ. Döngü şöyle: konuşma biter → yapay zekâ analiz eder → {d.needed} analiz birikince “koç” yeni bir satış rehberi (playbook) ÖNERİR → siz okuyup onaylarsınız → ancak o zaman yayına girer.</p>

      <Card title="Durum" right={<Btn onClick={() => run("learn", async () => { const r = await api("run_learning", { force }); notify(`Tamamlandı.\nSessiz diye kapatılan: ${r.closedAsSilent}\nAnaliz edilen konuşma: ${r.analyzed}\nKoç: ${COACH_TR[r.coach.status] ?? r.coach.status}${r.purged ? `\nTemizlik: ${r.purged.messages} eski mesaj silindi` : ""}`); await load(); })} busy={busy === "learn"}>Öğrenme turunu şimdi çalıştır</Btn>}>
        <p>Koç için biriken analiz: <b>{d.pending} / {d.needed}</b> · Henüz kullanılmamış puanınız: <b>{d.freshReviews}</b> · Yayındaki rehber: <b>v{d.active.version}</b></p>
        <div className="a-bar" style={{ margin: "10px 0" }}><i style={{ width: `${Math.min(100, (d.pending / d.needed) * 100)}%` }} /></div>
        <label className="a-row"><input type="checkbox" style={{ width: 20 }} checked={force} onChange={(e) => setForce(e.target.checked)} /> Yeterli analiz birikmese de koçu şimdi çalıştır (kanıt zayıf olabilir)</label>
        <p className="a-help" style={{ marginTop: 6 }}>Normalde her gün otomatik çalışır. Bu düğme 1–3 dakika sürebilir; sayfayı kapatmayın.</p>
      </Card>

      <Card title={`Onayınızı bekleyen öneriler (${d.proposals.length})`} desc="Koçun önerdiği yeni rehber. Onaylarsanız hemen yayına girer; reddederseniz mevcut rehber kalır.">
        {!d.proposals.length && <p className="a-help">Şu an bekleyen öneri yok.</p>}
        {d.proposals.map((p: Any) => (
          <div key={p.version} style={{ border: "1.5px solid #f1d58a", borderRadius: 12, padding: 14, marginBottom: 12, background: "#fffdf5" }}>
            <h3>Öneri v{p.version} <span className="a-help">· {when(p.created_at)}</span></h3>
            <p style={{ margin: "8px 0" }}>{p.summary}</p>
            {diffGuidelines(d.active.content.guidelines, p.content.guidelines).map((x, i) => (
              <p key={i} style={{ fontSize: 14, marginBottom: 6 }}><Pill tone={x.t === "Eklendi" ? "green" : x.t === "Silindi" ? "red" : "amber"}>{x.t}</Pill> {x.text}{x.old && <span className="a-help"><br />Eskisi: {x.old}</span>}</p>
            ))}
            <div className="a-row" style={{ marginTop: 10 }}>
              <Btn onClick={() => run(`ok${p.version}`, async () => { await api("playbook_decide", { version: p.version, approve: true }); await load(); }, `v${p.version} yayında.`)} busy={busy === `ok${p.version}`}>✓ Onayla ve yayına al</Btn>
              <Btn kind="danger" onClick={() => run(`no${p.version}`, async () => { await api("playbook_decide", { version: p.version, approve: false }); await load(); }, "Reddedildi.")} busy={busy === `no${p.version}`}>✕ Reddet</Btn>
            </div>
          </div>
        ))}
      </Card>

      <Card title={`Yayındaki satış rehberi (v${d.active.version})`} desc="Botun her konuşmada okuduğu, geçmiş konuşmalardan öğrenilmiş tavsiyeler. İsterseniz kendiniz düzenleyin: kaydettiğinizde yeni bir sürüm olarak yayına girer. Türkçe yazın.">
        {pb.guidelines.map((g: Any, i: number) => (
          <div className="a-listedit" key={g.id}>
            <div style={{ width: 210 }}><select value={g.stage} onChange={(e) => setPb(setIn(pb, ["guidelines", i, "stage"], e.target.value))}>{Object.keys(STAGE_TR).filter((k) => k !== "NEW" || g.stage === "NEW").map((k) => <option key={k} value={k}>{STAGE_TR[k]}</option>)}</select></div>
            <Txt rows={2} value={g.text} onChange={(v) => setPb(setIn(pb, ["guidelines", i, "text"], v))} />
            <Btn small kind="danger" onClick={() => setPb({ ...pb, guidelines: pb.guidelines.filter((_: Any, j: number) => j !== i) })}>Sil</Btn>
          </div>
        ))}
        <Btn small kind="soft" onClick={() => setPb({ ...pb, guidelines: [...pb.guidelines, { id: `m${Date.now() % 1000000}`, stage: "ANY", text: "" }] })}>+ Tavsiye ekle</Btn>
        <h3 style={{ margin: "18px 0 8px" }}>İtirazlara önerilen yaklaşım</h3>
        <div className="a-grid2">{OBJ_KEYS.map(([k, l]) => <Field key={k} label={l}><Txt rows={3} value={pb.objection_responses?.[k] ?? ""} onChange={(v) => setPb(setIn(pb, ["objection_responses", k], v))} /></Field>)}</div>
        <Field label="Kaçınılacak şeyler"><ListEdit items={pb.avoid ?? []} onChange={(v) => setPb({ ...pb, avoid: v })} placeholder="Madde ekle" /></Field>
        {(pb.locked_winners ?? []).length > 0 && <div className="a-info"><b>A/B testiyle kanıtlanmış (kilitli):</b>{pb.locked_winners.map((w: Any) => <div key={w.slot}>• [{SLOT_TR[w.slot] ?? w.slot}] {w.instruction}</div>)}</div>}
        <Field label="Bu sürümde ne değiştirdiniz? (kendinize not)"><Txt value={summary} onChange={setSummary} /></Field>
        <div className="a-row">
          <Btn disabled={!pbDirty} onClick={() => run("pb", async () => { const r = await api("playbook_save", { content: { ...pb, guidelines: pb.guidelines.filter((g: Any) => g.text.trim()), avoid: (pb.avoid ?? []).filter((x: string) => x.trim()) }, summary }); setSummary(""); await load(); notify(`v${r.version} yayında.`); })} busy={busy === "pb"}>Yeni sürüm olarak kaydet ve yayına al</Btn>
          {pbDirty && <Btn kind="soft" onClick={() => setPb(d.active.content)}>Değişiklikleri geri al</Btn>}
        </div>
      </Card>

      <Card title="A/B testleri" desc="İki farklı yaklaşımı gerçek müşterilerde karşılaştırır. Yalnızca YENİ gelenler teste girer (yarı yarıya). Kazanan ilan etmek için hem yeterli kişi hem de istatistiksel anlamlılık (p < 0,05) gerekir; kazanan otomatik olarak rehbere kilitlenir.">
        {d.experiments.map((e: Any) => {
          const r = e.results ?? {};
          return (
            <div key={e.id} style={{ borderTop: "1px solid #eef2f0", padding: "12px 0" }}>
              <div className="a-row" style={{ justifyContent: "space-between" }}>
                <h3>#{e.id} {e.name}</h3>
                <div className="a-row">
                  <Pill tone={e.status === "running" ? "green" : e.status === "won" ? "blue" : e.status === "draft" ? "amber" : undefined}>{({ draft: "Taslak", running: "Çalışıyor", won: `Kazanan: ${e.winner}`, inconclusive: "Fark çıkmadı", stopped: "Durduruldu" } as Any)[e.status]}</Pill>
                  {e.status === "draft" && <Btn small onClick={() => run(`e${e.id}`, async () => { notify((await api("experiment_status", { id: e.id, status: "running" })).message); await load(); })}>Başlat</Btn>}
                  {e.status === "running" && <Btn small kind="danger" onClick={() => run(`e${e.id}`, async () => { await api("experiment_status", { id: e.id, status: "stopped" }); await load(); }, "Durduruldu.")}>Durdur</Btn>}
                  {e.status !== "running" && <Btn small kind="soft" onClick={() => window.confirm(`Test #${e.id} ve sonuçları silinsin mi?`) && run(`x${e.id}`, async () => { await api("row_delete", { table: "experiments", id: e.id }); await load(); }, "Silindi.")}>Sil</Btn>}
                </div>
              </div>
              <p className="a-help">{SLOT_TR[e.slot] ?? e.slot} · ölçüt: {METRIC_TR[e.metric] ?? e.metric} · varyant başına en az {e.min_sample} kişi</p>
              {e.variants.map((v: Any) => <p key={v.key} style={{ fontSize: 14, marginTop: 4 }}><b>{v.key}:</b> {v.instruction} {r[v.key] && <Pill>{r[v.key].s}/{r[v.key].n} · {pct(r[v.key].s, r[v.key].n)}</Pill>}</p>)}
              {typeof r.pValue === "number" && <p className="a-help">p = {r.pValue.toFixed(3)} {r.pValue < 0.05 ? "(anlamlı fark)" : "(henüz anlamlı fark yok)"}</p>}
            </div>
          );
        })}
        <h3 style={{ margin: "16px 0 8px" }}>Yeni test oluştur</h3>
        <div className="a-grid3">
          <Field label="Botun hangi anı?"><select value={exp.slot} onChange={(e) => setExp({ ...exp, slot: e.target.value })}>{Object.entries(SLOT_TR).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
          <Field label="Başarı ölçütü"><select value={exp.metric} onChange={(e) => setExp({ ...exp, metric: e.target.value })}>{Object.entries(METRIC_TR).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
          <Field label="Test adı"><Txt value={exp.name} onChange={(v) => setExp({ ...exp, name: v })} /></Field>
        </div>
        <div className="a-grid2">
          <Field label="A varyantı (bota talimat)"><Txt rows={3} value={exp.variantA} onChange={(v) => setExp({ ...exp, variantA: v })} /></Field>
          <Field label="B varyantı (bota talimat)"><Txt rows={3} value={exp.variantB} onChange={(v) => setExp({ ...exp, variantB: v })} /></Field>
        </div>
        <Field label="Varsayımınız (neden B daha iyi olabilir?)"><Txt value={exp.hypothesis} onChange={(v) => setExp({ ...exp, hypothesis: v })} /></Field>
        <div className="a-row">
          <label className="a-row"><input type="checkbox" style={{ width: 20 }} checked={exp.start} onChange={(e) => setExp({ ...exp, start: e.target.checked })} /> Hemen başlat (aynı anda o “an” için başka test çalışıyorsa taslak kalır)</label>
          <Btn onClick={() => run("exp", async () => { await api("experiment_create", exp); setExp({ ...exp, name: "", hypothesis: "", variantA: "", variantB: "" }); await load(); }, "Test oluşturuldu.")} busy={busy === "exp"} disabled={exp.variantA.trim().length < 10 || exp.variantB.trim().length < 10 || !exp.name.trim()}>Testi oluştur</Btn>
        </div>
      </Card>

      <Card title="Rehber sürüm geçmişi" desc="Eski bir sürüme dönmek isterseniz “Bu sürüme dön” deyin: içeriği yeni bir sürüm olarak yayına alınır.">
        {[...d.versions, ...(d.versions.some((v: Any) => v.version === 1) ? [] : [{ version: 1, status: d.active.version === 1 ? "active" : "retired", summary: "Elle yazılmış başlangıç rehberi.", created_by: "system" }])].map((v: Any) => (
          <div key={v.version} className="a-row" style={{ justifyContent: "space-between", borderTop: "1px solid #eef2f0", padding: "8px 0" }}>
            <span style={{ flex: 1, minWidth: 220 }}><b>v{v.version}</b> <Pill tone={v.status === "active" ? "green" : v.status === "proposed" ? "amber" : v.status === "rejected" ? "red" : undefined}>{({ active: "Yayında", proposed: "Onay bekliyor", retired: "Eski", rejected: "Reddedildi" } as Any)[v.status] ?? v.status}</Pill> <span className="a-help">{v.created_by === "coach" ? "koç" : v.created_by === "experiment" ? "A/B testi" : v.created_by === "admin" ? "siz" : ""} {v.created_at ? `· ${when(v.created_at)}` : ""}<br />{v.summary}</span></span>
            {v.status !== "active" && v.status !== "proposed" && <Btn small kind="soft" onClick={() => window.confirm(`v${v.version} içeriği yeniden yayına alınsın mı?`) && run(`r${v.version}`, async () => { const r = await api("playbook_restore", { version: v.version }); await load(); notify(`v${v.version} içeriği v${r.version} olarak yayında.`); })} busy={busy === `r${v.version}`}>Bu sürüme dön</Btn>}
            {v.status !== "active" && v.version !== 1 && <Btn small kind="danger" onClick={() => window.confirm(`v${v.version} silinsin mi?`) && run(`dv${v.version}`, async () => { await api("row_delete", { table: "playbooks", id: v.version }); await load(); }, "Silindi.")}>Sil</Btn>}
          </div>
        ))}
      </Card>

      <Card title="Koçun geçmiş turları">
        {d.batches.map((b: Any) => (
          <div key={b.id} style={{ borderTop: "1px solid #eef2f0", padding: "10px 0" }}>
            <p><button className="a-del" title="Bu turu sil" onClick={() => window.confirm(`Tur #${b.id} silinsin mi?`) && run(`b${b.id}`, async () => { await api("row_delete", { table: "learning_batches", id: b.id }); await load(); })}>🗑</button><b>Tur #{b.id}</b> <span className="a-help">· {when(b.created_at)} · {b.sample_size} konuşma, {b.won_count} satış · en büyük kayıp: {b.biggest_leak ?? "–"}</span> <Pill>{({ proposed: "Öneri hazırlandı", active: "Yayına alındı", unchanged: "Değişiklik yok", rejected: "Reddedildi (güvenlik)" } as Any)[b.result] ?? b.result}</Pill></p>
            <p style={{ fontSize: 14, marginTop: 4 }}>{b.summary}</p>
            {(b.problems ?? []).length > 0 && <p className="a-help">Sorunlar: {b.problems.join(" · ")}</p>}
          </div>
        ))}
        {!d.batches.length && <p className="a-help">Koç henüz hiç çalışmadı. {d.needed} konuşma analiz edilince ilk öneri gelir.</p>}
      </Card>

      <Card title="Son analiz edilen konuşmalar" desc="Kalite puanı 0–100 (yapay zekânın değerlendirmesi). Kendi puanınızı “Konuşmalar” sekmesinden verebilirsiniz.">
        <div className="a-scroll">
          <table className="a-table">
            <thead><tr><th>Kişi</th><th>Sonuç</th><th>Kalite</th><th>Özet ve botun hataları</th></tr></thead>
            <tbody>
              {d.analyses.map((a: Any) => (
                <tr key={a.lead_id}><td>{a.leads?.first_name ?? "?"}<br /><span className="a-help">{when(a.created_at)}</span></td>
                  <td>{a.outcome === "won" ? <Pill tone="green">Satış</Pill> : <Pill tone="red">{a.loss_reason ?? "Kayıp"}</Pill>}<br /><span className="a-help">{STAGE_TR[a.drop_stage] ?? a.drop_stage}</span></td>
                  <td><b>{a.conversation_quality ?? "–"}</b></td><td style={{ fontSize: 13.5 }}><button className="a-del" title="Bu analizi sil" onClick={() => window.confirm("Bu analiz silinsin mi?") && run(`a${a.lead_id}`, async () => { await api("row_delete", { table: "conversation_analyses", id: a.lead_id }); await load(); })}>🗑</button>{a.summary}{(a.agent_mistakes ?? []).length > 0 && <><br /><span style={{ color: "#a3241d" }}>Hata: {a.agent_mistakes.join(" · ")}</span></>}</td></tr>
              ))}
              {!d.analyses.length && <tr><td colSpan={4} className="a-help">Henüz analiz yok.</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}

/* =====================================================================
 *  7. ÖDEMELER
 * ===================================================================== */
function Payments() {
  const [d, setD] = useState<Any>(null);
  const [ids, setIds] = useState<Record<string, string>>({});
  const [busy, run] = useBusy();
  const load = useCallback(() => run("load", async () => setD(await api("payments"))), [run]);
  useEffect(() => { load(); }, [load]);
  return (
    <>
      <h1>Ödemeler</h1>
      <p className="a-intro">Whop'tan gelen bütün ödemeler. “Bağlanmamış” bir ödeme, hangi Telegram kullanıcısına ait olduğu bulunamayan ödemedir: müşterinin Telegram ID'sini yazıp bağlarsanız VIP erişimi otomatik gönderilir ve satış sayılır.</p>
      <Card>
        <div className="a-scroll">
          <table className="a-table">
            <thead><tr><th>Tarih</th><th>Kişi</th><th>Plan</th><th>Tutar</th><th>Durum</th><th>E-posta</th></tr></thead>
            <tbody>
              {(d?.payments ?? []).map((p: Any) => (
                <tr key={p.whop_payment_id}>
                  <td>{when(p.created_at)}</td>
                  <td>{p.lead_id ? <>{p.leads?.first_name ?? "?"} {p.leads?.username ? `@${p.leads.username}` : ""}{p.matched_by === "recent_checkout" && <><br /><Pill tone="amber">tahmini eşleşme — kontrol edin</Pill></>}</> : (
                    <div className="a-row"><Pill tone="red">Bağlanmamış</Pill><div style={{ width: 150 }}><input placeholder="Telegram ID" value={ids[p.whop_payment_id] ?? ""} onChange={(e) => setIds({ ...ids, [p.whop_payment_id]: e.target.value })} /></div>
                      <Btn small onClick={() => run(p.whop_payment_id, async () => { notify((await api("payment_link", { payment_id: p.whop_payment_id, telegram_id: ids[p.whop_payment_id] })).message); await load(); })} busy={busy === p.whop_payment_id}>Bağla</Btn></div>
                  )}</td>
                  <td>{PLAN_TR[p.plan_key] ?? p.plan_key ?? "–"}</td><td>{money(p.amount)}</td>
                  <td>{p.status === "refunded" ? <Pill tone="red">İade edildi</Pill> : p.is_first ? <Pill tone="green">Yeni satış</Pill> : <Pill tone="blue">Yenileme</Pill>}</td><td className="a-help">{p.email ?? ""} <button className="a-del" title="Bu ödeme kaydını sil" onClick={() => window.confirm("Bu ödeme KAYDI silinsin mi? (Whop'taki gerçek ödeme etkilenmez; panelde gelir toplamı değişmez.)") && run(`p${p.whop_payment_id}`, async () => { await api("row_delete", { table: "payments", id: p.whop_payment_id }); await load(); })}>🗑</button></td>
                </tr>
              ))}
              {d && !d.payments.length && <tr><td colSpan={6} className="a-help">Henüz ödeme yok.</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}

/* =====================================================================
 *  8. SİSTEM
 * ===================================================================== */
function System() {
  const [d, setD] = useState<Any>(null);
  const [busy, run] = useBusy();
  const load = useCallback(() => run("load", async () => setD(await api("system"))), [run]);
  useEffect(() => { load(); }, [load]);
  if (!d) return <p className="a-help">Yükleniyor…</p>;
  const ok = (v: boolean, yes: string, no: string) => <p style={{ marginBottom: 6 }}>{v ? "✅" : "⚠️"} {v ? yes : no}</p>;
  return (
    <>
      <h1>Sistem</h1>
      <p className="a-intro">Bağlantıların sağlık durumu ve elle çalıştırabileceğiniz işlemler. Şifreler ve API anahtarları güvenlik nedeniyle panelde gösterilmez; onları Vercel → Settings → Environment Variables bölümünden değiştirirsiniz.</p>
      <Card title="Sağlık kontrolü" right={<Btn small kind="soft" onClick={load}>Yenile</Btn>}>
        {ok(!d.envProblems.length, "Bütün zorunlu ayarlar (environment variables) doğru.", `Hatalı / eksik ayarlar: ${d.envProblems.join(" | ")}`)}
        {ok(d.webhook?.url === `${d.appUrl}/api/telegram/webhook` && !d.webhook?.last_error_message, "Telegram bağlantısı çalışıyor.", `Telegram bağlantısında sorun: ${d.webhook?.last_error_message ?? d.webhook?.error ?? "webhook adresi farklı"} — aşağıdaki düğmeyle yeniden kurun.`)}
        {ok(d.flags.whopApiKey, "Whop API anahtarı var: her ödeme doğru kişiye otomatik bağlanır.", "Whop API anahtarı yok: ödemeler tahmini eşleştirilir.")}
        {ok(d.flags.vipChannelId, "VIP kanalı bağlı: tek kullanımlık davet + abonelik bitince otomatik çıkarma.", "TELEGRAM_VIP_CHANNEL_ID yok.")}
        {ok(d.flags.meta, d.flags.metaTestMode ? "Meta bağlı — DİKKAT: test modu açık (META_TEST_EVENT_CODE). Gerçek reklamdan önce silin." : "Meta Pixel + Conversions API bağlı.", "Meta bağlı değil: reklamlar satışları göremez.")}
        {d.lastMetaError && <p style={{ marginBottom: 6 }}>⚠️ Meta son olayı reddetti ({d.lastMetaError.event} · {when(d.lastMetaError.at)}): <span className="a-help">{d.lastMetaError.detail}</span></p>}
        {d.flags.meta && <p className="a-help" style={{ marginBottom: 6 }}>Meta'ya giden olaylar: Contact (sitede butona basıldı) → Lead (botu başlattı) → CompleteRegistration (ücretsiz kanala girdi, doğrulandı) → InitiateCheckout (ödeme sayfası) → Purchase (ödeme onaylandı, tutar ile).</p>}
        {ok(d.flags.adminChat, "Telegram yönetici bildirimleri açık.", "TELEGRAM_ADMIN_CHAT_ID yok: satış bildirimi alamazsınız.")}
        {ok(d.flags.support, "Destek kişisi tanımlı.", "SUPPORT_USERNAME yok.")}
        {ok(d.flags.ownPassword, "Panel için ayrı şifre (ADMIN_PASSWORD) tanımlı.", "Panel şu an SETUP_SECRET ile açılıyor. Vercel'e ADMIN_PASSWORD ekleyip yeniden yayınlarsanız ayrı bir şifreniz olur.")}
        {ok(!d.flags.autoApprove, "Öneriler sizin onayınızı bekliyor (önerilen ayar).", "DİKKAT: PLAYBOOK_AUTO_APPROVE=true — koçun önerileri onaysız yayına giriyor.")}
        <p className="a-help">Yapay zekâ modeli: {d.model} · Adres: {d.appUrl} · Bekleyen Telegram mesajı: {d.webhook?.pending_update_count ?? "?"}</p>
      </Card>
      <Card title="Veritabanı kullanımı" desc="Ücretsiz Supabase planı 500 MB verir. Eski mesaj metinleri ve ham kayıtlar her gün otomatik silinir (süreyi “Kurallar ve Puanlama → Veri saklama” bölümünden ayarlarsınız).">
        {d.usage ? (
          <>
            <p><b>{(d.usage.bytes / 1048576).toFixed(1)} MB</b> / 500 MB</p>
            <div className="a-bar" style={{ margin: "8px 0 12px" }}><i style={{ width: `${Math.min(100, (d.usage.bytes / (500 * 1048576)) * 100)}%`, background: d.usage.bytes > 400 * 1048576 ? "#b3261e" : undefined }} /></div>
            {d.usage.tables.map((t: Any) => <p key={t.name} className="a-help">{t.name}: {(t.bytes / 1048576).toFixed(2)} MB · ~{t.rows} satır</p>)}
          </>
        ) : <p className="a-help">⚠️ Ölçülemedi: Supabase'de supabase/support_and_cleanup.sql dosyasını çalıştırın.</p>}
        <div style={{ marginTop: 10 }}><Btn kind="ghost" onClick={() => run("purge", async () => { const r = await api("purge_now"); notify(`Silinen — mesaj: ${r.purged.messages} · olay kaydı: ${r.purged.events} · webhook: ${r.purged.webhooks} · ödeme bağlantısı: ${r.purged.checkouts}`); await load(); })} busy={busy === "purge"}>Eski verileri şimdi temizle</Btn></div>
      </Card>
      <Card title="Elle çalıştır">
        <div className="a-row">
          <Btn kind="ghost" onClick={() => run("hook", async () => { await api("register_webhook"); await load(); }, "Telegram bağlantısı yeniden kuruldu.")} busy={busy === "hook"}>Telegram bağlantısını yeniden kur</Btn>
          <Btn kind="ghost" onClick={() => window.confirm("Zamanı gelmiş takip mesajları ŞİMDİ gönderilsin mi? (Türkiye'de gece olabilir.)") && run("fu", async () => { const r = await api("run_followups"); notify(`Gönderilen: ${r.sent} · engellenmiş: ${r.blocked} · hata: ${r.errors}`); })} busy={busy === "fu"}>Takip mesajlarını şimdi gönder</Btn>
        </div>
      </Card>
      <div className="a-grid2">
        <Card title="Başarısız Whop bildirimleri" desc="Whop bunları otomatik tekrar dener.">
          {d.failedWhop.map((w: Any) => <p key={w.id} style={{ fontSize: 13.5, marginBottom: 6 }}><b>{w.type}</b> · {when(w.created_at)}<br /><span className="a-help">{w.error}</span></p>)}
          {!d.failedWhop.length && <p className="a-help">Yok 👍</p>}
        </Card>
        <Card title="Başarısız Telegram mesajları">
          {d.failedTelegram.map((t: Any) => <p key={t.update_id} style={{ fontSize: 13.5, marginBottom: 6 }}>#{t.update_id} · {when(t.created_at)} · {t.attempts} deneme<br /><span className="a-help">{t.error}</span></p>)}
          {!d.failedTelegram.length && <p className="a-help">Yok 👍</p>}
        </Card>
      </div>
    </>
  );
}

/* =====================================================================
 *  DESTEK TALEPLERİ
 * ===================================================================== */
function Tickets({ openLead }: { openLead: (id: string) => void }) {
  const [d, setD] = useState<Any>(null);
  const [busy, run] = useBusy();
  const load = useCallback(() => run("load", async () => setD(await api("tickets"))), [run]);
  useEffect(() => { load(); }, [load]);
  return (
    <>
      <h1>Destek Talepleri</h1>
      <p className="a-intro">Müşteri ekran görüntüsü gönderdiğinde veya insan istediğinde talep açılır ve o kişi için yapay zekâ susar. Normalde <b>Telegram'da</b> bottan gelen mesajdaki “Cevapla / Çözüldü / Yapay zekâya öğret” düğmeleriyle yönetirsiniz; burası genel görünüm ve temizlik içindir. Ekran görüntüleri veritabanına KAYDEDİLMEZ — yalnızca sizin Telegram sohbetinizde durur. “Sil” derseniz bot o mesajları sohbetinizden de silmeyi dener (Telegram buna yaklaşık 48 saat izin verir).</p>
      <Card>
        <div className="a-scroll">
          <table className="a-table">
            <thead><tr><th>#</th><th>Kişi</th><th>Neden</th><th>Durum</th><th>Son hareket</th><th /></tr></thead>
            <tbody>
              {(d?.tickets ?? []).map((t: Any) => (
                <tr key={t.id}>
                  <td>{t.id}</td>
                  <td>{t.leads?.first_name ?? "?"} {t.leads?.username ? `@${t.leads.username}` : ""} {t.leads?.vip_active && <Pill tone="green">VIP</Pill>}</td>
                  <td>{t.reason === "screenshot" ? "📸 Ekran görüntüsü" : "🙋 İnsan istedi"}</td>
                  <td>{t.status === "open" ? <Pill tone="amber">Açık — bot susuyor</Pill> : t.status === "solved" ? <Pill tone="green">Çözüldü</Pill> : <Pill>Süre doldu, bot devraldı</Pill>}</td>
                  <td>{when(t.last_activity_at)}</td>
                  <td><div className="a-row">
                    <Btn small kind="soft" onClick={() => openLead(t.lead_id)}>Konuşmayı aç</Btn>
                    {t.status === "open" && <Btn small onClick={() => run(`s${t.id}`, async () => { await api("ticket_action", { id: t.id, op: "solve" }); await load(); }, "Çözüldü. Bot bu kişiye tekrar cevap veriyor.")} busy={busy === `s${t.id}`}>Çözüldü</Btn>}
                    <Btn small kind="danger" onClick={() => window.confirm("Talep ve Telegram sohbetinizdeki ilgili mesajlar (ekran görüntüsü dahil) silinsin mi?") && run(`d${t.id}`, async () => { await api("ticket_action", { id: t.id, op: "delete" }); await load(); }, "Silindi.")} busy={busy === `d${t.id}`}>Sil</Btn>
                  </div></td>
                </tr>
              ))}
              {d && !d.tickets.length && <tr><td colSpan={6} className="a-help">Henüz destek talebi yok. (Tablo hiç görünmüyorsa Supabase'de support_and_cleanup.sql dosyasını çalıştırın.)</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}

/* =====================================================================
 *  HAZIR MESAJLAR  +  AÇILIŞ SAYFASI   (aynı düzenleyici)
 * ===================================================================== */
type FlatGroup = { title: string; desc?: string; items: [string, string, string?, number?][] };

const TEXT_GROUPS: FlatGroup[] = [
  { title: "Planlar ve VIP", items: [["plansIntro", "Plan listesinin başlığı"], ["plansFooter", "Plan listesinin altındaki açıklama", "Abonelik / otomatik yenileme bilgisini burada tutun.", 4], ["alreadyVipStart", "Zaten VIP olan biri /start yazınca"], ["alreadyVip", "Zaten VIP olan biri /planlar yazınca"], ["doNotSell", "Satış kapalı kişiye (yaş / risk)", "", 3]] },
  { title: "Ücretsiz kanal", items: [["freeInviteFallback", "Bot daveti unutursa sistemin gönderdiği davet", "", 3], ["canal", "/kanal komutunun cevabı"], ["joinConfirmed", "“Katıldım” → doğrulandı bildirimi"], ["joinNotFound", "“Katıldım” → kanalda bulunamadı uyarısı", "En fazla ~190 karakter gösterilir.", 2]] },
  { title: "Ses, resim ve destek", items: [["audioReply", "Sesli mesaj gelince", "", 2], ["imageReceived", "Resim gelince (size iletildi)", "", 3], ["imageNoTeam", "Resim gelince (yönetici sohbeti tanımlı değilse)", "", 2], ["ticketAck", "Destek talebi açıkken müşteri yazınca (saatte en fazla 1 kez)", "", 2], ["handoffContact", "İnsan istendiğinde destek kişisi", "{support} = destek kullanıcı adı"], ["nonTextReply", "Çıkartma / dosya / video gelince", "", 2]] },
  { title: "Ödeme ve erişim", items: [["vipDelivered", "Ödeme onaylandı (VIP linkiyle)", "{plan} = plan adı", 5], ["vipDeliveredNoLink", "Ödeme onaylandı (link yoksa)", "{plan} = plan adı", 5], ["vipEnded", "Abonelik bitti, VIP'ten çıkarıldı", "", 3], ["paymentFailed", "İlk ödeme reddedildi", "", 3]] },
  { title: "Genel", items: [["optOutDone", "“DUR” yazınca", "", 2], ["help", "Bilinmeyen komut / yardım", "", 2], ["technicalFallback", "Yapay zekâ o an çalışmıyorsa", "", 2], ["safeFallback", "Yapay zekâ güvenli cevap üretemediyse", "", 2]] },
  { title: "Düğme yazıları", desc: "En fazla 40 karakter.", items: [["btnJoinFree", "Ücretsiz kanala gir"], ["btnJoined", "Girdim"], ["btnVip", "VIP kanala gir"], ["btnSupport", "Ekiple konuş"]] },
];
const LANDING_GROUPS: FlatGroup[] = [
  { title: "Üst bölüm (ilk ekran)", desc: "Reklamdan gelen kişinin kaydırmadan gördüğü yer. Başlık + düğme dönüşümün %80'idir. “İsteğe bağlı” yazanları boş bırakırsanız o satır sayfadan kalkar.", items: [["eyebrow", "Başlığın üstündeki küçük etiket (isteğe bağlı)"], ["headline1", "Başlık — 1. satır"], ["headlineHighlight", "Başlık — sarı satır (isteğe bağlı)"], ["headline2", "Başlık — son satır (isteğe bağlı)"], ["lead", "Başlığın altındaki tek cümle", "Kısa tutun: telefonda 2–3 satırı geçmesin.", 3], ["cta", "Ana düğme yazısı", "Alttaki yapışkan çubuktaki düğme de bunu kullanır."], ["trust1", "Güven işareti 1 (isteğe bağlı)"], ["trust2", "Güven işareti 2 (isteğe bağlı)"], ["trust3", "Güven işareti 3 (isteğe bağlı)"], ["micro", "Düğmenin altındaki küçük not (isteğe bağlı)", "", 2], ["fallbackHint", "“Telegram açılmadı mı?” yedek bağlantısı (isteğe bağlı)", "Instagram / Facebook içi tarayıcılar bazen Telegram'ı açmaz; düğmeye basıldıktan 2 saniye sonra bu bağlantı görünür."]] },
  { title: "Örnek mesaj kartı", desc: "Telegram'a gelen mesajın BİÇİMİNİ gösterir (gri çizgilerle). Bilerek gerçek maç veya tahmin içermez.", items: [["previewTitle", "Kartın üstündeki başlık"], ["previewLabel", "Mesajın başlığı"], ["previewAvatar", "Avatar yazısı (1–3 karakter)"], ["previewSmall", "Kanal adının altındaki küçük yazı (isteğe bağlı)"], ["previewRow1", "1. satır etiketi"], ["previewRow2", "2. satır etiketi"], ["previewRow3", "3. satır etiketi"], ["previewTime", "Sağ alttaki küçük yazı (isteğe bağlı)"], ["previewCaption", "Kartın altındaki açıklama (isteğe bağlı)", "", 2]] },
  { title: "Üst çubuk", items: [["brandMark", "Logo yazısı (boşsa marka adı; sondaki rakamlar sarı olur)"], ["ageBadge", "Yaş rozeti yazısı (boşsa +18)"]] },
  { title: "“Nasıl çalışır” ve “Ne alırsınız”", desc: "“Ne alırsınız” listesinin maddeleri İşletme Bilgileri → Ücretsiz kanal → “Kanalda neler paylaşılıyor?” bölümünden gelir.", items: [["howTitle", "“Nasıl çalışır” başlığı"], ["step1Title", "1. adım başlığı"], ["step1Text", "1. adım açıklaması", "", 2], ["step2Title", "2. adım başlığı"], ["step2Text", "2. adım açıklaması", "", 2], ["step3Title", "3. adım başlığı"], ["step3Text", "3. adım açıklaması", "", 2], ["benefitsTitle", "“Ne alırsınız” başlığı"]] },
  { title: "Sık sorulan sorular", desc: "İnsanların aklındaki şüpheyi sayfadan çıkmadan giderir. Bir sorunun sorusunu veya cevabını boş bırakırsanız o soru gizlenir.", items: [["faqTitle", "Bölüm başlığı"], ["faq1Q", "1. soru"], ["faq1A", "1. cevap", "", 3], ["faq2Q", "2. soru"], ["faq2A", "2. cevap", "", 3], ["faq3Q", "3. soru"], ["faq3A", "3. cevap", "", 3], ["faq4Q", "4. soru"], ["faq4A", "4. cevap", "", 3]] },
  { title: "Dürüstlük bölümü, son düğme ve alt bilgi", desc: "“Garanti yok” mesajı ve +18 uyarısı hem yasal koruma hem de Meta reklam onayı için önemlidir; yumuşatabilirsiniz ama kaldırmayın.", items: [["honestTitle", "Bölüm başlığı"], ["honestText", "Metin", "", 4], ["cta2", "Sayfa sonundaki düğme yazısı"], ["stickyText", "Alt yapışkan çubuktaki kısa yazı (isteğe bağlı)"], ["footer", "Alt bilgi (+18 uyarısı)", "", 4]] },
];

function FlatSection({ section, title, intro, groups, after }: { section: "texts" | "landing" | "safe" | "prompts_full" | "commands"; title: string; intro: ReactNode; groups: FlatGroup[]; after?: ReactNode }) {
  const { s, draft, upd, save, reset, busy, dirty } = useSection(section);
  if (!draft) return <p className="a-help">Yükleniyor…</p>;
  return (
    <>
      <h1>{title}</h1>
      <p className="a-intro">{intro}</p>
      {groups.map((g) => (
        <Card key={g.title} title={g.title} desc={g.desc}>
          {g.items.map(([k, label, help, rows]) => (
            <Field key={k} label={label} help={help || undefined}>
              <div className="a-listedit">
                <Txt rows={rows} value={draft[k]} onChange={(v) => upd([k], v)} />
                {draft[k] !== s.defaults[section][k] && <Btn small kind="soft" onClick={() => upd([k], s.defaults[section][k])}>İlk hâli</Btn>}
              </div>
            </Field>
          ))}
        </Card>
      ))}
      {after}
      <SaveBar onSave={save} onReset={reset} busy={busy} dirty={dirty} />
    </>
  );
}

/* =====================================================================
 *  ENTEGRASYONLAR  (Meta Pixel + Conversions API + olaylar + bağlantılar)
 * ===================================================================== */
const EVENT_TR: [string, string, string][] = [
  ["ctaClick", "Sitede “Telegram'da aç” düğmesine bastı", "Tarayıcı pikseli + sunucu (tek sayılır)"],
  ["botStarted", "Botu başlattı", "Sunucu"],
  ["freeJoined", "Ücretsiz kanala girdi (Telegram doğruladı)", "Sunucu"],
  ["vipOfferShown", "VIP planları ilk kez gösterildi", "Sunucu"],
  ["checkoutStarted", "Whop ödeme sayfasını açtı", "Sunucu (tutar ile)"],
  ["purchase", "İlk ödeme onaylandı", "Sunucu (tutar, para birimi, e-posta özeti ile)"],
  ["notInterested", "VIP'i istemediğini söyledi", "Sunucu · özel olay — VIP reklamlarından HARİÇ tutmak için"],
  ["doNotTarget", "“DUR” yazdı / yaş-risk işareti aldı / satışı siz kapattınız", "Sunucu · özel olay — HER reklam setinden hariç tutun (neden gönderilmez)"],
];
const STANDARD_EVENTS = ["Lead", "CompleteRegistration", "Contact", "ViewContent", "InitiateCheckout", "AddToCart", "AddPaymentInfo", "Purchase", "Subscribe", "StartTrial", "SubmitApplication", "Schedule"];

function Integrations() {
  const { s, draft: it, upd, save, busy, dirty, reset } = useSection("integrations");
  const [tBusy, run] = useBusy();
  if (!it) return <p className="a-help">Yükleniyor…</p>;
  const info = s.integrationsInfo;
  const envNote = (has: unknown, shown?: string | null) => (has ? `Boş bırakırsanız Vercel'deki değer kullanılır${shown ? `: ${shown}` : " (tanımlı ✅)"}.` : "Vercel'de tanımlı değil; buraya yazmanız yeterli.");
  return (
    <>
      <h1>Entegrasyonlar</h1>
      <p className="a-intro">Meta (Facebook) pikseli, Conversions API anahtarı, hangi olayın hangi adla gönderileceği ve bazı bağlantılar. Buraya yazdığınız değer Vercel'deki değerin ÖNÜNE geçer; kaydettikten ~30 saniye sonra geçerli olur, yeniden yayınlamaya gerek yoktur (site tarafındaki piksel en geç 2 dakikada güncellenir).</p>

      <Card title="Meta Pixel ve Conversions API" right={<Btn kind="ghost" small disabled={dirty} onClick={() => run("test", async () => { const r = await api("meta_test"); notify(r.ok ? `✅ Meta bağlantısı çalışıyor.\n${r.detail}` : `Meta reddetti:\n${r.detail}`, !r.ok); })} busy={tBusy === "test"}>Bağlantıyı test et</Btn>}>
        {dirty && <p className="a-help" style={{ marginBottom: 8 }}>Test etmeden önce kaydedin.</p>}
        <div className="a-grid2">
          <Field label="Pixel (Dataset) ID" help={<>Events Manager → Veri kaynakları → pikseliniz → Ayarlar. {envNote(info.env.pixel)}</>}><Txt value={it.metaPixelId} onChange={(v) => upd(["metaPixelId"], v.trim())} placeholder="1234567890123456" /></Field>
          <Field label="Conversions API erişim anahtarı (token)" help={<>Aynı sayfada “Conversions API → Erişim anahtarı oluştur”. Güvenlik için kayıtlı anahtar asla geri gösterilmez. {info.tokenInPanel ? <b>Panelde kayıtlı: {info.tokenInPanel}</b> : envNote(info.env.token)}</>}>
            <input type="password" autoComplete="off" value={it.metaAccessToken === "__CLEAR__" ? "" : it.metaAccessToken} placeholder={info.tokenInPanel ? "Değiştirmek için yenisini yapıştırın" : "EAAB…"} onChange={(e) => upd(["metaAccessToken"], e.target.value.trim())} />
            {info.tokenInPanel && <div style={{ marginTop: 6 }}><Btn small kind="danger" onClick={() => upd(["metaAccessToken"], "__CLEAR__")}>{it.metaAccessToken === "__CLEAR__" ? "Kaydedince silinecek" : "Paneldeki anahtarı sil"}</Btn></div>}
          </Field>
        </div>
        <Field label="Test modu kodu" help={<>Events Manager → Test olayları sekmesindeki kod (ör. TEST12345). Doluyken olaylar YALNIZCA test sekmesinde görünür ve reklam optimizasyonunda kullanılmaz. <b>Gerçek reklamdan önce boşaltın.</b> {info.env.testCode ? `Vercel'de de bir kod tanımlı (${info.env.testCode}); burayı kaydettiğinizde paneldeki değer (boş dahil) geçerli olur.` : ""}</>}>
          <Txt value={it.metaTestEventCode} onChange={(v) => upd(["metaTestEventCode"], v.trim())} placeholder="Boş = test modu kapalı" />
        </Field>
        {it.metaTestEventCode && <div className="a-warn">Test modu AÇIK: Meta bu olayları reklamlarınız için kullanmıyor.</div>}
      </Card>

      <Card title="Meta'ya gönderilen olaylar" desc="Her adım için olayı açıp kapatabilir veya adını değiştirebilirsiniz. Listeden standart bir olay seçin ya da kendi adınızı yazın (özel olay). Olayın “nerede gerçekleştiği” bilgisi (site / sohbet) Meta kuralları gereği doğru kalmalıdır, bu yüzden değiştirilemez.">
        <datalist id="meta-events">{STANDARD_EVENTS.map((e) => <option key={e} value={e} />)}</datalist>
        <div className="a-scroll">
          <table className="a-table" style={{ minWidth: 720 }}>
            <thead><tr><th>Ne olduğunda?</th><th style={{ width: 230 }}>Meta olay adı</th><th>Açık</th><th>Nasıl gider?</th></tr></thead>
            <tbody>
              {EVENT_TR.map(([k, label, how]) => (
                <tr key={k}>
                  <td>{label}<br /><span className="a-help">kaynak: {info.actionSources[k] === "website" ? "site" : "sohbet"} · ilk ayar: {info.eventDefaults[k].name}</span></td>
                  <td><input list="meta-events" value={it.events[k].name} onChange={(e) => upd(["events", k, "name"], e.target.value.trim())} /></td>
                  <td><input type="checkbox" style={{ width: 22, height: 22 }} checked={it.events[k].enabled} onChange={(e) => upd(["events", k, "enabled"], e.target.checked)} /></td>
                  <td className="a-help">{how}{!STANDARD_EVENTS.includes(it.events[k].name) ? " · özel olay" : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <label className="a-row" style={{ marginTop: 12 }}><input type="checkbox" style={{ width: 20 }} checked={it.sendRenewalsAsPurchase} onChange={(e) => upd(["sendRenewalsAsPurchase"], e.target.checked)} /> Abonelik YENİLEMELERİNİ de “Purchase” olarak gönder (kapalıyken yalnızca ilk satın alma gönderilir — reklam optimizasyonu için önerilen budur)</label>
      </Card>

      <Card title="Bağlantılar ve destek">
        <div className="a-grid2">
          <Field label="Destek kullanıcı adı" help={<>Müşteri insan istediğinde verilen Telegram hesabı. {envNote(info.env.support, info.env.support)}</>}><Txt value={it.supportUsername} onChange={(v) => upd(["supportUsername"], v.trim())} placeholder="@tahmin10_destek" /></Field>
          <div />
          <Field label="Ücretsiz kanal davet linki" help={envNote(info.env.freeUrl, info.env.freeUrl)}><Txt value={it.freeChannelUrl} onChange={(v) => upd(["freeChannelUrl"], v.trim())} placeholder="https://t.me/+…" /></Field>
          <Field label="VIP kanal yedek linki" help={<>Normalde bot her alıcıya tek kullanımlık link üretir; bu yalnızca o başarısız olursa kullanılır. {envNote(info.env.vipUrl, info.env.vipUrl)}</>}><Txt value={it.vipChannelUrl} onChange={(v) => upd(["vipChannelUrl"], v.trim())} placeholder="https://t.me/+…" /></Field>
        </div>
        <p className="a-help">Kanal ID'leri (üyelik doğrulama için) Vercel'de kalır: TELEGRAM_FREE_CHANNEL_ID, TELEGRAM_VIP_CHANNEL_ID.</p>
      </Card>

      <Card title="Yapay zekâ modeli">
        <datalist id="ds-models"><option value="deepseek-flash" /><option value="deepseek-v4-pro" /></datalist>
        <div className="a-grid2">
          <Field label="Sohbet modeli" help={`Boş = Vercel'deki değer (${info.env.model}). Müşteriyle konuşan model; hız önemlidir.`}><input list="ds-models" value={it.deepseekModel} onChange={(e) => upd(["deepseekModel"], e.target.value.trim())} placeholder={info.env.model} /></Field>
          <Field label="Koç modeli" help={`Boş = ${info.env.coachModel ?? "sohbet modeliyle aynı"}. Günde bir kez çalışır; daha güçlü bir model seçebilirsiniz.`}><input list="ds-models" value={it.deepseekCoachModel} onChange={(e) => upd(["deepseekCoachModel"], e.target.value.trim())} /></Field>
        </div>
      </Card>

      <div className="a-info">🔐 Şunlar bilerek Vercel'de kalır, çünkü uygulama veritabanına ulaşmadan ÖNCE bunlara ihtiyaç duyar veya sızarsa para kaybına yol açar: Telegram bot token'ı, Supabase anahtarı, DeepSeek API anahtarı, Whop API anahtarı ve webhook gizli anahtarı, Whop plan ID'leri, panel şifresi.</div>
      <SaveBar onSave={save} onReset={reset} busy={busy} dirty={dirty} />
    </>
  );
}

/* =====================================================================
 *  VERİ YÖNETİMİ  (toplu silme)
 * ===================================================================== */
const BULK: [string, string, string, number][] = [
  ["never_started", "Botu hiç başlatmayan ziyaretçiler", "Sitede düğmeye basıp Telegram'da /start demeyenler. Silinirse “sitede butona basan” sayısı geçmiş dönemler için azalır.", 60],
  ["lost", "Kaybedilen kişiler (tamamen)", "Satın almamış ve “kaybedildi” olarak kapanmış kişiler; konuşmaları, profilleri ve analizleriyle birlikte. Huni sayıları geçmiş için azalır.", 90],
  ["messages", "Konuşma metinleri", "Analiz edilmiş olsun olmasın, bu süreden eski TÜM mesaj metinleri. (Otomatik temizlik yalnızca analizi bitenleri siler.)", 30],
  ["logs", "Teknik kayıtlar", "Olay kayıtları (itirazlar dahil), Whop / Telegram ham kayıtları, eski ödeme bağlantıları.", 30],
  ["tickets", "Kapanmış destek talepleri", "Açık olanlara dokunulmaz.", 30],
  ["analyses", "Koçun zaten kullandığı konuşma analizleri", "Koç bunlardan öğrenip rehbere işlediği için silinmeleri öğrenmeyi bozmaz; yalnızca geçmiş listesi kısalır.", 90],
];

function DataAdmin() {
  const [d, setD] = useState<Any>(null);
  const [days, setDays] = useState<Record<string, number>>(Object.fromEntries(BULK.map(([k, , , n]) => [k, n])));
  const [busy, run] = useBusy();
  const load = useCallback(() => run("load", async () => setD(await api("system"))), [run]);
  useEffect(() => { load(); }, [load]);
  return (
    <>
      <h1>Veri Yönetimi</h1>
      <p className="a-intro">Veritabanından istediğinizi silin. <b>Tek bir kişiyi, tek bir mesajı veya bir kişinin tüm konuşmasını</b> silmek için “Konuşmalar” sekmesinde kişiyi açın (en altta “Silme işlemleri”). Destek talepleri ve ekran görüntüleri için “Destek Talepleri”, öğrenme kayıtları için “Öğrenme” sekmesini kullanın. Buradaki işlemler TOPLU siler ve geri alınamaz.</p>
      <Card title="Kullanım">
        {d?.usage ? (
          <>
            <p><b>{(d.usage.bytes / 1048576).toFixed(1)} MB</b> / 500 MB (ücretsiz Supabase)</p>
            <div className="a-bar" style={{ margin: "8px 0 12px" }}><i style={{ width: `${Math.min(100, (d.usage.bytes / (500 * 1048576)) * 100)}%` }} /></div>
            {d.usage.tables.map((t: Any) => <p key={t.name} className="a-help">{t.name}: {(t.bytes / 1048576).toFixed(2)} MB · ~{t.rows} satır</p>)}
          </>
        ) : <p className="a-help">{d ? "Ölçülemedi: Supabase'de support_and_cleanup.sql dosyasını çalıştırın." : "Yükleniyor…"}</p>}
        <div style={{ marginTop: 10 }}><Btn kind="ghost" onClick={() => run("purge", async () => { const r = await api("purge_now"); notify(`Otomatik temizlik çalıştı — mesaj: ${r.purged.messages} · kayıt: ${r.purged.events} · webhook: ${r.purged.webhooks}`); await load(); })} busy={busy === "purge"}>Otomatik temizliği şimdi çalıştır (güvenli)</Btn></div>
      </Card>
      {BULK.map(([k, title, desc]) => (
        <Card key={k} title={title} desc={desc}>
          <div className="a-row">
            <span>Şu kadar günden eski olanları sil:</span>
            <div style={{ width: 100 }}><Num value={days[k] ?? 30} min={0} max={3650} onChange={(v) => setDays({ ...days, [k]: v })} /></div>
            <Btn kind="danger" onClick={() => window.confirm(`“${title}” — ${days[k]} günden eski kayıtlar KALICI olarak silinsin mi?${days[k] === 0 ? "\n\nDİKKAT: 0 gün = HEPSİ." : ""}`) && run(k, async () => { const r = await api("bulk_delete", { kind: k, days: days[k] }); notify(`Silindi: ${Object.entries(r.deleted).map(([t, n]) => `${t} ${n}`).join(" · ")}`); await load(); })} busy={busy === k}>Sil</Btn>
          </div>
        </Card>
      ))}
      <div className="a-info">Kalıcı olanlar: ödemeler (muhasebe kaydı; kişi silinince anonimleştirilir), onayladığınız satış rehberleri, bot bilgisi ve tüm ayarlarınız. Bunları tek tek ilgili sekmelerden silebilirsiniz.</div>
    </>
  );
}

/* =====================================================================
 *  ANALİZ  (reklam harcaması → CAC / ROAS, huni, gelir, elde tutma, yapay zekâ yorumu)
 * ===================================================================== */
const LOSS_TR: Record<string, string> = { NO_RESPONSE: "Hiç cevap vermedi", NOT_INTERESTED: "İlgilenmedi", PRICE: "Fiyat", TRUST: "Güvenmedi", VALUE_UNCLEAR: "Değeri anlamadı", TIMING: "Zamanı değil", CONFUSION: "Kafası karıştı", COULD_NOT_JOIN: "Kanala giremedi", CHECKOUT_ABANDONED: "Ödemeyi yarıda bıraktı", NOT_TARGET_AUDIENCE: "Hedef kitle değil", RISK_FLAG: "Yaş / risk işareti", OTHER: "Diğer" };
const SEGMENT_TR: Record<string, string> = { frequent_bettor: "Sık oynayan", casual_fan: "Sıradan taraftar", analysis_seeker: "Analiz arayan", price_sensitive: "Fiyata duyarlı", vip_curious: "VIP meraklısı", free_only: "Yalnızca ücretsiz" };
const C = { green: "#0b7a3b", blue: "#1f6fd1", amber: "#e09b00", red: "#c0392b", purple: "#7a4fd1", grey: "#9aa9a0" };
const n0 = (v: unknown) => Number(v ?? 0);
const tl = (v: number | null | undefined, digits = 2) => (v === null || v === undefined ? "–" : `₺${v.toLocaleString("tr-TR", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`);
const shortDay = (d: string) => `${d.slice(8, 10)}.${d.slice(5, 7)}`;
const isoDay = (offset: number) => new Date(Date.now() - offset * 86_400_000).toISOString().slice(0, 10);

function Delta({ now, prev, lowerIsBetter }: { now: number | null; prev: number | null; lowerIsBetter?: boolean }) {
  if (now === null || prev === null || !prev) return null;
  const change = ((now - prev) / Math.abs(prev)) * 100;
  if (!Number.isFinite(change) || Math.abs(change) < 0.5) return <Pill>≈ aynı</Pill>;
  const good = lowerIsBetter ? change < 0 : change > 0;
  return <Pill tone={good ? "green" : "red"}>{change > 0 ? "▲" : "▼"} %{Math.abs(change).toFixed(0)}</Pill>;
}
function Kpi({ label, value, sub, now, prev, lowerIsBetter }: { label: string; value: ReactNode; sub?: ReactNode; now?: number | null; prev?: number | null; lowerIsBetter?: boolean }) {
  return (
    <div className="a-stat">
      <span>{label}</span>
      <b style={{ fontSize: 23, margin: "4px 0" }}>{value}</b>
      <div className="a-row" style={{ gap: 6 }}>{now !== undefined && <Delta now={now ?? null} prev={prev ?? null} lowerIsBetter={lowerIsBetter} />}{sub && <span style={{ fontSize: 12.5 }}>{sub}</span>}</div>
    </div>
  );
}

function Legend({ items }: { items: { name: string; color: string }[] }) {
  return <div className="a-row" style={{ gap: 14, marginBottom: 6, fontSize: 13 }}>{items.map((i) => <span key={i.name}><i style={{ display: "inline-block", width: 10, height: 10, borderRadius: 3, background: i.color, marginRight: 5 }} />{i.name}</span>)}</div>;
}
function LineChart({ labels, series, money: isMoney }: { labels: string[]; series: { name: string; color: string; values: number[] }[]; money?: boolean }) {
  const W = 640, H = 210, L = 44, R = 8, T = 8, B = 24;
  const max = Math.max(1, ...series.flatMap((s) => s.values));
  const x = (i: number) => L + (labels.length <= 1 ? (W - L - R) / 2 : (i / (labels.length - 1)) * (W - L - R));
  const y = (v: number) => T + (1 - v / max) * (H - T - B);
  const ticks = [0, 0.5, 1].map((t) => Math.round(max * t));
  const step = Math.max(1, Math.ceil(labels.length / 7));
  return (
    <div>
      <Legend items={series} />
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", display: "block" }} role="img">
        {ticks.map((t) => <g key={t}><line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke="#e6ebe8" /><text x={L - 6} y={y(t) + 4} textAnchor="end" fontSize="11" fill="#7a8a81">{isMoney ? t.toLocaleString("tr-TR") : t}</text></g>)}
        {labels.map((l, i) => (i % step === 0 || i === labels.length - 1) && <text key={i} x={x(i)} y={H - 6} textAnchor="middle" fontSize="11" fill="#7a8a81">{l}</text>)}
        {series.map((s) => (
          <g key={s.name}>
            <polyline fill="none" stroke={s.color} strokeWidth="2.2" strokeLinejoin="round" points={s.values.map((v, i) => `${x(i)},${y(v)}`).join(" ")} />
            {s.values.map((v, i) => <circle key={i} cx={x(i)} cy={y(v)} r={labels.length > 40 ? 1.6 : 3} fill={s.color}><title>{`${labels[i]} · ${s.name}: ${isMoney ? tl(v) : v}`}</title></circle>)}
          </g>
        ))}
      </svg>
    </div>
  );
}
function Columns({ labels, stacks, line }: { labels: string[]; stacks: { name: string; color: string; values: number[] }[]; line?: { name: string; color: string; values: number[] } }) {
  const W = 640, H = 220, L = 50, R = 8, T = 8, B = 24;
  const totals = labels.map((_, i) => stacks.reduce((t, s) => t + (s.values[i] ?? 0), 0));
  const max = Math.max(1, ...totals, ...(line?.values ?? []));
  const band = (W - L - R) / Math.max(1, labels.length);
  const y = (v: number) => T + (1 - v / max) * (H - T - B);
  return (
    <div>
      <Legend items={[...stacks, ...(line ? [line] : [])]} />
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", display: "block" }} role="img">
        {[0, 0.5, 1].map((t) => <g key={t}><line x1={L} x2={W - R} y1={y(max * t)} y2={y(max * t)} stroke="#e6ebe8" /><text x={L - 6} y={y(max * t) + 4} textAnchor="end" fontSize="11" fill="#7a8a81">{Math.round(max * t).toLocaleString("tr-TR")}</text></g>)}
        {labels.map((l, i) => {
          let base = 0;
          return (
            <g key={i}>
              {stacks.map((s) => { const v = s.values[i] ?? 0; const top = y(base + v); const h = y(base) - top; base += v; return <rect key={s.name} x={L + i * band + band * 0.18} width={band * 0.64} y={top} height={Math.max(0, h)} fill={s.color} rx="2"><title>{`${l} · ${s.name}: ${tl(v)}`}</title></rect>; })}
              <text x={L + i * band + band / 2} y={H - 6} textAnchor="middle" fontSize="11" fill="#7a8a81">{l}</text>
            </g>
          );
        })}
        {line && <polyline fill="none" stroke={line.color} strokeWidth="2.2" strokeDasharray="5 4" points={line.values.map((v, i) => `${L + i * band + band / 2},${y(v)}`).join(" ")} />}
      </svg>
    </div>
  );
}
function HBars({ items, color, unit }: { items: { label: string; value: number; note?: string }[]; color?: string; unit?: string }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  if (!items.length) return <p className="a-help">Henüz veri yok.</p>;
  return (
    <div>
      {items.map((i) => (
        <div key={i.label} style={{ display: "grid", gridTemplateColumns: "minmax(110px, 36%) 1fr 90px", gap: 10, alignItems: "center", padding: "4px 0", fontSize: 14 }}>
          <span>{i.label}</span>
          <div className="a-bar"><i style={{ width: `${(i.value / max) * 100}%`, background: color ?? C.green }} /></div>
          <span><b>{i.value}</b>{unit ?? ""} {i.note && <span className="a-help">{i.note}</span>}</span>
        </div>
      ))}
    </div>
  );
}

function AiResult({ entry }: { entry: Any }) {
  const r = entry?.result ?? {};
  const tone = r.saglik === "iyi" ? "green" : r.saglik === "zayıf" ? "red" : "amber";
  const Listing = ({ title, items }: { title: string; items?: string[] }) => (items?.length ? <div style={{ marginTop: 10 }}><h3>{title}</h3>{items.map((x, i) => <p key={i} style={{ fontSize: 14, marginTop: 4 }}>• {x}</p>)}</div> : null);
  return (
    <div>
      <p className="a-help">{when(entry.at)} · dönem {entry.period?.from} → {entry.period?.to}</p>
      <p style={{ margin: "8px 0" }}>{r.saglik && <Pill tone={tone as Any}>Genel durum: {String(r.saglik).replace("_", " ")}</Pill>} {r.ozet}</p>
      {r.en_buyuk_kayip && <div className="a-warn"><b>En büyük kayıp:</b> {r.en_buyuk_kayip}</div>}
      {(r.oneriler ?? []).map((o: Any, i: number) => (
        <div key={i} style={{ border: "1px solid #e1e8e4", borderRadius: 12, padding: 12, marginBottom: 10 }}>
          <h3>{o.oncelik ?? i + 1}. {o.baslik} {o.zorluk && <Pill>{o.zorluk}</Pill>}</h3>
          {o.neden && <p style={{ fontSize: 14, marginTop: 6 }}><b>Neden:</b> {o.neden}</p>}
          {o.nasil && <p style={{ fontSize: 14, marginTop: 4 }}><b>Nasıl:</b> {o.nasil}</p>}
          {o.beklenen_etki && <p style={{ fontSize: 14, marginTop: 4 }}><b>Beklenen etki:</b> {o.beklenen_etki}</p>}
        </div>
      ))}
      <div className="a-grid2"><Listing title="İyi gidenler" items={r.iyi_gidenler} /><Listing title="Sorunlar" items={r.sorunlar} /></div>
      <div className="a-grid2"><Listing title="Gelecek hafta izleyin" items={r.izlenecek_sayilar} /><Listing title="Eksik veri" items={r.eksik_veri} /></div>
    </div>
  );
}

function Analytics() {
  const [range, setRange] = useState({ from: isoDay(29), to: isoDay(0) });
  const [d, setD] = useState<Any>(null);
  const [sp, setSp] = useState<Any>({ from: isoDay(6), to: isoDay(0), campaign: "", amount: "", note: "" });
  const [ai, setAi] = useState<Any>(null);
  const [busy, run] = useBusy();
  const load = useCallback(() => run("load", async () => { const r = await api("analytics", range); setD(r); setAi((cur: Any) => cur ?? r.aiHistory?.[0] ?? null); }), [range, run]);
  useEffect(() => { load(); }, [load]);
  const preset = (label: string, from: string, to = isoDay(0)) => <Btn key={label} small kind={range.from === from && range.to === to ? undefined : "soft"} onClick={() => setRange({ from, to })}>{label}</Btn>;
  const now = new Date();
  const monthStart = (offset: number) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - offset, 1)).toISOString().slice(0, 10);
  const lastMonthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0)).toISOString().slice(0, 10);

  if (!d) return <p className="a-help">Yükleniyor…</p>;
  const t = d.totals, p = d.previous, u = d.unit, up = d.unitPrevious, sub = d.subscriptions, x = d.extra ?? {};
  const labels = d.series.map((s: Any) => shortDay(s.day));
  const pick = (k: string) => d.series.map((s: Any) => n0(s[k]));
  const funnel = [["Sitede düğmeye basan", t.clicks], ["Botu başlatan (Lead)", t.started], ["Bota cevap yazan", t.replied], ["Ücretsiz kanala giren (Kayıt)", t.joined_free], ["VIP planlarını gören", t.saw_plans], ["Ödeme sayfasını açan", t.checkouts], ["Satın alan", t.customers]] as [string, number][];
  const heat = (v: number | null) => (v === null ? "#fafcfb" : `rgba(11,122,59,${0.08 + (v / 100) * 0.72})`);

  return (
    <>
      <h1>Analiz</h1>
      <p className="a-intro">İşinizin bütün sayıları tek yerde. Reklam harcamanızı yazın; müşteri edinme maliyeti (CAC), reklam getirisi (ROAS) ve diğerleri kendiliğinden hesaplanır. Bu sayılar küçük bir günlük özet tablosunda ve ödeme kayıtlarında tutulur: <b>mesajları, kayıtları, hatta kişileri silseniz bile geçmiş burada kalır</b> ve neredeyse hiç yer kaplamaz. Tarihler Türkiye saatine göredir.</p>
      {d.sqlMissing && <div className="a-warn">Analiz tabloları bulunamadı. Supabase → SQL Editor'de <b>supabase/analytics.sql</b> dosyasını bir kez çalıştırın, sonra bu sayfayı yenileyin.</div>}

      <div className="a-row" style={{ marginBottom: 14 }}>
        {preset("Son 7 gün", isoDay(6))}{preset("Son 30 gün", isoDay(29))}{preset("Son 90 gün", isoDay(89))}{preset("Bu ay", monthStart(0))}{preset("Geçen ay", monthStart(1), lastMonthEnd)}{d.firstDay && preset("Tümü", d.firstDay)}
        <input type="date" style={{ width: 150 }} value={range.from} max={range.to} onChange={(e) => e.target.value && setRange({ ...range, from: e.target.value })} />
        <input type="date" style={{ width: 150 }} value={range.to} min={range.from} onChange={(e) => e.target.value && setRange({ ...range, to: e.target.value })} />
        {busy === "load" && <span className="a-help">Yükleniyor…</span>}
      </div>
      <p className="a-help" style={{ marginBottom: 10 }}>Oklar bir önceki eş uzunluktaki dönemle ({d.period.previousFrom} → {d.period.previousTo}) karşılaştırır.</p>

      <div className="a-stats">
        <Kpi label="Reklam harcaması" value={tl(t.spend)} now={t.spend} prev={p.spend} sub={t.spend ? undefined : "aşağıdan girin"} />
        <Kpi label="Kasaya giren gelir" value={tl(t.cash)} now={t.cash} prev={p.cash} sub="bu dönemdeki ödemeler" />
        <Kpi label="ROAS (reklam getirisi)" value={u.roasCash === null ? "–" : `${u.roasCash}x`} now={u.roasCash} prev={up.roasCash} sub="1 ₺ harcama → kaç ₺ gelir" />
        <Kpi label="CAC (müşteri başına maliyet)" value={tl(u.cac)} now={u.cac} prev={up.cac} lowerIsBetter sub={`${t.customers} yeni müşteri`} />
        <Kpi label="Lead (botu başlatan)" value={t.started} now={t.started} prev={p.started} sub={`lead başına ${tl(u.costPerLead)}`} />
        <Kpi label="Kayıt (kanala giren)" value={t.joined_free} now={t.joined_free} prev={p.joined_free} sub={`kayıt başına ${tl(u.costPerRegistration)}`} />
        <Kpi label="Lead → müşteri" value={u.leadToCustomer === null ? "–" : `%${u.leadToCustomer}`} now={u.leadToCustomer} prev={up.leadToCustomer} sub="botu başlatanların yüzde kaçı aldı" />
        <Kpi label="Müşteri başına gelir" value={tl(u.revenuePerCustomer)} now={u.revenuePerCustomer} prev={up.revenuePerCustomer} sub="bu dönemde gelenlerin bugüne dek ödediği" />
        <Kpi label="Aktif abone" value={sub.activeNow} sub={`toplam ${sub.customersEver} müşteri oldu`} />
        <Kpi label="Aylık yinelenen gelir (tahmini)" value={tl(sub.mrr)} sub="aktif abonelerin aylık karşılığı" />
        <Kpi label="Yaşam boyu değer (LTV)" value={tl(sub.ltv)} sub={sub.avgLifetimeMonths ? `ortalama ${sub.avgLifetimeMonths} ay kalıyor` : undefined} />
        <Kpi label="İade oranı" value={sub.refundRate === null ? "–" : `%${sub.refundRate}`} sub="ödemelerin yüzde kaçı iade edildi" />
      </div>
      {u.cac !== null && sub.ltv !== null && <div className={u.cac < sub.ltv ? "a-info" : "a-warn"}>{u.cac < sub.ltv ? `✅ Bir müşteri size ortalama ${tl(sub.ltv)} kazandırıyor, edinmesi ${tl(u.cac)} tutuyor: reklam kârlı görünüyor (LTV / CAC = ${(sub.ltv / u.cac).toFixed(1)}).` : `⚠️ Bir müşteriyi edinmek (${tl(u.cac)}) şu an size kazandırdığından (${tl(sub.ltv)}) pahalı. Yeni abonelerin yenilemeleri LTV'yi zamanla yükseltir; yine de huniye ve reklam maliyetine bakın.`} Müşteri sayısı azken bu oran hızla değişir.</div>}

      <Card title="Reklam harcaması girin" desc="Meta Ads Manager'da gördüğünüz tutarı ₺ olarak yazın. Bir tarih aralığı seçerseniz tutar günlere eşit bölünür. Kampanya seçerseniz o kampanyanın CAC'ı ayrıca hesaplanır (reklam linkinizdeki utm_campaign ile aynı ad olmalı).">
        <div className="a-row" style={{ alignItems: "flex-end" }}>
          <div style={{ width: 150 }}><Field label="Başlangıç"><input type="date" value={sp.from} onChange={(e) => setSp({ ...sp, from: e.target.value })} /></Field></div>
          <div style={{ width: 150 }}><Field label="Bitiş"><input type="date" value={sp.to} min={sp.from} onChange={(e) => setSp({ ...sp, to: e.target.value })} /></Field></div>
          <div style={{ width: 220 }}><Field label="Kampanya"><input list="camp-names" value={sp.campaign} placeholder="Boş = genel" onChange={(e) => setSp({ ...sp, campaign: e.target.value })} /><datalist id="camp-names">{d.campaignNames.map((c: string) => <option key={c} value={c} />)}</datalist></Field></div>
          <div style={{ width: 140 }}><Field label="Tutar (₺)"><input type="number" inputMode="decimal" min={0} step="0.01" value={sp.amount} onChange={(e) => setSp({ ...sp, amount: e.target.value })} /></Field></div>
          <div style={{ flex: 1, minWidth: 140 }}><Field label="Not"><Txt value={sp.note} onChange={(v) => setSp({ ...sp, note: v })} /></Field></div>
          <div className="a-field"><Btn disabled={!sp.amount || !sp.from || !sp.to} busy={busy === "spend"} onClick={() => run("spend", async () => { await api("spend_save", { ...sp, amount: Number(sp.amount) }); setSp({ ...sp, amount: "", note: "" }); await load(); }, "Harcama kaydedildi.")}>Kaydet</Btn></div>
        </div>
        {d.spendEntries.length > 0 && (
          <div className="a-scroll"><table className="a-table"><thead><tr><th>Dönem</th><th>Kampanya</th><th>Tutar</th><th>Not</th><th /></tr></thead><tbody>
            {d.spendEntries.map((e: Any) => <tr key={e.batch}><td>{e.from === e.to ? e.from : `${e.from} → ${e.to}`}</td><td>{e.campaign || "Genel"}</td><td>{tl(e.amount)}</td><td className="a-help">{e.note}</td><td><Btn small kind="danger" onClick={() => window.confirm("Bu harcama kaydı silinsin mi?") && run(e.batch, async () => { await api("spend_delete", { batch: e.batch }); await load(); })}>Sil</Btn></td></tr>)}
          </tbody></table></div>
        )}
      </Card>

      <Card title="🤖 Yapay zekâ yorumu" desc="Bu sayfadaki bütün sayıları yapay zekâya gönderir; o da en büyük kaybı bulur ve öncelik sırasıyla ne yapmanız gerektiğini söyler. 1–2 dakika sürebilir ve küçük bir DeepSeek ücreti harcar. Veri azsa “henüz erken” der — bu doğru cevaptır." right={<Btn busy={busy === "ai"} onClick={() => run("ai", async () => setAi((await api("analytics_ai", range)).entry))}>Seçili dönemi analiz et</Btn>}>
        {busy === "ai" && <p className="a-help">Analiz ediliyor… sayfayı kapatmayın.</p>}
        {ai ? <AiResult entry={ai} /> : <p className="a-help">Henüz analiz yapılmadı.</p>}
        {(d.aiHistory ?? []).length > 1 && <div className="a-row" style={{ marginTop: 12 }}><span className="a-help">Önceki analizler:</span>{d.aiHistory.map((h: Any) => <Btn key={h.at} small kind="soft" onClick={() => setAi(h)}>{when(h.at)}</Btn>)}</div>}
      </Card>

      <div className="a-grid2">
        <Card title="Günlük akış" desc={`Her ${d.period.bucket === "week" ? "hafta" : "gün"} gelen kişi sayıları.`}>
          <LineChart labels={labels} series={[{ name: "Düğmeye basan", color: C.grey, values: pick("clicks") }, { name: "Lead", color: C.blue, values: pick("started") }, { name: "Kayıt", color: C.amber, values: pick("joined_free") }, { name: "Müşteri", color: C.green, values: pick("customers") }]} />
        </Card>
        <Card title="Harcama ve gelir" desc="Yeşil çizgi sarının üstündeyse o günler kârlıdır.">
          <LineChart money labels={labels} series={[{ name: "Harcama", color: C.amber, values: pick("spend") }, { name: "Kasaya giren", color: C.green, values: pick("cash") }]} />
        </Card>
      </div>

      <div className="a-grid2">
        <Card title="Huni (bu dönemde gelenler)" desc="Yüzde, bir önceki adımdan kaç kişinin devam ettiğini gösterir. En düşük yüzde = en büyük kayıp.">
          {funnel.map(([label, v], i) => <div className="a-funnel" style={{ gridTemplateColumns: "minmax(150px, 40%) 1fr 96px" }} key={label}><span>{label}</span><div className="a-bar"><i style={{ width: `${(v / Math.max(1, ...funnel.map((f) => f[1]))) * 100}%` }} /></div><span><b>{v}</b> {i > 0 && <span className="a-help">({pct(v, funnel[i - 1]![1])})</span>}</span></div>)}
          <p className="a-help" style={{ marginTop: 8 }}>Düğme başına {tl(u.costPerClick)} · ödeme sayfası başına {tl(u.costPerCheckout)}</p>
        </Card>
        <Card title="Plan dağılımı" desc="İlk satın almada hangi plan seçiliyor, şu an kaç aktif abone var?">
          {d.planMix.map((m: Any) => <div key={m.plan} style={{ padding: "6px 0", borderBottom: "1px dashed #e6ebe8" }}><b>{PLAN_TR[m.plan] ?? m.plan}</b> <span className="a-help">({m.name})</span><br /><span style={{ fontSize: 14 }}>{m.firstPurchases} ilk satış · {m.activeNow} aktif · toplam {tl(m.revenue)}</span></div>)}
        </Card>
      </div>

      <Card title="Aylık gelir" desc="Koyu yeşil = yeni müşteriler, açık yeşil = yenilemeler, kesikli çizgi = reklam harcaması. Yenileme payı büyüdükçe iş sağlamlaşır.">
        <Columns labels={d.monthly.map((m: Any) => m.month.slice(5) + "/" + m.month.slice(2, 4))} stacks={[{ name: "Yeni müşteri geliri", color: C.green, values: d.monthly.map((m: Any) => m.newRevenue) }, { name: "Yenileme geliri", color: "#8fd3a8", values: d.monthly.map((m: Any) => m.renewalRevenue) }]} line={{ name: "Reklam harcaması", color: C.amber, values: d.monthly.map((m: Any) => m.spend) }} />
        <div className="a-scroll"><table className="a-table" style={{ marginTop: 10 }}><thead><tr><th>Ay</th><th>Yeni müşteri</th><th>Aktif abone</th><th>Ayrılma oranı</th><th>İade</th><th>Harcama</th><th>Gelir</th></tr></thead><tbody>
          {d.monthly.slice(-6).reverse().map((m: Any) => <tr key={m.month}><td>{m.month}</td><td>{m.newCustomers}</td><td>{m.activeCustomers}</td><td>{m.churnRate === null ? "–" : `%${m.churnRate}`}</td><td>{tl(m.refunds)}</td><td>{tl(m.spend)}</td><td><b>{tl(m.newRevenue + m.renewalRevenue)}</b></td></tr>)}
        </tbody></table></div>
      </Card>

      <Card title="Elde tutma (retention)" desc="Her satır, ilk ödemesini o ay yapan müşterilerdir. Sütunlar: kaç ay sonra yüzde kaçı hâlâ abone. Haftalık plan 7, aylık 31, 3 aylık 92 gün “abone” sayılır.">
        {d.retention.length ? (
          <div className="a-scroll"><table className="a-table" style={{ minWidth: 560 }}><thead><tr><th>İlk ödeme ayı</th><th>Kişi</th>{[0, 1, 2, 3, 4, 5, 6].map((n) => <th key={n}>{n === 0 ? "İlk ay" : `+${n} ay`}</th>)}</tr></thead><tbody>
            {d.retention.map((r: Any) => <tr key={r.month}><td>{r.month}</td><td>{r.size}</td>{r.cells.map((v: number | null, i: number) => <td key={i} style={{ background: heat(v), textAlign: "center", fontWeight: 700, color: v !== null && v > 55 ? "#fff" : undefined }}>{v === null ? "" : `%${v}`}</td>)}</tr>)}
          </tbody></table></div>
        ) : <p className="a-help">İlk ödemeler geldikçe burada aylık elde tutma tablosu oluşur.</p>}
      </Card>

      <Card title="Kampanyalar" desc="Seçili dönemde gelenler. CAC ve ROAS için o kampanya adına harcama girmiş olmanız gerekir.">
        <div className="a-scroll"><table className="a-table" style={{ minWidth: 760 }}><thead><tr><th>Kampanya</th><th>Düğme</th><th>Lead</th><th>Kayıt</th><th>Müşteri</th><th>Gelir</th><th>Harcama</th><th>Lead maliyeti</th><th>CAC</th><th>ROAS</th></tr></thead><tbody>
          {d.campaigns.map((c: Any) => <tr key={c.campaign}><td>{c.campaign || "(kampanyasız / genel)"}</td><td>{c.clicks}</td><td>{c.started}</td><td>{c.joined_free}</td><td><b>{c.customers}</b></td><td>{tl(c.revenue)}</td><td>{tl(c.spend)}</td><td>{tl(c.costPerLead)}</td><td>{tl(c.cac)}</td><td>{c.roasCohort === null ? "–" : `${c.roasCohort}x`}</td></tr>)}
          {!d.campaigns.length && <tr><td colSpan={10} className="a-help">Bu dönemde veri yok.</td></tr>}
        </tbody></table></div>
      </Card>

      <Card title="En iyi müşteriler" desc="Toplam ödemeye göre ilk 15.">
        <div className="a-scroll"><table className="a-table"><thead><tr><th>Müşteri</th><th>Toplam</th><th>Ödeme sayısı</th><th>Plan</th><th>İlk → son ödeme</th><th>Kampanya</th><th>Durum</th></tr></thead><tbody>
          {d.topCustomers.map((c: Any, i: number) => <tr key={i}><td>{c.name} {c.username ? <span className="a-help">@{c.username}</span> : null}</td><td><b>{tl(c.total)}</b></td><td>{c.payments}</td><td>{PLAN_TR[c.plan] ?? "–"}</td><td className="a-help">{c.first} → {c.last}</td><td className="a-help">{c.campaign ?? "–"}</td><td>{c.active ? <Pill tone="green">Aktif</Pill> : <Pill>Bitti</Pill>}</td></tr>)}
          {!d.topCustomers.length && <tr><td colSpan={7} className="a-help">Henüz müşteri yok.</td></tr>}
        </tbody></table></div>
      </Card>

      <div className="a-grid2">
        <Card title="Satın almaya kadar geçen gün" desc="İlk gelişten ilk ödemeye. Takip mesajlarının zamanlamasını buna göre ayarlayın."><HBars color={C.blue} items={(x.days_to_buy ?? []).map((r: Any) => ({ label: r.k === 0 ? "Aynı gün" : r.k >= 30 ? "30+ gün" : `${r.k}. gün`, value: n0(r.v) }))} /></Card>
        <Card title="İnsanlar ne zaman yazıyor? (son 30 gün)" desc="Türkiye saatiyle, müşteri mesajı sayısı. Kanal paylaşımı ve takip saatleri için."><LineChart labels={Array.from({ length: 24 }, (_, h) => `${h}`)} series={[{ name: "Mesaj", color: C.purple, values: Array.from({ length: 24 }, (_, h) => n0((x.hours ?? []).find((r: Any) => r.k === h)?.v)) }]} /></Card>
        <Card title="Kişiler şu an hangi aşamada?"><HBars items={(x.stages ?? []).map((r: Any) => ({ label: STAGE_TR[r.k] ?? r.k, value: n0(r.v) }))} /></Card>
        <Card title="İlgi puanı dağılımı" desc="60 ve üzeri = bot VIP teklif edebilir."><HBars color={C.amber} items={(x.scores ?? []).map((r: Any) => ({ label: `${r.k}–${r.k + 9}`, value: n0(r.v) }))} /></Card>
        <Card title="Neden kaybediyoruz?" desc="Yapay zekânın biten konuşmalar için bulduğu ana neden."><HBars color={C.red} items={(x.loss_reasons ?? []).map((r: Any) => ({ label: LOSS_TR[r.k] ?? r.k, value: n0(r.v) }))} /></Card>
        <Card title="Konuşma hangi aşamada koptu?"><HBars color={C.red} items={(x.drop_stages ?? []).map((r: Any) => ({ label: STAGE_TR[r.k] ?? r.k, value: n0(r.v) }))} /></Card>
        <Card title="Müşteri tipleri" desc="Yapay zekânın konuşmalardan çıkardığı segment; parantez içi satın alanlar."><HBars color={C.purple} items={(x.segments ?? []).map((r: Any) => ({ label: SEGMENT_TR[r.k] ?? r.k, value: n0(r.v), note: `(${n0(r.paid)} aldı)` }))} /></Card>
        <Card title="Botun konuşma kalitesi (haftalık)" desc={`Yapay zekânın 0–100 puanı.${x.owner_rating?.n ? ` Sizin verdiğiniz ortalama: ${x.owner_rating.avg} / 5 (${x.owner_rating.n} konuşma).` : " Siz de Konuşmalar sekmesinden puan verin."}`}>
          {(x.quality_weekly ?? []).length > 1 ? <LineChart labels={(x.quality_weekly ?? []).map((r: Any) => shortDay(String(r.k)))} series={[{ name: "Kalite", color: C.green, values: (x.quality_weekly ?? []).map((r: Any) => n0(r.v)) }]} /> : <p className="a-help">En az iki haftalık analiz birikince grafik oluşur.</p>}
        </Card>
      </div>

      <Card title="Satış rehberi sürümlerinin performansı" desc="Her kişi, ilk konuştuğu andaki rehber sürümüyle sayılır. Yeni sürüm gerçekten daha mı iyi satıyor?">
        <div className="a-scroll"><table className="a-table"><thead><tr><th>Sürüm</th><th>Kişi</th><th>Cevap veren</th><th>Kanala giren</th><th>Planları gören</th><th>Ödeme sayfası</th><th>Satın alan</th><th>Oran</th></tr></thead><tbody>
          {(d.playbooks ?? []).map((r: Any) => <tr key={r.playbook_version}><td>v{r.playbook_version}</td><td>{r.leads}</td><td>{r.replied}</td><td>{r.joined_free}</td><td>{r.saw_plans}</td><td>{r.checkout}</td><td><b>{r.paid}</b></td><td>%{(n0(r.paid_rate) * 100).toFixed(1)}</td></tr>)}
          {!(d.playbooks ?? []).length && <tr><td colSpan={8} className="a-help">Henüz veri yok.</td></tr>}
        </tbody></table></div>
      </Card>
    </>
  );
}

/* =====================================================================
 *  HEDEF KİTLELER  (Meta'da yeniden hedefleme)
 * ===================================================================== */
const AUDIENCES: [string, string, string, string][] = [
  ["Siteye gelip botu başlatmayanlar", "PageView · son 30 gün", "Lead · son 30 gün", "Sayfayı gördü ama Telegram'a geçmedi. Farklı bir reklam metniyle tekrar deneyin."],
  ["Botu başlatıp ücretsiz kanala girmeyenler", "Lead · son 30 gün", "CompleteRegistration · son 30 gün", "“Ücretsiz kanala girmeyi unuttun” tarzı hatırlatma."],
  ["Ücretsiz kanalda olup VIP almayanlar", "CompleteRegistration · son 90 gün", "Purchase · son 180 gün  +  NotInterested", "En değerli yeniden hedefleme kitlesi: ürünü tanıyor, henüz almadı."],
  ["Ödeme sayfasını açıp almayanlar", "InitiateCheckout · son 14 gün", "Purchase · son 180 gün", "Küçük ama en sıcak kitle."],
  ["Müşteriler", "Purchase · son 180 gün (veya aşağıdaki dosya)", "—", "Yeni müşteri arayan reklamlardan HARİÇ tutun; ayrıca “benzer kitle (lookalike)” kaynağı olarak kullanın."],
  ["Asla hedeflenmeyecekler", "DoNotTarget · son 180 gün", "—", "Bu kitleyi TÜM reklam setlerinizde “hariç tut” olarak ekleyin: mesaj istemeyenler, reşit olmayanlar, risk işareti alanlar."],
];

function Audiences() {
  const [busy, run] = useBusy();
  const download = (segment: string) => run(segment, async () => {
    const r = await api("audience_export", { segment });
    if (!r.count) { notify("Bu listede henüz kimse yok.", true); return; }
    const url = URL.createObjectURL(new Blob([r.csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a"); a.href = url; a.download = r.filename; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    notify(`${r.count} kişi indirildi: ${r.filename}`);
  });
  return (
    <>
      <h1>Hedef Kitleler</h1>
      <p className="a-intro">Meta'da yeniden hedefleme (retargeting) için kitleler. Kısa cevap: <b>çoğu kitle için dosyaya gerek yok.</b> Bot zaten her adımı (PageView, Contact, Lead, CompleteRegistration, InitiateCheckout, Purchase…) reklam tıklama bilgisiyle birlikte Meta'ya gönderiyor; Meta bu olaylardan kitleyi kendisi kurar ve her gün kendisi günceller.</p>
      <div className="a-info"><b>E-posta konusu:</b> Telegram bize e-posta veya telefon vermez; o yüzden satın ALMAYAN kişiler için yüklenebilir bir dosya oluşturulamaz (Meta dosyada yalnızca e-posta / telefon gibi bilgileri eşleştirir; Telegram ID'si veya bizim iç kimliğimiz dosyada işe yaramaz). Satın ALANLARIN e-postası ise Whop ödemesinden gelir — onlar için aşağıdan dosya indirebilirsiniz. Fazladan bilgi sormaya gerek yok.</div>

      <Card title="1) Olaylardan otomatik kitleler (önerilen)" desc="Ads Manager → Kitleler → Kitle oluştur → Özel kitle → kaynak: Web sitesi → pikselinizi seçin → “Olaylar” listesinden seçin. Lead / CompleteRegistration / NotInterested / DoNotTarget listede görünmüyorsa kaynak olarak “Çevrimdışı etkinlik (Offline activity)” deneyin: bu olaylar sohbetten geldiği için Meta onları orada gösterebilir.">
        <div className="a-scroll"><table className="a-table" style={{ minWidth: 760 }}><thead><tr><th>Kitle</th><th>Dahil et</th><th>Hariç tut</th><th>Ne için?</th></tr></thead><tbody>
          {AUDIENCES.map(([name, inc, exc, why]) => <tr key={name}><td><b>{name}</b></td><td>{inc}</td><td>{exc}</td><td className="a-help">{why}</td></tr>)}
        </tbody></table></div>
        <p className="a-help" style={{ marginTop: 10 }}>Meta bir kitleyi reklamda kullanabilmek için genelde en az ~100 eşleşen kişi ister; başlangıçta kitleler “çok küçük” görünebilir. Olay adlarını Entegrasyonlar sekmesinde değiştirdiyseniz burada da o adları arayın. Kitlelere nötr adlar verin (ör. “T10 – kanal, VIP yok”).</p>
      </Card>

      <Card title="2) Müşteri listesi dosyaları (CSV)" desc="Ads Manager → Kitleler → Özel kitle → Müşteri listesi → dosyayı yükleyin; sütunlar otomatik tanınır (email, country, value). “value” sütunu sayesinde değer bazlı benzer kitle oluşturabilirsiniz. Meta e-postaları yüklerken kendi tarafında şifreler (hash).">
        <div className="a-row">
          <Btn onClick={() => download("customers")} busy={busy === "customers"}>Tüm müşteriler (benzer kitle + hariç tutma)</Btn>
          <Btn kind="ghost" onClick={() => download("active")} busy={busy === "active"}>Aktif aboneler (hariç tutma)</Btn>
          <Btn kind="ghost" onClick={() => download("churned")} busy={busy === "churned"}>Ayrılan müşteriler (geri kazanma)</Btn>
        </div>
        <p className="a-help" style={{ marginTop: 10 }}>“Ayrılan müşteriler” listesine mesaj istemeyenler ve satışı kapatılan kişiler ALINMAZ. Panelden tamamen sildiğiniz kişilerin e-postası da silindiği için hiçbir listede çıkmaz. Dosya Excel'de açılır; olduğu gibi yükleyin.</p>
      </Card>

      <div className="a-warn"><b>Yasal not (KVKK):</b> müşteri e-postalarını reklam için Meta'ya yüklemek kişisel veri paylaşımıdır. Gizlilik sayfanızda bunun yazması ve kişinin itiraz edebilmesi gerekir; emin değilseniz yalnızca 1. bölümdeki olay bazlı kitleleri kullanın. Ayrıca Meta, bahisle ilgili reklamlarda ek kısıtlamalar uygulayabilir; her reklam setini +18 ile sınırlayın ve “Asla hedeflenmeyecekler” kitlesini hariç tutun.</div>
    </>
  );
}

/* =====================================================================
 *  ZİYARETÇİ FİLTRESİ  (bot / ülke ayrımı → iki sayfa) + VERİ MERKEZİ SAYFASI
 * ===================================================================== */
const REASON_TR: Record<string, [string, "green" | "red" | "amber" | "blue"]> = {
  ok: ["Gerçek ziyaretçi", "green"], bot: ["Bot / tarayıcı robotu", "red"], country: ["İzinli ülke dışı", "amber"], no_country: ["Ülke bilinmiyor", "blue"],
  forced: ["Zorla güvenli sayfa", "amber"], preview: ["Önizleme (siz)", "blue"], disabled: ["Filtre kapalı", "blue"],
};
const device = (ua: string | null) => !ua ? "?" : /instagram/i.test(ua) ? "Instagram" : /fban|fbav/i.test(ua) ? "Facebook" : /iphone|ipad/i.test(ua) ? "iPhone" : /android/i.test(ua) ? "Android" : /windows/i.test(ua) ? "Windows" : /macintosh/i.test(ua) ? "Mac" : "Diğer";

function VisitorFilter() {
  const { s, draft: g, upd, save, reset, busy, dirty } = useSection("gate");
  const [v, setV] = useState<Any>(null);
  const [days, setDays] = useState(7);
  const [vb, run] = useBusy();
  const load = useCallback(() => run("load", async () => setV(await api("visits", { days }))), [days, run]);
  useEffect(() => { load(); }, [load]);
  if (!g || !s) return <p className="a-help">Yükleniyor…</p>;
  const check = (key: string, label: string, help?: string) => (
    <label className="a-row" style={{ alignItems: "flex-start", gap: 10, marginBottom: 10 }}>
      <input type="checkbox" style={{ width: 20, marginTop: 3 }} checked={Boolean(g[key])} onChange={(e) => upd([key], e.target.checked)} />
      <span><b>{label}</b>{help && <><br /><span className="a-help">{help}</span></>}</span>
    </label>
  );
  return (
    <>
      <h1>Ziyaretçi Filtresi</h1>
      <p className="a-intro">Site adresi tek (<code>/</code>), ama iki sayfa var. <b>Gerçek ziyaretçiler</b> (izin verilen ülkelerden, gerçek tarayıcıyla) Telegram düğmeli ana açılış sayfasını görür; <b>botlar, tarayıcı robotları, link önizleyiciler ve izin verilen ülkeler dışından gelenler</b> “Futbol Veri Merkezi” bilgi sayfasını görür. Karar her istekte sunucuda verilir; ziyaretçi bunu fark etmez. Bot sayfasında Telegram düğmesi ve Meta pikseli yoktur, o yüzden istatistikleriniz kirlenmez.</p>
      <div className="a-warn"><b>Bilmeniz gereken risk:</b> reklam platformlarının inceleme sistemlerine gerçek kullanıcılardan farklı bir sayfa göstermek Meta'nın kurallarında “cloaking” sayılır ve tespit edilirse reklam hesabı, Business Manager ve alan adı kalıcı olarak kapatılabilir. Meta incelemeleri her zaman bot user-agent'ıyla gelmez; gerçek tarayıcı ve yerel IP de kullanılır. Ülke filtresi (yalnızca Türkiye/Azerbaycan'a hizmet vermek) ve robot filtresi meşru kullanımlardır; kararı ve sorumluluğu siz verirsiniz.</div>

      <Card title="Kurallar" desc="Kaydettikten sonra en geç 20 saniye içinde geçerli olur.">
        {check("enabled", "Filtre açık", "Kapalıyken herkes ana sayfayı görür; ziyaretler yine kaydedilir.")}
        {check("botsToSafe", "Botlar ve tarayıcı robotları güvenli sayfayı görsün", "Googlebot, facebookexternalhit, Telegram/WhatsApp link önizleme, curl, python, headless tarayıcılar vb. Instagram/Facebook uygulama içi tarayıcı GERÇEK ziyaretçi sayılır.")}
        <Field label="İzin verilen ülkeler" help="İki harfli ülke kodları, virgülle. Boş bırakırsanız ülke kontrolü yapılmaz. Vercel'in konum başlığı kullanılır; VPN kullananlar VPN ülkesiyle görünür."><Txt value={g.allowedCountries} onChange={(v) => upd(["allowedCountries"], v.toUpperCase())} placeholder="TR,AZ" /></Field>
        <Field label="Ülke tespit edilemezse">
          <select value={g.unknownCountry} onChange={(e) => upd(["unknownCountry"], e.target.value)}>
            <option value="allow">Ana sayfayı göster</option>
            <option value="safe">Güvenli sayfayı göster</option>
          </select>
        </Field>
        <Field label="Ek bot anahtar kelimeleri" help="Virgülle. User-agent içinde geçerse bot sayılır (en az 3 harf). Aşağıdaki listede şüpheli bir tarayıcı görürseniz buraya ekleyin."><Txt value={g.extraBotKeywords} onChange={(v) => upd(["extraBotKeywords"], v)} placeholder="ör. Bilgisayar, MyMonitor" /></Field>
        {check("forceSafe", "ACİL: herkese güvenli sayfayı göster", "Ana sayfayı geçici olarak kapatır. Normalde kapalı olmalı.")}
        <SaveBar onSave={save} onReset={reset} busy={busy} dirty={dirty} />
      </Card>

      <Card title="Önizleme" desc="Bu bağlantılar yalnızca panele giriş yapmış tarayıcıda çalışır (giriş çerezi arar). Başkaları için hiçbir etkisi yoktur.">
        <div className="a-row">
          <a className="a-btn soft" style={{ textDecoration: "none" }} href="/?goruntule=ana" target="_blank" rel="noreferrer">Ana açılış sayfasını aç</a>
          <a className="a-btn soft" style={{ textDecoration: "none" }} href="/?goruntule=veri" target="_blank" rel="noreferrer">Futbol Veri Merkezi sayfasını aç</a>
        </div>
        <p className="a-help" style={{ marginTop: 8 }}>Yurt dışından test etmek için: bir VPN ile Türkiye dışına çıkıp /'yi açın — güvenli sayfayı görmelisiniz. Bot testi için terminalde <code>curl -A "Googlebot" https://ALANADINIZ/</code> (çıktıda “Futbol Veri Merkezi” geçmeli).</p>
      </Card>

      <Card title="Kim hangi sayfayı gördü?" desc="Her sayfa gösterimi kaydedilir (IP tutulmaz). 60 günden eskiler otomatik silinir." right={<div className="a-row">{[7, 30, 90].map((n) => <Btn key={n} small kind={days === n ? undefined : "soft"} onClick={() => setDays(n)}>Son {n} gün</Btn>)}<Btn small kind="soft" onClick={load} busy={vb === "load"}>Yenile</Btn></div>}>
        {!v ? <p className="a-help">Yükleniyor…</p> : v.sqlMissing ? <div className="a-warn">Ziyaret tablosu bulunamadı. Supabase → SQL Editor'de <b>supabase/visitor_filter.sql</b> dosyasını bir kez çalıştırın.</div> : (
          <>
            <div className="a-stats">
              <div className="a-stat"><span>Toplam gösterim</span><b>{v.total}</b></div>
              <div className="a-stat"><span>Ana sayfa (gerçek)</span><b style={{ color: C.green }}>{v.main}</b></div>
              <div className="a-stat"><span>Güvenli sayfa (bot / ülke dışı)</span><b style={{ color: C.red }}>{v.safe}</b></div>
              <div className="a-stat"><span>Bot payı</span><b>{v.total ? `%${Math.round(((v.byReason.find((r: Any) => r.k === "bot")?.v ?? 0) / v.total) * 100)}` : "–"}</b></div>
            </div>
            {v.truncated && <p className="a-help">Çok fazla kayıt var; yalnızca son 5000 gösterim sayıldı.</p>}
            <div className="a-grid2">
              <Card title="Günlük"><LineChart labels={v.byDay.map((d: Any) => shortDay(d.day))} series={[{ name: "Ana sayfa", color: C.green, values: v.byDay.map((d: Any) => d.main) }, { name: "Güvenli sayfa", color: C.red, values: v.byDay.map((d: Any) => d.safe) }]} /></Card>
              <Card title="Neden"><HBars items={v.byReason.map((r: Any) => ({ label: REASON_TR[r.k]?.[0] ?? r.k, value: r.v }))} /></Card>
              <Card title="Güvenli sayfayı görenlerin ülkesi" desc="Botlar da bir ülkeden gelir (çoğu ABD/İrlanda veri merkezi)."><HBars color={C.amber} items={v.safeByCountry.slice(0, 12).map((r: Any) => ({ label: r.k, value: r.v }))} /></Card>
              <Card title="Bütün ziyaretlerin ülkesi"><HBars color={C.blue} items={v.byCountry.slice(0, 12).map((r: Any) => ({ label: r.k === "?" ? "bilinmiyor" : r.k, value: r.v }))} /></Card>
            </div>
            <div className="a-scroll"><table className="a-table" style={{ minWidth: 820 }}><thead><tr><th>Zaman</th><th>Sayfa</th><th>Neden</th><th>Ülke</th><th>Cihaz</th><th>Kampanya</th><th>Tarayıcı kimliği (user-agent)</th></tr></thead><tbody>
              {v.recent.map((r: Any) => <tr key={r.id}><td className="a-help">{when(r.created_at)}</td><td>{r.page === "safe" ? <Pill tone="red">Güvenli</Pill> : <Pill tone="green">Ana</Pill>}</td><td><Pill tone={REASON_TR[r.reason]?.[1]}>{REASON_TR[r.reason]?.[0] ?? r.reason}</Pill></td><td>{r.country ?? "?"}</td><td>{device(r.ua)}</td><td className="a-help">{r.campaign ?? (r.source ?? "–")}</td><td className="a-help" title={r.ua ?? ""} style={{ maxWidth: 360, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.ua ?? "(boş)"}</td></tr>)}
              {!v.recent.length && <tr><td colSpan={7} className="a-help">Bu dönemde ziyaret yok.</td></tr>}
            </tbody></table></div>
            <div className="a-row" style={{ marginTop: 10 }}><Btn small kind="danger" onClick={() => window.confirm("Bütün ziyaret kayıtları silinsin mi? (Ayarlar etkilenmez.)") && run("clear", async () => { await api("visits_clear", { days: 0 }); await load(); }, "Ziyaret kayıtları silindi.")} busy={vb === "clear"}>Kayıtları temizle</Btn></div>
          </>
        )}
      </Card>
    </>
  );
}

const SAFE_GROUPS: FlatGroup[] = [
  { title: "Başlık ve arama motoru bilgileri", desc: "Sekme başlığı, meta açıklama ve sayfanın üst kısmı.", items: [["brand", "Site adı (üst çubuk)"], ["title", "Sekme başlığı (title)"], ["metaDescription", "Meta açıklama", "Arama sonuçlarında görünen 1–2 cümle.", 2], ["h1", "Sayfa başlığı (H1)"], ["tagline", "Başlığın altındaki cümle (isteğe bağlı)"]] },
  { title: "Öne çıkan 3 kutu (isteğe bağlı)", desc: "Kısa başlık + tek satır açıklama. Boş bırakılan kutu görünmez.", items: [["card1Title", "Kutu 1 başlık"], ["card1Text", "Kutu 1 açıklama"], ["card2Title", "Kutu 2 başlık"], ["card2Text", "Kutu 2 açıklama"], ["card3Title", "Kutu 3 başlık"], ["card3Text", "Kutu 3 açıklama"]] },
  { title: "Giriş", items: [["introTitle", "Başlık"], ["intro", "Metin", "", 5]] },
  { title: "Bölüm 1", items: [["s1Title", "Başlık"], ["s1p1", "1. paragraf", "", 5], ["s1p2", "2. paragraf (isteğe bağlı)", "", 5]] },
  { title: "Bölüm 2", items: [["s2Title", "Başlık"], ["s2p1", "1. paragraf", "", 5], ["s2p2", "2. paragraf (isteğe bağlı)", "", 4]] },
  { title: "Bölüm 3", items: [["s3Title", "Başlık"], ["s3p1", "1. paragraf", "", 5], ["s3p2", "2. paragraf (isteğe bağlı)", "", 4]] },
  { title: "Bölüm 4", items: [["s4Title", "Başlık"], ["s4p1", "1. paragraf", "", 5], ["s4p2", "2. paragraf (isteğe bağlı)", "", 4]] },
  { title: "Bölüm 5", items: [["s5Title", "Başlık"], ["s5p1", "1. paragraf", "", 5], ["s5p2", "2. paragraf (isteğe bağlı)", "", 4]] },
  { title: "İletişim ve alt bilgi", items: [["contactTitle", "Başlık"], ["contactText", "Metin (isteğe bağlı)", "", 2], ["contactEmail", "E-posta adresi (isteğe bağlı)", "Yazarsanız tıklanabilir bağlantı olur."], ["footer", "Alt bilgi", "", 2]] },
];

/* =====================================================================
 *  KANAL PAYLAŞIMLARI  (ücretsiz / VIP kanala post & anket: yaz, biçimlendir, zamanla, şablon, post bazlı satış)
 * ===================================================================== */
type PBtn = { text: string; type: "plan" | "planlar" | "bot" | "free_channel" | "support" | "url"; value?: string; style?: "primary" | "success" | "danger" | null };
type PPoll = { question: string; options: string[]; multiple: boolean; quiz: boolean; correctIndex: number; explanation: string; closeAfterMinutes: number };
type POpts = { silent: boolean; protect: boolean; pin: boolean; noPreview: boolean; previewAbove: boolean; previewLarge: boolean; mediaSpoiler: boolean; captionAbove: boolean; divider: string };
type PDraft = { id: number | null; templateId: number | null; channel: "free" | "vip"; kind: "message" | "poll"; title: string; tags: string; text: string; mediaType: "photo" | "video" | null; mediaPath: string | null; mediaUrl: string | null; withButtons: boolean; buttons: PBtn[][]; options: POpts; poll: PPoll; scheduledLocal: string };
const EMPTY_OPTS: POpts = { silent: false, protect: false, pin: false, noPreview: true, previewAbove: false, previewLarge: false, mediaSpoiler: false, captionAbove: false, divider: "" };
const EMPTY_POLL: PPoll = { question: "", options: ["", ""], multiple: false, quiz: false, correctIndex: 0, explanation: "", closeAfterMinutes: 0 };
const emptyDraft = (channel: "free" | "vip"): PDraft => ({ id: null, templateId: null, channel, kind: "message", title: "", tags: "", text: "", mediaType: null, mediaPath: null, mediaUrl: null, withButtons: false, buttons: [], options: { ...EMPTY_OPTS, protect: channel === "vip" }, poll: { ...EMPTY_POLL, options: ["", ""] }, scheduledLocal: "" });
const EMOJIS = ["⚽", "🔥", "✅", "❌", "📊", "📈", "📉", "🎯", "👑", "💰", "🏆", "⭐️", "🚀", "⏰", "📌", "🗓️", "🇹🇷", "🥇", "🥈", "🔒", "🆓", "👉", "👇", "💬", "🧠", "📣", "🎁", "⚠️", "💎", "🔑", "🏟️", "🧾", "📝", "1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "🟢", "🔴", "🟡", "🔵", "➡️", "🔔", "🙌", "💪", "🤝", "🎉", "🧤", "🥅", "🟨", "🟥", "⏱️", "📅", "🔎", "💯", "🚨", "❗", "❓", "✨"];
const DIVIDERS = ["━━━━━━━━━━━━", "──────────────", "═══════════════", "- - - - - - - - - -", "· · · · · · · · · ·", "▬▬▬▬▬▬▬▬▬▬", "⸻"];
const POST_STATUS_TR: Record<string, [string, "green" | "red" | "amber" | "blue" | undefined]> = { draft: ["Taslak", undefined], scheduled: ["Zamanlandı", "blue"], sending: ["Gönderiliyor", "amber"], sent: ["Gönderildi", "green"], failed: ["Başarısız", "red"] };
const BTN_TYPE_TR: Record<PBtn["type"], string> = { plan: "Plan (ödeme)", planlar: "Tüm planlar", bot: "Botu başlat", free_channel: "Ücretsiz kanal", support: "Destek", url: "Web adresi" };
const BTN_STYLE_TR: [PBtn["style"], string, string][] = [[null, "Varsayılan (gri)", "#e6ebe8"], ["primary", "Mavi", "#298acf"], ["success", "Yeşil", "#61c752"], ["danger", "Kırmızı", "#e05356"]];
const istanbul = (iso?: string | null) => (iso ? new Date(iso).toLocaleString("tr-TR", { timeZone: "Europe/Istanbul", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "–");
const toIso = (local: string) => (local ? new Date(`${local}:00+03:00`).toISOString() : null); // Türkiye sabit UTC+3
const toLocal = (iso?: string | null) => { if (!iso) return ""; const d = new Date(new Date(iso).getTime() + 3 * 3600_000); return d.toISOString().slice(0, 16); };

function ChannelPosts() {
  const [chan, setChan] = useState<"free" | "vip">("free");
  const [ov, setOv] = useState<Any>(null);
  const [d, setD] = useState<PDraft>(emptyDraft("free"));
  const [allow, setAllow] = useState(false);
  const [filter, setFilter] = useState<{ status: string; tag: string }>({ status: "", tag: "" });
  const [showEmoji, setShowEmoji] = useState(false);
  const [busy, run] = useBusy();
  const load = useCallback(() => run("load", async () => setOv(await api("posts_overview"))), [run]);
  useEffect(() => { load(); }, [load]);
  const up = (patch: Partial<PDraft>) => setD((x) => ({ ...x, ...patch }));
  const reset = (channel = chan) => { setD(emptyDraft(channel)); setAllow(false); };
  const switchChannel = (c: "free" | "vip") => { setChan(c); if (!d.id && !d.text && !d.mediaPath && !d.poll.question) setD(emptyDraft(c)); else up({ channel: c, options: { ...d.options, protect: c === "vip" ? true : d.options.protect } }); };

  /* --- editör yardımcıları --- */
  const ta = () => document.getElementById("post-editor") as HTMLTextAreaElement | null;
  const replaceSel = (fn: (sel: string) => string) => {
    const el = ta(); if (!el) return;
    const [a, b] = [el.selectionStart, el.selectionEnd];
    const ins = fn(el.value.slice(a, b));
    up({ text: el.value.slice(0, a) + ins + el.value.slice(b) });
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(a + ins.length, a + ins.length); });
  };
  const wrap = (open: string, close: string, placeholder = "metin") => replaceSel((s) => `${open}${s || placeholder}${close}`);
  const insert = (t: string) => replaceSel(() => t);
  const link = () => { const url = window.prompt("Bağlantı adresi (https://…)"); if (url && /^https?:\/\//.test(url)) wrap(`<a href="${url}">`, "</a>", "bağlantı yazısı"); };
  const matchBlock = () => insert("⚽ <b>Takım A – Takım B</b>\n🏆 Lig · 🕗 21:00\n📊 Market: <b>Alt/Üst 2.5</b>\n💬 Neden: kısa gerekçe\n\n");
  const resultBlock = () => insert("📋 <b>Dünkü sonuçlar</b>\n✅ Takım A – Takım B · Üst 2.5\n❌ Takım C – Takım D · KG Var\n✅ Takım E – Takım F · MS 1\n\n");
  const plansBlock = () => insert((ov?.plans ?? []).map((p: Any) => `👑 <b>${p.name}</b> — ${p.priceLabel}`).join("\n") + "\n\n");
  const visible = (() => { const el = document.createElement("div"); el.innerHTML = previewHtml(d.text, d.options.divider); return (el.textContent ?? "").length; })();
  const limit = d.mediaPath ? 1024 : 4096;

  /* --- düğmeler --- */
  const addButton = (rowIdx: number | null, b: PBtn) => setD((x) => { const rows = x.buttons.map((r) => [...r]); if (rowIdx === null || !rows[rowIdx] || rows[rowIdx]!.length >= 3) rows.push([b]); else rows[rowIdx]!.push(b); return { ...x, buttons: rows, withButtons: true }; });
  const removeButton = (r: number, i: number) => setD((x) => { const rows = x.buttons.map((row) => [...row]); rows[r]!.splice(i, 1); return { ...x, buttons: rows.filter((row) => row.length) }; });
  const moveRow = (r: number, dir: -1 | 1) => setD((x) => { const rows = [...x.buttons]; const j = r + dir; if (j < 0 || j >= rows.length) return x; [rows[r], rows[j]] = [rows[j]!, rows[r]!]; return { ...x, buttons: rows }; });
  const planPreset = () => setD((x) => ({ ...x, withButtons: true, buttons: [...x.buttons, ...(ov?.plans ?? []).map((p: Any, i: number) => [{ text: `👑 ${p.name} · ${p.priceLabel}`, type: "plan" as const, value: p.key, style: (i === 0 ? "success" : "primary") as PBtn["style"] }])] }));

  /* --- anket --- */
  const setPoll = (patch: Partial<PPoll>) => up({ poll: { ...d.poll, ...patch } });
  const setOpt = (i: number, v: string) => setPoll({ options: d.poll.options.map((o, j) => (j === i ? v : o)) });

  /* --- yükleme / kaydetme --- */
  const payload = () => ({ id: d.id ?? undefined, templateId: d.templateId, channel: d.channel, kind: d.kind, title: d.title, tags: d.tags.split(",").map((t) => t.trim()).filter(Boolean), text: d.text, mediaType: d.mediaType, mediaPath: d.mediaPath, buttons: d.withButtons ? d.buttons : [], options: d.options, poll: d.kind === "poll" ? { ...d.poll, options: d.poll.options.filter((o) => o.trim()) } : null, scheduledAt: toIso(d.scheduledLocal) });
  const upload = (file: File) => run("upload", async () => {
    if (file.size > 3_500_000) throw new Error("Dosya en fazla 3,5 MB olabilir; görseli küçültün.");
    const data = await new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = () => rej(new Error("Dosya okunamadı")); r.readAsDataURL(file); });
    const r = await api("post_media_upload", { data, mime: file.type });
    up({ mediaType: r.kind, mediaPath: r.path, mediaUrl: r.url });
  }, "Görsel yüklendi.");
  const save = (mode: "draft" | "schedule" | "send") => run(mode, async () => {
    if (mode === "send" && !window.confirm(`${d.channel === "vip" ? "VIP" : "Ücretsiz"} kanala ŞİMDİ gönderilsin mi?`)) return;
    const r = await api("post_save", { post: payload(), mode, allowClaims: allow });
    if (mode === "draft") up({ id: r.post.id }); else reset();
    await load();
  }, mode === "draft" ? "Taslak kaydedildi." : mode === "schedule" ? "Zamanlandı." : "Kanala gönderildi.");
  const saveTemplate = () => run("tpl", async () => { await api("template_save", { post: { ...payload(), id: undefined }, templateId: d.templateId, allowClaims: allow }); await load(); }, d.templateId ? "Şablon güncellendi." : "Şablon olarak kaydedildi.");
  const editLive = () => run("live", async () => { await api("post_edit_live", { id: d.id, post: payload(), allowClaims: allow }); reset(); await load(); }, "Kanaldaki mesaj güncellendi.");
  const loadInto = (p: Any, asTemplate = false) => {
    setChan(p.channel);
    setD({ id: asTemplate ? null : p.id, templateId: asTemplate ? p.id : p.template_id ?? null, channel: p.channel, kind: p.kind === "poll" ? "poll" : "message", title: asTemplate ? "" : p.title, tags: (p.tags ?? []).join(", "), text: p.text ?? "", mediaType: p.media_type, mediaPath: p.media_path, mediaUrl: p.media_path ? `${ov.mediaBase}${p.media_path}` : null, withButtons: (p.buttons ?? []).length > 0, buttons: p.buttons ?? [], options: { ...EMPTY_OPTS, ...(p.options ?? {}) }, poll: p.poll ? { ...EMPTY_POLL, ...p.poll } : { ...EMPTY_POLL, options: ["", ""] }, scheduledLocal: toLocal(p.scheduled_at) });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const act = (key: string, action: string, body: Record<string, unknown>, ok: string, confirmText?: string) => () => { if (confirmText && !window.confirm(confirmText)) return; run(key, async () => { await api(action, body); await load(); }, ok); };

  if (!ov) return <p className="a-help">Yükleniyor…</p>;
  const posts: Any[] = ov.posts.filter((p: Any) => p.channel === chan && (!filter.status || p.status === filter.status) && (!filter.tag || (p.tags ?? []).includes(filter.tag)));
  const templates: Any[] = ov.templates.filter((t: Any) => t.channel === chan);
  const allTags: string[] = [...new Set<string>(ov.posts.filter((p: Any) => p.channel === chan).flatMap((p: Any) => p.tags ?? []))].sort();
  const editingSent = Boolean(d.id && ov.posts.find((p: Any) => p.id === d.id)?.status === "sent");
  const src = ov.sources;
  const srcTotal = Object.values(src as Record<string, { n: number }>).reduce((t, x) => t + x.n, 0);
  const chanPosts: Any[] = ov.posts.filter((p: Any) => p.channel === chan);
  const sum = (k: string) => chanPosts.reduce((t: number, p: Any) => t + Number(p[k] ?? 0), 0);
  const btnColor = (s: PBtn["style"]) => BTN_STYLE_TR.find((x) => x[0] === (s ?? null))?.[2] ?? "#e6ebe8";

  return (
    <>
      <style>{`.pe-seg{display:flex;gap:6px;margin-bottom:14px}.pe-seg button{flex:1;padding:12px;border-radius:12px;border:2px solid #d5ddd8;background:#fff;font-weight:700;font-size:15px;cursor:pointer}.pe-seg button.on{border-color:#0b7a3b;background:#eaf6ee}.pe-seg button.vip.on{border-color:#b59500;background:#fff8d6}.pe-tb{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px}.pe-tb button{border:1px solid #d5ddd8;background:#fff;border-radius:8px;padding:5px 9px;font-size:13px;cursor:pointer}.pe-tb button:hover{background:#eef3ef}.pe-emoji{display:grid;grid-template-columns:repeat(12,1fr);gap:4px;margin:6px 0 10px}.pe-emoji button{font-size:20px;border:0;background:#f4f7f5;border-radius:8px;padding:6px;cursor:pointer}#post-editor{width:100%;min-height:260px;font:14px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;padding:10px;border:1px solid #d5ddd8;border-radius:10px;resize:vertical}.pe-prev{background:#e7ebe8;border-radius:14px;padding:14px;position:sticky;top:12px}.pe-bubble{background:#fff;border-radius:6px 16px 16px 16px;padding:10px 12px;font-size:15px;line-height:1.45;max-width:420px;white-space:normal;word-break:break-word}.pe-bubble img,.pe-bubble video{max-width:100%;border-radius:10px;margin-bottom:8px;display:block}.pe-bubble img.blur{filter:blur(14px)}.pe-bubble blockquote{border-left:3px solid #0b7a3b;margin:6px 0;padding:2px 8px;color:#3c4a42;background:#f3f7f4;border-radius:0 8px 8px 0}.pe-bubble blockquote.expandable::after{content:" ▾ (açılır alıntı)";color:#0b7a3b;font-size:12px}.pe-bubble code{background:#f1f4f2;padding:1px 4px;border-radius:4px}.pe-bubble pre{background:#f1f4f2;padding:8px;border-radius:8px;white-space:pre-wrap}.tg-spoiler{background:#333;color:#333;border-radius:4px}.tg-spoiler:hover{color:#fff}.pe-kb{display:grid;gap:6px;margin-top:8px;max-width:420px}.pe-kb div{display:flex;gap:6px}.pe-kb span{flex:1;text-align:center;border-radius:10px;padding:8px;font-size:14px;color:#123;border:1px solid #cfd8d2}.pe-kb span.c{color:#fff;border-color:transparent}.pe-poll{background:#fff;border-radius:6px 16px 16px 16px;padding:12px;max-width:420px}.pe-poll b{display:block;margin-bottom:6px}.pe-poll div{display:flex;gap:8px;align-items:center;padding:6px 0;border-top:1px solid #eef1ef}.pe-poll i{width:18px;height:18px;border-radius:50%;border:2px solid #9aa9a0;display:inline-block}.pe-poll i.ok{border-color:#0b7a3b;background:#0b7a3b}.pe-grid{display:grid;grid-template-columns:1.1fr .9fr;gap:18px}@media(max-width:900px){.pe-grid{grid-template-columns:1fr}.pe-prev{position:static}}`}</style>
      <h1>Kanal Paylaşımları</h1>
      <p className="a-intro">İki bölüm: <b>ücretsiz kanal</b> ve <b>VIP kanal</b>. Paylaşımı yazın, biçimlendirin (yalnızca Telegram'ın desteklediği biçimler), anket ya da bilgi yarışması oluşturun, hemen gönderin ya da zamanlayın. Düğme isteğe bağlıdır; plan düğmeleri botu açar ve satış o paylaşıma yazılır. Gönderilen paylaşımın metni ve görseli 1 saat sonra veritabanından silinir; başlık, etiket ve sayılar kalır.</p>
      {ov.sqlMissing && <div className="a-warn">Paylaşım tabloları bulunamadı. Supabase → SQL Editor'de <b>supabase/posts.sql</b> dosyasını bir kez çalıştırın.</div>}

      <div className="pe-seg">
        <button type="button" className={chan === "free" ? "on" : ""} onClick={() => switchChannel("free")}>📣 Ücretsiz kanal</button>
        <button type="button" className={`vip ${chan === "vip" ? "on" : ""}`} onClick={() => switchChannel("vip")} disabled={!ov.hasVipChannel} title={ov.hasVipChannel ? "" : "TELEGRAM_VIP_CHANNEL_ID tanımlı değil"}>👑 VIP kanal{ov.hasVipChannel ? "" : " (ID tanımsız)"}</button>
      </div>

      <div className="a-stats">
        <div className="a-stat"><span>{chan === "vip" ? "VIP" : "Ücretsiz"} kanal paylaşımı</span><b>{chanPosts.filter((p: Any) => p.status === "sent").length}</b><span>{chanPosts.filter((p: Any) => p.status === "scheduled").length} zamanlanmış · {chanPosts.filter((p: Any) => p.status === "draft").length} taslak</span></div>
        <div className="a-stat"><span>Düğmeden botu başlatan</span><b>{sum("starts")}</b><span>{sum("checkouts")} ödeme sayfası</span></div>
        <div className="a-stat"><span>Bu kanalın paylaşımlarından satış</span><b>{sum("purchases")}</b><span>{tl(sum("revenue"))}</span></div>
        <div className="a-stat"><span>Tüm satışlar: kanal / bot</span><b>{src.channel_post.n} / {src.bot_ad.n + src.bot_direct.n}</b><span>{srcTotal ? `kanal payı %${Math.round((src.channel_post.n / srcTotal) * 100)}` : "henüz satış yok"}{src.unlinked.n ? ` · ${src.unlinked.n} bağlanmamış` : ""}</span></div>
      </div>

      <Card title={d.id ? (editingSent ? `Kanaldaki paylaşımı düzenle (#${d.id})` : `Paylaşımı düzenle (#${d.id})`) : `Yeni paylaşım → ${chan === "vip" ? "👑 VIP kanal" : "📣 Ücretsiz kanal"}`} right={<div className="a-row">
        <select value={d.kind} onChange={(e) => up({ kind: e.target.value as "message" | "poll" })} disabled={editingSent}><option value="message">💬 Mesaj (metin / görsel)</option><option value="poll">📊 Anket / bilgi yarışması</option></select>
        {(d.id || d.text || d.mediaPath || d.poll.question) ? <Btn small kind="soft" onClick={() => reset()}>Temizle</Btn> : null}
      </div>}>
        <div className="pe-grid">
          <div>
            <div className="a-row" style={{ marginBottom: 8 }}>
              <div style={{ flex: 1, minWidth: 180 }}><Field label="Başlık (yalnızca sizin için)"><input value={d.title} onChange={(e) => up({ title: e.target.value })} placeholder="ör. Günün tahmini 24.09" /></Field></div>
              <div style={{ flex: 1, minWidth: 180 }}><Field label="Etiketler (virgülle)"><input value={d.tags} onChange={(e) => up({ tags: e.target.value })} placeholder="günün-tahmini, sonuç, vip-hatırlatma" list="post-tags" /><datalist id="post-tags">{allTags.map((t) => <option key={t} value={t} />)}</datalist></Field></div>
            </div>

            {d.kind === "poll" ? (
              <div>
                <Field label="Soru (en fazla 300 karakter)"><input value={d.poll.question} onChange={(e) => setPoll({ question: e.target.value })} maxLength={300} placeholder="Bu akşamki derbiyi kim kazanır?" /></Field>
                <Field label="Seçenekler (2–10, her biri en fazla 100 karakter)">
                  {d.poll.options.map((o, i) => (
                    <div key={i} className="a-row" style={{ marginBottom: 6, alignItems: "center" }}>
                      {d.poll.quiz && <input type="radio" name="correct" style={{ width: 18 }} checked={d.poll.correctIndex === i} onChange={() => setPoll({ correctIndex: i })} title="Doğru cevap" />}
                      <input style={{ flex: 1 }} value={o} onChange={(e) => setOpt(i, e.target.value)} maxLength={100} placeholder={`${i + 1}. seçenek`} />
                      {d.poll.options.length > 2 && <Btn small kind="danger" onClick={() => setPoll({ options: d.poll.options.filter((_, j) => j !== i), correctIndex: Math.min(d.poll.correctIndex, d.poll.options.length - 2) })}>✕</Btn>}
                    </div>
                  ))}
                  {d.poll.options.length < 10 && <Btn small kind="soft" onClick={() => setPoll({ options: [...d.poll.options, ""] })}>+ Seçenek</Btn>}
                </Field>
                <div className="a-row" style={{ gap: 16, marginBottom: 10 }}>
                  <label className="a-row" style={{ gap: 6, fontSize: 14 }}><input type="checkbox" style={{ width: 18 }} checked={d.poll.quiz} onChange={(e) => setPoll({ quiz: e.target.checked, multiple: false })} /> 🧠 Bilgi yarışması (doğru cevap işaretlenir)</label>
                  {!d.poll.quiz && <label className="a-row" style={{ gap: 6, fontSize: 14 }}><input type="checkbox" style={{ width: 18 }} checked={d.poll.multiple} onChange={(e) => setPoll({ multiple: e.target.checked })} /> ☑️ Birden fazla seçilebilsin</label>}
                </div>
                {d.poll.quiz && <Field label="Açıklama (doğru/yanlış cevaptan sonra gösterilir, en fazla 200 karakter, isteğe bağlı)"><input value={d.poll.explanation} onChange={(e) => setPoll({ explanation: e.target.value })} maxLength={200} /></Field>}
                <div style={{ width: 260 }}><Field label="Kaç dakika sonra kapansın? (0 = açık kalsın, en fazla 10)"><Num value={d.poll.closeAfterMinutes} min={0} max={10} onChange={(v) => setPoll({ closeAfterMinutes: Number(v) })} /></Field></div>
                <p className="a-help">Kanal anketleri her zaman anonimdir. Sonuçlar Telegram'da anketin üstünde görünür; gönderdikten sonra soru değiştirilemez, yalnızca “Anketi kapat” yapılabilir.</p>
              </div>
            ) : (
              <>
                <div className="pe-tb">
                  <button type="button" title="Kalın" onClick={() => wrap("<b>", "</b>")}><b>B</b></button>
                  <button type="button" title="Eğik" onClick={() => wrap("<i>", "</i>")}><i>I</i></button>
                  <button type="button" title="Altı çizili" onClick={() => wrap("<u>", "</u>")}><u>U</u></button>
                  <button type="button" title="Üstü çizili" onClick={() => wrap("<s>", "</s>")}><s>S</s></button>
                  <button type="button" title="Gizli metin — dokununca görünür" onClick={() => wrap("<tg-spoiler>", "</tg-spoiler>")}>👁 Gizli (spoiler)</button>
                  <button type="button" title="Sabit genişlikli yazı" onClick={() => wrap("<code>", "</code>")}>{"</>"} Kod</button>
                  <button type="button" title="Kod bloğu" onClick={() => wrap("<pre>", "</pre>", "satır 1\nsatır 2")}>▤ Blok</button>
                  <button type="button" title="Alıntı bloğu" onClick={() => wrap("<blockquote>", "</blockquote>")}>❝ Alıntı</button>
                  <button type="button" title="Uzun metin — kapalı gelir, dokununca açılır" onClick={() => wrap("<blockquote expandable>", "</blockquote>", "uzun analiz…")}>▾ Açılır alıntı</button>
                  <button type="button" title="Bağlantı" onClick={link}>🔗 Link</button>
                  <button type="button" onClick={() => insert(`${d.options.divider || DIVIDERS[0]}\n`)}>━ Çizgi</button>
                  <button type="button" onClick={() => insert("• ")}>• Madde</button>
                  <button type="button" onClick={() => insert("✅ ")}>✅</button>
                  <button type="button" onClick={() => insert("❌ ")}>❌</button>
                  <button type="button" onClick={matchBlock}>⚽ Maç bloğu</button>
                  <button type="button" onClick={resultBlock}>📋 Sonuç bloğu</button>
                  <button type="button" onClick={plansBlock}>👑 Planlar bloğu</button>
                  <button type="button" onClick={() => setShowEmoji((v) => !v)}>😀 Emoji</button>
                </div>
                {showEmoji && <div className="pe-emoji">{EMOJIS.map((e) => <button type="button" key={e} onClick={() => insert(e + " ")}>{e}</button>)}</div>}
                <textarea id="post-editor" value={d.text} onChange={(e) => up({ text: e.target.value })} placeholder={"⚽ <b>Günün ücretsiz tahmini</b>\n\nParagrafları boş satırla ayırın; “paragraf arası çizgi” seçiliyse aralarına otomatik çizgi konur."} />
                <p className="a-help" style={{ color: visible > limit ? C.red : undefined }}>{visible} / {limit} karakter{d.mediaPath ? " (görselli paylaşımda sınır 1024)" : ""} · Metni seçip düğmeye basın; etiketleri elle de yazabilirsiniz. Telegram'ın desteklemediği hiçbir biçim gönderilmez.</p>

                <div className="a-row" style={{ alignItems: "flex-end", marginBottom: 10 }}>
                  <div style={{ width: 260 }}><Field label="Paragraflar arasına otomatik çizgi"><select value={d.options.divider} onChange={(e) => up({ options: { ...d.options, divider: e.target.value } })}><option value="">Yok</option>{DIVIDERS.map((x) => <option key={x} value={x}>{x}</option>)}</select></Field></div>
                  <span className="a-help" style={{ paddingBottom: 12 }}>Boş satırla ayrılmış her bloğun arasına konur; kaydedilen metin değişmez, gönderirken eklenir.</span>
                </div>

                <Field label="Görsel / video (isteğe bağlı)" help="JPG, PNG, WebP ya da MP4, en fazla 3,5 MB. Görselli paylaşımda metin görselin altında (ya da üstünde) açıklama olarak gider.">
                  <div className="a-row">
                    <input type="file" accept="image/jpeg,image/png,image/webp,video/mp4" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} disabled={busy === "upload" || editingSent} />
                    {d.mediaPath && <Btn small kind="danger" onClick={() => up({ mediaType: null, mediaPath: null, mediaUrl: null })} disabled={editingSent}>Görseli kaldır</Btn>}
                    {busy === "upload" && <span className="a-help">Yükleniyor…</span>}
                  </div>
                  {d.mediaPath && <div className="a-row" style={{ gap: 16, marginTop: 6 }}>
                    <label className="a-row" style={{ gap: 6, fontSize: 14 }}><input type="checkbox" style={{ width: 18 }} checked={d.options.mediaSpoiler} onChange={(e) => up({ options: { ...d.options, mediaSpoiler: e.target.checked } })} /> 🫥 Görsel bulanık gelsin (dokununca açılır)</label>
                    <label className="a-row" style={{ gap: 6, fontSize: 14 }}><input type="checkbox" style={{ width: 18 }} checked={d.options.captionAbove} onChange={(e) => up({ options: { ...d.options, captionAbove: e.target.checked } })} /> ⬆️ Metin görselin üstünde</label>
                  </div>}
                </Field>
              </>
            )}

            <label className="a-row" style={{ gap: 6, fontSize: 14, marginBottom: 6 }}><input type="checkbox" style={{ width: 18 }} checked={d.withButtons} onChange={(e) => up({ withButtons: e.target.checked })} /> <b>Bu paylaşımda düğme olsun</b> <span className="a-help">(kapalıysa düğmesiz gider)</span></label>
            {d.withButtons && (
              <Field label="Düğmeler" help="Plan düğmeleri botu açar ve kişiye o planın ödeme sayfasını verir; satış bu paylaşıma yazılır. Satır başına en fazla 3 düğme, en fazla 8 satır. Renk yalnızca güncel Telegram sürümlerinde görünür; eski sürümde gri kalır.">
                {d.buttons.map((row, r) => (
                  <div key={r} className="a-row" style={{ marginBottom: 6, alignItems: "center" }}>
                    <span className="a-help" style={{ width: 22 }}>{r + 1}.</span>
                    {row.map((b, i) => <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 6, background: btnColor(b.style), color: b.style ? "#fff" : "#123", borderRadius: 8, padding: "4px 10px", fontSize: 13 }}>{b.text} <small style={{ opacity: 0.85 }}>({BTN_TYPE_TR[b.type]}{b.type === "plan" ? `: ${PLAN_TR[b.value ?? ""] ?? b.value}` : ""})</small> <button type="button" onClick={() => removeButton(r, i)} style={{ border: 0, background: "none", cursor: "pointer", color: "inherit" }}>✕</button></span>)}
                    <Btn small kind="soft" onClick={() => moveRow(r, -1)}>↑</Btn><Btn small kind="soft" onClick={() => moveRow(r, 1)}>↓</Btn>
                  </div>
                ))}
                <ButtonAdder plans={ov.plans} hasSupport={ov.hasSupport} onAdd={(b, sameRow) => addButton(sameRow && d.buttons.length ? d.buttons.length - 1 : null, b)} onPreset={planPreset} />
              </Field>
            )}

            <div className="a-row" style={{ gap: 16, marginBottom: 10, marginTop: 10 }}>
              {([["silent", "🔕 Sessiz gönder"], ["protect", "🔒 İletme ve kaydetmeyi engelle"], ["pin", "📌 Gönderince sabitle"]] as const).map(([k, label]) => (
                <label key={k} className="a-row" style={{ gap: 6, fontSize: 14 }}><input type="checkbox" style={{ width: 18 }} checked={d.options[k]} onChange={(e) => up({ options: { ...d.options, [k]: e.target.checked } })} /> {label}</label>
              ))}
              {d.kind === "message" && !d.mediaPath && <>
                <label className="a-row" style={{ gap: 6, fontSize: 14 }}><input type="checkbox" style={{ width: 18 }} checked={!d.options.noPreview} onChange={(e) => up({ options: { ...d.options, noPreview: !e.target.checked } })} /> 🔗 Link önizlemesi göster</label>
                {!d.options.noPreview && <label className="a-row" style={{ gap: 6, fontSize: 14 }}><input type="checkbox" style={{ width: 18 }} checked={d.options.previewLarge} onChange={(e) => up({ options: { ...d.options, previewLarge: e.target.checked } })} /> büyük görsel</label>}
                {!d.options.noPreview && <label className="a-row" style={{ gap: 6, fontSize: 14 }}><input type="checkbox" style={{ width: 18 }} checked={d.options.previewAbove} onChange={(e) => up({ options: { ...d.options, previewAbove: e.target.checked } })} /> metnin üstünde</label>}
              </>}
            </div>
            <label className="a-row" style={{ gap: 6, fontSize: 13, marginBottom: 10 }}><input type="checkbox" style={{ width: 18 }} checked={allow} onChange={(e) => setAllow(e.target.checked)} /> Uyarıya rağmen gönder (metinde “banko / garanti / kesin” gibi ifadeler varsa)</label>

            {editingSent ? (
              <div className="a-row"><Btn onClick={editLive} busy={busy === "live"}>Kanaldaki mesajı güncelle</Btn><span className="a-help">Gönderimden sonraki 1 saat içinde metin ve düğmeler düzenlenebilir; görsel ve anket sorusu değiştirilemez.</span></div>
            ) : (
              <div className="a-row" style={{ alignItems: "flex-end" }}>
                <div style={{ width: 210 }}><Field label="Zamanla (Türkiye saati)"><input type="datetime-local" value={d.scheduledLocal} onChange={(e) => up({ scheduledLocal: e.target.value })} /></Field></div>
                <div className="a-field"><Btn kind="ghost" onClick={() => save("schedule")} busy={busy === "schedule"} disabled={!d.scheduledLocal}>⏰ Zamanla</Btn></div>
                <div className="a-field"><Btn onClick={() => save("send")} busy={busy === "send"}>📤 Şimdi gönder</Btn></div>
                <div className="a-field"><Btn kind="soft" onClick={() => save("draft")} busy={busy === "draft"}>Taslak kaydet</Btn></div>
                <div className="a-field"><Btn kind="soft" onClick={saveTemplate} busy={busy === "tpl"}>{d.templateId ? "Şablonu güncelle" : "Şablon olarak kaydet"}</Btn></div>
              </div>
            )}
          </div>

          <div>
            <p className="a-help" style={{ marginBottom: 6 }}>Önizleme — {chan === "vip" ? "👑 VIP kanal" : "📣 Ücretsiz kanal"}</p>
            <div className="pe-prev">
              {d.kind === "poll" ? (
                <div className="pe-poll">
                  <b>{d.poll.question || "Soru…"}</b>
                  <span className="a-help">{d.poll.quiz ? "Bilgi yarışması" : d.poll.multiple ? "Anonim anket · çoklu seçim" : "Anonim anket"}</span>
                  {d.poll.options.map((o, i) => <div key={i}><i className={d.poll.quiz && d.poll.correctIndex === i ? "ok" : ""} />{o || `${i + 1}. seçenek`}</div>)}
                </div>
              ) : (
                <div className="pe-bubble">
                  {d.mediaUrl && !d.options.captionAbove && (d.mediaType === "video" ? <video src={d.mediaUrl} controls muted /> : <img src={d.mediaUrl} alt="" className={d.options.mediaSpoiler ? "blur" : ""} />)}
                  {d.text ? <div dangerouslySetInnerHTML={{ __html: previewHtml(d.text, d.options.divider) }} /> : <span className="a-help">Metin yok</span>}
                  {d.mediaUrl && d.options.captionAbove && (d.mediaType === "video" ? <video src={d.mediaUrl} controls muted /> : <img src={d.mediaUrl} alt="" className={d.options.mediaSpoiler ? "blur" : ""} style={{ marginTop: 8, marginBottom: 0 }} />)}
                </div>
              )}
              {d.withButtons && d.buttons.length > 0 && <div className="pe-kb">{d.buttons.map((row, r) => <div key={r}>{row.map((b, i) => <span key={i} className={b.style ? "c" : ""} style={{ background: btnColor(b.style) }}>{b.text}</span>)}</div>)}</div>}
            </div>
            <p className="a-help" style={{ marginTop: 8 }}>Okunabilirlik: ilk satırda kalın başlık + emoji; her maç ayrı blok, aralarına çizgi; en fazla 6–8 satır; sonuçlar ✅ ❌; önemli sayı <b>kalın</b>; uzun gerekçe “açılır alıntı”da; VIP'te tahmini “gizli” yapıp paylaşımı iletmeye kapatın.</p>
          </div>
        </div>
      </Card>

      <Card title={`${chan === "vip" ? "VIP" : "Ücretsiz"} kanal şablonları (${templates.length})`} desc="Kalıcıdır. “Kullan” içeriği editöre alır; değiştirip gönderin ya da zamanlayın.">
        {!templates.length && <p className="a-help">Bu kanal için şablon yok. Yukarıda bir paylaşım yazıp “Şablon olarak kaydet” deyin.</p>}
        <div className="a-scroll"><table className="a-table"><tbody>
          {templates.map((t: Any) => <tr key={t.id}><td><b>{t.kind === "poll" ? "📊 " : ""}{t.title}</b><br /><span className="a-help">{(t.tags ?? []).map((x: string) => `#${x}`).join(" ")} · {t.uses} kez kullanıldı{t.media_path ? " · görselli" : ""}{(t.buttons ?? []).length ? " · düğmeli" : ""}</span></td><td className="a-help" style={{ maxWidth: 420, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.kind === "poll" ? t.poll?.question : String(t.text ?? "").replace(/<[^>]+>/g, "").slice(0, 120)}</td><td><div className="a-row"><Btn small onClick={() => loadInto(t, true)}>Kullan</Btn><Btn small kind="danger" onClick={act(`tdel${t.id}`, "template_delete", { id: t.id }, "Şablon silindi.", "Şablon silinsin mi?")}>Sil</Btn></div></td></tr>)}
        </tbody></table></div>
      </Card>

      <Card title={`${chan === "vip" ? "VIP" : "Ücretsiz"} kanal paylaşımları`} desc="Zamanlanmış, gönderilmiş ve taslaklar; her birinin getirdiği başlatma, ödeme sayfası ve satış sayıları." right={<div className="a-row">
        <select value={filter.status} onChange={(e) => setFilter({ ...filter, status: e.target.value })}><option value="">Tüm durumlar</option>{Object.entries(POST_STATUS_TR).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}</select>
        <select value={filter.tag} onChange={(e) => setFilter({ ...filter, tag: e.target.value })}><option value="">Tüm etiketler</option>{allTags.map((t) => <option key={t} value={t}>#{t}</option>)}</select>
        <Btn small kind="soft" onClick={() => run("due", async () => { const r = await api("post_run_due"); notify(`${r.sent} gönderildi, ${r.failed} başarısız, ${r.purged} içerik temizlendi.`); await load(); })} busy={busy === "due"}>Sırası gelenleri şimdi gönder</Btn>
      </div>}>
        <div className="a-scroll"><table className="a-table" style={{ minWidth: 980 }}><thead><tr><th>Paylaşım</th><th>Durum</th><th>Zaman</th><th>Başlatma</th><th>Ödeme sayfası</th><th>Satış</th><th>Gelir</th><th>Alanlar</th><th /></tr></thead><tbody>
          {posts.map((p: Any) => <tr key={p.id}>
            <td><b>#{p.id} {p.kind === "poll" ? "📊 " : ""}{p.title}</b><br /><span className="a-help">{(p.tags ?? []).map((x: string) => `#${x}`).join(" ")}{p.content_purged ? " · metin silindi" : ""}{p.error ? ` · ${p.error}` : ""}</span></td>
            <td><Pill tone={POST_STATUS_TR[p.status]?.[1]}>{POST_STATUS_TR[p.status]?.[0] ?? p.status}</Pill></td>
            <td className="a-help">{p.status === "scheduled" ? `⏰ ${istanbul(p.scheduled_at)}` : p.sent_at ? istanbul(p.sent_at) : istanbul(p.created_at)}</td>
            <td>{p.starts}</td><td>{p.checkouts}</td><td><b>{p.purchases}</b></td><td>{tl(Number(p.revenue))}</td>
            <td className="a-help" style={{ maxWidth: 200 }}>{p.buyers.slice(0, 5).map((b: Any) => `${b.name} (${tl(b.amount)})`).join(", ")}{p.buyers.length > 5 ? ` +${p.buyers.length - 5}` : ""}</td>
            <td><div className="a-row" style={{ flexWrap: "nowrap" }}>
              {(p.status === "draft" || p.status === "scheduled" || p.status === "failed") && !p.content_purged && <Btn small onClick={() => loadInto(p)}>Düzenle</Btn>}
              {(p.status === "draft" || p.status === "scheduled" || p.status === "failed") && !p.content_purged && <Btn small kind="soft" onClick={act(`send${p.id}`, "post_send_now", { id: p.id }, "Gönderildi.", "Şimdi gönderilsin mi?")}>Gönder</Btn>}
              {p.status === "sent" && !p.content_purged && p.kind !== "poll" && <Btn small onClick={() => loadInto(p)}>Kanalda düzenle</Btn>}
              {p.status === "sent" && p.kind === "poll" && p.telegram_message_id && <Btn small kind="soft" onClick={act(`stop${p.id}`, "post_stop_poll", { id: p.id }, "Anket kapatıldı.", "Anket kapatılsın mı?")}>Anketi kapat</Btn>}
              {(!p.content_purged || p.kind === "poll") && <Btn small kind="soft" onClick={act(`dup${p.id}`, "post_duplicate", { id: p.id }, "Kopyalandı (taslak).")}>Kopyala</Btn>}
              {p.status === "sent" && p.telegram_message_id && <Btn small kind="soft" onClick={act(`pin${p.id}`, "post_pin", { id: p.id, pin: true }, "Sabitlendi.")}>📌</Btn>}
              {p.status === "sent" && p.telegram_message_id && <Btn small kind="danger" onClick={act(`cdel${p.id}`, "post_delete_channel", { id: p.id }, "Kanaldan silindi.", "Mesaj kanaldan silinsin mi?")}>Kanaldan sil</Btn>}
              <Btn small kind="danger" onClick={act(`rdel${p.id}`, "post_delete_row", { id: p.id }, "Kayıt silindi.", "Kayıt ve sayıları silinsin mi? (Kanaldaki mesaj kalır.)")}>Kaydı sil</Btn>
            </div></td>
          </tr>)}
          {!posts.length && <tr><td colSpan={9} className="a-help">Paylaşım yok.</td></tr>}
        </tbody></table></div>
      </Card>

      <div className="a-grid2">
        <Card title="Etiket performansı (iki kanal birlikte)" desc="Aynı etiketi verdiğiniz paylaşımların toplamı: hangi tür paylaşım satıyor?">
          <div className="a-scroll"><table className="a-table"><thead><tr><th>Etiket</th><th>Paylaşım</th><th>Başlatma</th><th>Satış</th><th>Gelir</th></tr></thead><tbody>
            {ov.tags.map((t: Any) => <tr key={t.tag}><td>#{t.tag}</td><td>{t.posts}</td><td>{t.starts}</td><td><b>{t.purchases}</b></td><td>{tl(t.revenue)}</td></tr>)}
            {!ov.tags.length && <tr><td colSpan={5} className="a-help">Etiketli paylaşım yok.</td></tr>}
          </tbody></table></div>
        </Card>
        <Card title="Satış kaynağı ve zamanlama">
          <p style={{ fontSize: 14 }}><b>Kanal paylaşımı:</b> {src.channel_post.n} satış · {tl(src.channel_post.revenue)} — <b>Bot (reklam):</b> {src.bot_ad.n} · {tl(src.bot_ad.revenue)} — <b>Bot (doğrudan):</b> {src.bot_direct.n} · {tl(src.bot_direct.revenue)}{src.unlinked.n ? ` — bağlanmamış: ${src.unlinked.n}` : ""}. İlk ödemeler sayılır; ödemeden önceki 7 gün içinde bir paylaşım düğmesine basılmışsa satış o paylaşıma yazılır.</p>
          <p style={{ fontSize: 14, marginTop: 8 }}>Zamanlanmış paylaşımların dakikasında gitmesi için <b>supabase/post_scheduler.sql</b> çalıştırılmış olmalı. Düğmeler botu <code>t.me/{ov.botUsername}?start=p&lt;no&gt;</code> ile açar.</p>
        </Card>
      </div>
    </>
  );
}

function ButtonAdder({ plans, hasSupport, onAdd, onPreset }: { plans: Any[]; hasSupport: boolean; onAdd: (b: PBtn, sameRow: boolean) => void; onPreset: () => void }) {
  const [type, setType] = useState<PBtn["type"]>("plan");
  const [text, setText] = useState("");
  const [value, setValue] = useState(plans[0]?.key ?? "");
  const [style, setStyle] = useState<PBtn["style"]>(null);
  const [sameRow, setSameRow] = useState(false);
  const plan = plans.find((p) => p.key === value);
  const defaults: Record<PBtn["type"], string> = { plan: plan ? `👑 ${plan.name} · ${plan.priceLabel}` : "👑 VIP", planlar: "👑 VIP planlarını gör", bot: "💬 Bota yaz", free_channel: "📲 Ücretsiz kanala katıl", support: "🆘 Destek", url: "🔗 Aç" };
  return (
    <div className="a-row" style={{ alignItems: "flex-end", marginTop: 6 }}>
      <div style={{ width: 150 }}><Field label="Tür"><select value={type} onChange={(e) => { setType(e.target.value as PBtn["type"]); setText(""); }}>{(Object.keys(BTN_TYPE_TR) as PBtn["type"][]).filter((t) => t !== "support" || hasSupport).map((t) => <option key={t} value={t}>{BTN_TYPE_TR[t]}</option>)}</select></Field></div>
      {type === "plan" && <div style={{ width: 140 }}><Field label="Plan"><select value={value} onChange={(e) => setValue(e.target.value)}>{plans.map((p) => <option key={p.key} value={p.key}>{p.name}</option>)}</select></Field></div>}
      {type === "url" && <div style={{ width: 210 }}><Field label="Adres"><input value={value.startsWith("http") ? value : ""} onChange={(e) => setValue(e.target.value)} placeholder="https://…" /></Field></div>}
      <div style={{ width: 200 }}><Field label="Düğme yazısı"><input value={text} onChange={(e) => setText(e.target.value)} placeholder={defaults[type]} maxLength={40} /></Field></div>
      <div style={{ width: 150 }}><Field label="Renk"><select value={style ?? ""} onChange={(e) => setStyle((e.target.value || null) as PBtn["style"])}>{BTN_STYLE_TR.map(([v, l]) => <option key={v ?? "none"} value={v ?? ""}>{l}</option>)}</select></Field></div>
      <label className="a-row" style={{ gap: 6, fontSize: 13, paddingBottom: 10 }}><input type="checkbox" style={{ width: 18 }} checked={sameRow} onChange={(e) => setSameRow(e.target.checked)} /> aynı satıra</label>
      <div className="a-field"><Btn small onClick={() => onAdd({ text: text.trim() || defaults[type], type, value: type === "plan" || type === "url" ? value : undefined, style }, sameRow)}>Düğme ekle</Btn></div>
      <div className="a-field"><Btn small kind="soft" onClick={onPreset}>Hazır: 3 plan düğmesi</Btn></div>
    </div>
  );
}

/* =====================================================================
 *  GELİŞMİŞ AYARLAR  (tam prompt metni, güvenlik filtresi, tasarım, komutlar)
 * ===================================================================== */
const PTEXT_GROUPS: FlatGroup[] = [
  { title: "Satış asistanı — sabit kısımlar", desc: "Bunlar Satış Asistanı sekmesindeki düzenlenebilir bloklardan SONRA prompta eklenir. Değişkenler: {{MARKA}}, {{YAS}}. Bir kuralı kaldırmak yasal/finansal risk yaratabilir; ne yaptığınızı biliyorsanız değiştirin, her zaman “Varsayılana dön” ile geri alabilirsiniz.", items: [["lockedRules", "Değişmez kurallar (dürüstlük, yaş, bahis sitesi, satışı kapatma…)", "Her satır bir kural. Botun uyduğu asıl metin budur.", 18], ["systemButtons", "Sistem düğmeleri açıklaması", "Botun invite_free / offer_vip / show_plans eylemlerinin ne yaptığı.", 6], ["knowledgeIntro", "Öğretilen bilgilerin başındaki talimat", "", 3]] },
  { title: "Takip mesajı promptu", items: [["followup", "Takip modu talimatı", "“messages” kelimesi kalmalı.", 8]] },
  { title: "Konuşma analisti (İngilizce talimat, Türkçe çıktı)", desc: "JSON alan adları (outcome, loss_reason, quality, summary…) korunmalı; yoksa sistem cevabı okuyamaz.", items: [["analyst", "Analist promptu", "", 24]] },
  { title: "Satış koçu", desc: "JSON alan adları (playbook, guidelines, changes, experiment_proposals…) korunmalı.", items: [["coach", "Koç promptu", "", 30]] },
  { title: "Diğer yapay zekâ görevleri", items: [["teach", "“Yapay zekâya öğret” — notu bilgi kaydına çeviren talimat", "“issue” ve “solution” kalmalı.", 6], ["analytics", "Analiz sekmesindeki yapay zekâ yorumu", "“ozet” ve “oneriler” kalmalı.", 22]] },
];
const CMD_GROUPS: FlatGroup[] = [
  { title: "Bot komutları", desc: "Komut adı: yalnızca küçük harf, rakam ve _. Eski adlar (/planlar /kanal /dur /planos /canal /parar /stop /vip) her zaman çalışmaya devam eder. Kaydettikten sonra “Telegram menüsünü güncelle” düğmesine basın.", items: [["plans", "Planlar komutu (/ olmadan)"], ["plansDesc", "Açıklaması (Telegram menüsünde görünür)"], ["channel", "Ücretsiz kanal komutu"], ["channelDesc", "Açıklaması"], ["stop", "Mesajları durdurma komutu"], ["stopDesc", "Açıklaması"], ["startDesc", "/start açıklaması"]] },
  { title: "“Satın almak istiyor” anahtar kelimeleri", desc: "Kişinin mesajında bunlardan biri geçerse bot her aşamada planları verebilir (satın almak isteyeni bekletmez). Virgülle ayırın; büyük/küçük harf önemsiz, Türkçe ekler tolere edilir.", items: [["directBuyingKeywords", "Anahtar kelimeler", "", 5]] },
];
const THEME_COLORS: [string, string][] = [["lpBg1", "Üst zemin"], ["lpBg2", "Alt zemin"], ["lpAccent", "Vurgu / düğme"], ["lpAccentDeep", "Düğme gölgesi"], ["lpText", "Yazı"], ["lpCtaText", "Düğme yazısı"]];
const SAFE_COLORS: [string, string][] = [["sfHeader", "Üst çubuk ve başlıklar"], ["sfAccent", "Bağlantı / vurgu"], ["sfBg", "Zemin"], ["sfText", "Yazı"]];
const THEME_SHOW: [string, string][] = [["showAgeBadge", "+18 rozeti"], ["showPreview", "Örnek mesaj kartı"], ["showHow", "“Nasıl çalışır?”"], ["showBenefits", "“Ne alırsın?” listesi"], ["showHonest", "“Açık konuşalım”"], ["showFaq", "Sık sorulan sorular"], ["showFinal", "Sayfa sonundaki düğme"], ["showSticky", "Alt yapışkan çubuk"], ["showFooter", "Alt bilgi (+18 uyarısı)"]];

function ThemeEditor() {
  const { s, draft: t, upd, save, reset, busy, dirty } = useSection("theme");
  if (!t || !s) return <p className="a-help">Yükleniyor…</p>;
  const color = (k: string, label: string) => (
    <div key={k} style={{ width: 170 }}><Field label={label}><div className="a-row" style={{ gap: 6 }}><input type="color" value={/^#[0-9a-f]{6}$/i.test(t[k]) ? t[k] : "#000000"} onChange={(e) => upd([k], e.target.value)} style={{ width: 44, height: 36, padding: 2 }} /><input value={t[k]} onChange={(e) => upd([k], e.target.value)} style={{ width: 100 }} /></div></Field></div>
  );
  const check = (k: string, label: string) => <label key={k} className="a-row" style={{ gap: 6, fontSize: 14 }}><input type="checkbox" style={{ width: 18 }} checked={Boolean(t[k])} onChange={(e) => upd([k], e.target.checked)} /> {label}</label>;
  return (
    <>
      <p className="a-intro">Açılış sayfasının ve Futbol Veri Merkezi sayfasının görünümü. Renkler, yazı tipi, köşe yuvarlaklığı, hangi bölümlerin görüneceği ve isterseniz serbest CSS. Metinler Açılış Sayfası / Veri Merkezi Sayfası sekmelerinde. Kaydettikten sonra <a href="/?goruntule=ana" target="_blank" rel="noreferrer">ana sayfayı</a> ve <a href="/?goruntule=veri" target="_blank" rel="noreferrer">Veri Merkezi sayfasını</a> yeni sekmede açıp bakın.</p>
      <Card title="Açılış sayfası — renkler" desc="#rrggbb biçiminde. Sarı düğme + koyu yeşil zemin varsayılandır.">
        <div className="a-row">{THEME_COLORS.map(([k, l]) => color(k, l))}<div style={{ width: 170 }}><Field label="İkincil yazı saydamlığı (%)"><Num value={t.lpMutedOpacity} min={20} max={100} onChange={(v) => upd(["lpMutedOpacity"], v)} /></Field></div></div>
      </Card>
      <Card title="Açılış sayfası — yazı tipi ve düzen">
        <div className="a-row" style={{ alignItems: "flex-end" }}>
          <div style={{ width: 200 }}><Field label="Başlık yazı tipi"><select value={t.lpFontDisplay} onChange={(e) => upd(["lpFontDisplay"], e.target.value)}><option value="condensed">Dar (kondense)</option><option value="system">Sistem</option><option value="serif">Serif</option><option value="rounded">Yuvarlak</option><option value="mono">Sabit genişlik</option></select></Field></div>
          <div style={{ width: 200 }}><Field label="Metin yazı tipi"><select value={t.lpFontBody} onChange={(e) => upd(["lpFontBody"], e.target.value)}><option value="system">Sistem</option><option value="serif">Serif</option><option value="rounded">Yuvarlak</option><option value="mono">Sabit genişlik</option></select></Field></div>
          <div style={{ width: 160 }}><Field label="Köşe yuvarlaklığı (px)"><Num value={t.lpRadius} min={0} max={40} onChange={(v) => upd(["lpRadius"], v)} /></Field></div>
          <div style={{ width: 240 }}><Field label="Geniş ekranda örnek mesaj"><select value={t.lpHeroLayout} onChange={(e) => upd(["lpHeroLayout"], e.target.value)}><option value="side">Başlığın yanında</option><option value="stack">Başlığın altında, ortalı</option></select></Field></div>
        </div>
        <div className="a-row" style={{ gap: 16 }}>{check("lpStripes", "Çim çizgileri")}{check("lpCtaUppercase", "Düğme yazısı BÜYÜK HARF")}</div>
      </Card>
      <Card title="Açılış sayfası — bölümler" desc="Kapattığınız bölüm sayfadan tamamen kalkar.">
        <div className="a-row" style={{ gap: 16 }}>{THEME_SHOW.map(([k, l]) => check(k, l))}</div>
      </Card>
      <Card title="Açılış sayfası — serbest CSS" desc="Bilenler için: sayfanın sonuna eklenir ve her şeyi ezer. Sınıf adları: .page .top .brand .hero .chip .lead .cta .trust .tg .tg__phone .steps .gets .honest .faq .final .foot .sticky. Boş bırakılabilir.">
        <Txt value={t.lpCustomCss} onChange={(v) => upd(["lpCustomCss"], v)} rows={8} placeholder={".cta { background: #ff3b30; }\n.hero h1 { letter-spacing: 0; }"} />
      </Card>
      <Card title="Futbol Veri Merkezi sayfası" desc="Botlara ve ülke dışına gösterilen bilgi sayfasının görünümü.">
        <div className="a-row">{SAFE_COLORS.map(([k, l]) => color(k, l))}</div>
        <Field label="Serbest CSS (sınıflar: .sf .sf__top .sf__brand .sf__nav .sf__hero .sf__cards .sf__section .sf__foot)"><Txt value={t.sfCustomCss} onChange={(v) => upd(["sfCustomCss"], v)} rows={5} /></Field>
      </Card>
      <SaveBar onSave={save} onReset={reset} busy={busy} dirty={dirty} />
    </>
  );
}

function GuardEditor() {
  const { s, draft: g, upd, save, reset, busy, dirty } = useSection("guard");
  const [test, setTest] = useState("Bu hafta banko kupon var, garanti yok ama %90 isabet.");
  const [result, setResult] = useState<Any>(null);
  const [nr, setNr] = useState<{ label: string; kind: "word" | "regex"; value: string; id: string }>({ label: "", kind: "word", value: "", id: "custom" });
  const [tb, run] = useBusy();
  if (!g || !s) return <p className="a-help">Yükleniyor…</p>;
  const rules: Any[] = g.rules ?? [];
  const setRule = (i: number, patch: Any) => upd(["rules"], rules.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const lists: [string, string, string][] = [
    ["negationAfter", "Eşleşmeden SONRA gelirse dürüst sayılan kelimeler", "“garanti yok”, “garanti etmiyoruz” gibi cümleleri serbest bırakır."],
    ["negationWeak", "“yok” içeren kalıplar için dar liste", "“risk yok” kalıbında “yok” iddianın kendisidir; bu liste onun yerine kullanılır."],
    ["negationBefore", "Eşleşmeden ÖNCE gelirse dürüst sayılan kelimeler", "“hiçbir tahmin garanti değildir”, “kimse garanti veremez”."],
    ["optOutWhole", "Tek kelimelik “mesaj istemiyorum” mesajları", "Kişi yalnızca bunlardan birini yazarsa bot bir daha yazmaz."],
    ["optOutPhrases", "Mesajın içinde geçen “mesaj istemiyorum” kalıpları (düzenli ifade parçaları)", "Virgülle ayrılır; her parça bir regex'tir."],
    ["resultWords", "Sonuç kelimeleri", "Bir yüzde bunların yanındaysa “isabet iddiası” sayılır ve yalnızca İşletme Bilgileri'ndeki gerçek sayılara izin verilir."],
    ["promoWords", "Kampanya kelimeleri", "Aktif kampanya tanımlı değilken bunlar geçerse “uydurma kampanya” sayılır."],
  ];
  return (
    <>
      <p className="a-intro">Botun ve koçun asla yazamayacağı ifadeler. Her kuralı kapatabilir, silebilir, kendi kelimenizi ekleyebilirsiniz. Kural “kelime” türündeyse Türkçe ekler de yakalanır (“garanti” → garantili, garantisi…). Cümlede olumsuzluk varsa (“garanti yok”) izin verilir; olumsuzluk kelimelerini de siz yönetirsiniz. Değişiklik hemen geçerli olur; yasak ifade üreten cevap yeniden yazdırılır, olmazsa güvenli cevap gider.</p>
      <div className="a-warn">Filtreyi gevşetmek yasal risk demektir: “banko”, “garanti”, “kesin kazanç” gibi ifadeler yanıltıcı reklamdır ve Meta reklam hesabınızı kapattırabilir. Her zaman “Varsayılana dön” ile başlangıç listesine dönebilirsiniz.</div>
      <Card title="Genel" right={<label className="a-row" style={{ gap: 6 }}><input type="checkbox" style={{ width: 18 }} checked={Boolean(g.enabled)} onChange={(e) => upd(["enabled"], e.target.checked)} /> Filtre açık</label>}>
        <div className="a-row" style={{ gap: 16 }}>
          <label className="a-row" style={{ gap: 6, fontSize: 14 }}><input type="checkbox" style={{ width: 18 }} checked={Boolean(g.checkStats)} onChange={(e) => upd(["checkStats"], e.target.checked)} /> Doğrulanmamış isabet/kazanç yüzdelerini engelle</label>
          <label className="a-row" style={{ gap: 6, fontSize: 14 }}><input type="checkbox" style={{ width: 18 }} checked={Boolean(g.checkLinks)} onChange={(e) => upd(["checkLinks"], e.target.checked)} /> Botun mesajında çıplak link yasak (düğmeleri sistem ekler)</label>
        </div>
      </Card>
      <Card title={`Yasak ifadeler (${rules.length})`} desc="“Kategori” aynı olan kurallar aynı sebep adıyla raporlanır (guaranteed_result, fake_scarcity…). “yok”lu kalıp: kalıbın kendisinde “yok” geçiyorsa işaretleyin.">
        <div className="a-scroll"><table className="a-table" style={{ minWidth: 820 }}><thead><tr><th>Açık</th><th>Ad</th><th>Tür</th><th>Kelime / düzenli ifade</th><th>Kategori</th><th>“yok”lu kalıp</th><th /></tr></thead><tbody>
          {rules.map((r, i) => (
            <tr key={i}>
              <td><input type="checkbox" style={{ width: 18 }} checked={Boolean(r.enabled)} onChange={(e) => setRule(i, { enabled: e.target.checked })} /></td>
              <td><input value={r.label} onChange={(e) => setRule(i, { label: e.target.value })} style={{ width: 170 }} /></td>
              <td><select value={r.kind} onChange={(e) => setRule(i, { kind: e.target.value })}><option value="word">kelime</option><option value="regex">regex</option></select></td>
              <td><input value={r.value} onChange={(e) => setRule(i, { value: e.target.value })} style={{ width: 340, fontFamily: "ui-monospace, monospace", fontSize: 12 }} /></td>
              <td><input value={r.id} onChange={(e) => setRule(i, { id: e.target.value })} style={{ width: 150 }} /></td>
              <td><input type="checkbox" style={{ width: 18 }} checked={Boolean(r.weakNegation)} onChange={(e) => setRule(i, { weakNegation: e.target.checked })} /></td>
              <td><Btn small kind="danger" onClick={() => upd(["rules"], rules.filter((_, j) => j !== i))}>Sil</Btn></td>
            </tr>
          ))}
        </tbody></table></div>
        <div className="a-row" style={{ alignItems: "flex-end", marginTop: 10 }}>
          <div style={{ width: 170 }}><Field label="Yeni kural adı"><input value={nr.label} onChange={(e) => setNr({ ...nr, label: e.target.value })} placeholder="ör. Şike" /></Field></div>
          <div style={{ width: 120 }}><Field label="Tür"><select value={nr.kind} onChange={(e) => setNr({ ...nr, kind: e.target.value as "word" | "regex" })}><option value="word">kelime</option><option value="regex">regex</option></select></Field></div>
          <div style={{ width: 300 }}><Field label="Kelime / ifade"><input value={nr.value} onChange={(e) => setNr({ ...nr, value: e.target.value })} placeholder={nr.kind === "word" ? "ör. şike" : "ör. (?<![a-zçğıöşü])şike"} /></Field></div>
          <div style={{ width: 170 }}><Field label="Kategori"><input value={nr.id} onChange={(e) => setNr({ ...nr, id: e.target.value })} /></Field></div>
          <div className="a-field"><Btn small onClick={() => { if (!nr.value.trim()) return; upd(["rules"], [...rules, { id: nr.id || "custom", label: nr.label || nr.value, kind: nr.kind, value: nr.value.trim(), enabled: true, weakNegation: false }]); setNr({ ...nr, label: "", value: "" }); }}>Kural ekle</Btn></div>
        </div>
      </Card>
      {lists.map(([k, label, help]) => <Card key={k} title={label} desc={help}><Txt value={g[k] ?? ""} onChange={(v) => upd([k], v)} rows={k === "optOutPhrases" ? 4 : 3} /></Card>)}
      <Card title="Test et" desc="Bir cümle yazın; kaydedilmemiş değişiklikler teste yansımaz (önce kaydedin).">
        <Txt value={test} onChange={setTest} rows={2} />
        <div className="a-row" style={{ marginTop: 8 }}><Btn small onClick={() => run("t", async () => setResult(await api("guard_test", { text: test })))} busy={tb === "t"}>Kontrol et</Btn></div>
        {result && (
          <div style={{ marginTop: 10, fontSize: 14 }}>
            {result.explain.length ? result.explain.map((x: Any, i: number) => <p key={i}>🚫 <b>{x.label}</b> ({x.rule}) — “{x.match}”</p>) : <p>✅ Yasak ifade yok.</p>}
            <p className="a-help">Mesaj istemiyor: {result.optOut ? "EVET" : "hayır"} · Satın alma sorusu: {result.directBuying ? "EVET" : "hayır"}</p>
          </div>
        )}
      </Card>
      <SaveBar onSave={save} onReset={reset} busy={busy} dirty={dirty} />
    </>
  );
}

function Advanced() {
  const [sub, setSub] = useState<"prompt" | "guard" | "theme" | "commands">("prompt");
  const [cb, run] = useBusy();
  const tabs: [typeof sub, string][] = [["prompt", "🧠 Prompt (tam metin)"], ["guard", "🛡️ Güvenlik filtresi"], ["theme", "🎨 Tasarım"], ["commands", "⌨️ Komutlar ve anahtar kelimeler"]];
  return (
    <>
      <h1>Gelişmiş Ayarlar</h1>
      <p className="a-intro">Buradaki her şey daha önce yalnızca kodda değiştirilebiliyordu. Sayısal kurallar (puanlar, takip süreleri, saklama) Kurallar ve Puanlama sekmesinde; bloklar Satış Asistanı'nda; metinler Hazır Mesajlar / Açılış Sayfası'nda. Her bölümde “Varsayılana dön” vardır.</p>
      <div className="a-row" style={{ marginBottom: 14 }}>{tabs.map(([k, l]) => <Btn key={k} small kind={sub === k ? undefined : "soft"} onClick={() => setSub(k)}>{l}</Btn>)}</div>
      {sub === "prompt" && <FlatSection section="prompts_full" title="Prompt (tam metin)" groups={PTEXT_GROUPS} intro={<>Satış asistanının değişmez kuralları ve tüm yapay zekâ görevlerinin talimatları. Kaydedince 20 saniye içinde geçerli olur. Tam birleştirilmiş prompt Satış Asistanı sekmesinin altında görünür.</>} />}
      {sub === "guard" && <GuardEditor />}
      {sub === "theme" && <ThemeEditor />}
      {sub === "commands" && <FlatSection section="commands" title="Komutlar ve anahtar kelimeler" groups={CMD_GROUPS} intro={<>Bot komutlarının adları, Telegram menüsündeki açıklamaları ve “satın almak istiyor” anahtar kelimeleri.</>} after={<div className="a-row" style={{ marginTop: 10 }}><Btn small kind="soft" onClick={() => run("sync", async () => { await api("commands_sync"); }, "Telegram menüsü güncellendi.")} busy={cb === "sync"}>Telegram menüsünü güncelle</Btn><span className="a-help">Kaydettikten sonra basın; botun “/” menüsündeki komut listesi yenilenir.</span></div>} />}
    </>
  );
}

/* =====================================================================
 *  Kabuk: giriş + menü
 * ===================================================================== */
const TABS: [string, string][] = [["ozet", "📊 Genel Bakış"], ["analiz", "📈 Analiz"], ["konusmalar", "💬 Konuşmalar"], ["destek", "🆘 Destek Talepleri"], ["paylasim", "📣 Kanal Paylaşımları"], ["isletme", "🏷️ İşletme Bilgileri"], ["asistan", "🤖 Satış Asistanı"], ["mesajlar", "✉️ Hazır Mesajlar"], ["kurallar", "⚖️ Kurallar ve Puanlama"], ["ogrenme", "🧠 Öğrenme"], ["sayfa", "🌐 Açılış Sayfası"], ["filtre", "🛡️ Ziyaretçi Filtresi"], ["verimerkezi", "🧾 Veri Merkezi Sayfası"], ["entegrasyon", "🔌 Entegrasyonlar"], ["kitleler", "🎯 Hedef Kitleler"], ["gelismis", "🧰 Gelişmiş Ayarlar"], ["odemeler", "💳 Ödemeler"], ["veri", "🗑️ Veri Yönetimi"], ["sistem", "🛠️ Sistem"]];

export default function AdminPage() {
  const [auth, setAuth] = useState<"checking" | "in" | "out">("checking");
  const [tab, setTab] = useState("ozet");
  const [openLead, setOpenLead] = useState<string | null>(null);
  const [pw, setPw] = useState("");
  const [toast, setToast] = useState<{ text: string; bad: boolean } | null>(null);
  const [busy, run] = useBusy();

  useEffect(() => {
    document.title = "TAHMİN10 · Yönetim Paneli";
    const meta = document.createElement("meta");
    meta.name = "robots"; meta.content = "noindex,nofollow";
    document.head.appendChild(meta);
    let timer: ReturnType<typeof setTimeout>;
    const onToast = (e: Event) => { const det = (e as CustomEvent).detail; setToast(det); clearTimeout(timer); timer = setTimeout(() => setToast(null), det.bad ? 9000 : 4500); };
    const onAuth = () => setAuth("out");
    window.addEventListener("adm-toast", onToast);
    window.addEventListener("adm-auth", onAuth);
    api("ping").then(() => setAuth("in"), () => setAuth("out"));
    return () => { window.removeEventListener("adm-toast", onToast); window.removeEventListener("adm-auth", onAuth); meta.remove(); };
  }, []);

  const login = () => run("login", async () => { await api("login", { password: pw }); setPw(""); setAuth("in"); });

  return (
    <div className="adm">
      <style>{CSS}</style>
      {auth === "checking" && <div className="a-login"><p className="a-help">Yükleniyor…</p></div>}
      {auth === "out" && (
        <div className="a-login">
          <div className="a-card">
            <h1 style={{ marginBottom: 6 }}>TAHMİN<b style={{ color: "#0b7a3b" }}>10</b> · Yönetim Paneli</h1>
            <p className="a-help" style={{ marginBottom: 14 }}>Şifreniz: Vercel'deki ADMIN_PASSWORD değeri. Tanımlamadıysanız SETUP_SECRET değeriniz.</p>
            <Field label="Şifre"><input type="password" value={pw} autoFocus onChange={(e) => setPw(e.target.value)} onKeyDown={(e) => e.key === "Enter" && login()} /></Field>
            <Btn onClick={login} busy={busy === "login"}>Giriş yap</Btn>
          </div>
        </div>
      )}
      {auth === "in" && (
        <>
          <div className="a-top">
            <h1>TAHMİN<b>10</b> · Yönetim Paneli</h1>
            <Btn small kind="soft" onClick={() => api("logout").finally(() => setAuth("out"))}>Çıkış</Btn>
          </div>
          <div className="a-shell">
            <nav className="a-nav">{TABS.map(([k, l]) => <button key={k} className={tab === k ? "on" : ""} onClick={() => { setOpenLead(null); setTab(k); }}>{l}</button>)}</nav>
            <main className="a-main">
              {tab === "ozet" && <Overview go={setTab} />}
              {tab === "analiz" && <Analytics />}
              {tab === "konusmalar" && <Conversations key={openLead ?? "list"} initial={openLead} />}
              {tab === "destek" && <Tickets openLead={(id) => { setOpenLead(id); setTab("konusmalar"); }} />}
              {tab === "mesajlar" && <FlatSection section="texts" title="Hazır Mesajlar" groups={TEXT_GROUPS} intro={<>Botun yapay zekâya sormadan, AYNEN gönderdiği sabit mesajlar ve düğme yazıları. Kullanabileceğiniz değişkenler: <code>{"{brand}"}</code> marka, <code>{"{vip}"}</code> VIP adı, <code>{"{age}"}</code> yaş sınırı, <code>{"{frequency}"}</code> ücretsiz kanal sıklığı; belirtilen yerlerde <code>{"{plan}"}</code> ve <code>{"{support}"}</code>. Garanti / sahte aciliyet içeren metinler kaydedilemez.</>} />}
              {tab === "sayfa" && <FlatSection section="landing" title="Açılış Sayfası" groups={LANDING_GROUPS} intro={<>Reklamdan gelenlerin gördüğü sayfanın bütün yazıları. Kaydettikten sonra site en geç 2 dakika içinde güncellenir. Değişkenler: <code>{"{brand}"}</code>, <code>{"{frequency}"}</code>, <code>{"{age}"}</code>. İpucu: aynı anda yalnızca BİR şeyi değiştirin (ör. başlık) ve Genel Bakış'ta “sitede butona basan → botu başlatan” oranını birkaç gün izleyin.</>} after={<div className="a-info">Sayfayı görmek için: <a href="/" target="_blank" rel="noreferrer">siteyi yeni sekmede aç</a>. Sağdaki “kupon” görseli bir illüstrasyondur ve gerçek tahmin içermez.</div>} />}
              {tab === "entegrasyon" && <Integrations />}
              {tab === "kitleler" && <Audiences />}
              {tab === "filtre" && <VisitorFilter />}
              {tab === "paylasim" && <ChannelPosts />}
              {tab === "gelismis" && <Advanced />}
              {tab === "verimerkezi" && <FlatSection section="safe" title="Veri Merkezi Sayfası" groups={SAFE_GROUPS} intro={<>Botlara, tarayıcı robotlarına ve izin verilen ülkeler dışından gelenlere gösterilen “Futbol Veri Merkezi” sayfasının bütün yazıları (kime gösterileceği: Ziyaretçi Filtresi sekmesi). Bu sayfada Telegram düğmesi, fiyat ya da tahmin yoktur; öyle kalması önerilir. Kaydettikten sonra en geç 20 saniye içinde yayına girer. Önizleme: Ziyaretçi Filtresi → Önizleme.</>} />}
              {tab === "veri" && <DataAdmin />}
              {tab === "isletme" && <Business />}
              {tab === "asistan" && <Assistant />}
              {tab === "kurallar" && <Rules />}
              {tab === "ogrenme" && <Learning />}
              {tab === "odemeler" && <Payments />}
              {tab === "sistem" && <System />}
            </main>
          </div>
        </>
      )}
      {toast && <div className={`a-toast ${toast.bad ? "bad" : ""}`} onClick={() => setToast(null)}>{toast.text}</div>}
    </div>
  );
}
