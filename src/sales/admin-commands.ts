import { db } from "../lib/supabase";
import { sendText } from "../lib/telegram";
import { getLeadByTelegramId, recordEvent, recordMessage, updateLead } from "../lib/leads";
import { truncate } from "../lib/util";
import { activatePlaybook, DEFAULT_PLAYBOOK, getActivePlaybook, rejectPlaybook, type PlaybookContent } from "../learning/playbook";
import { listExperiments, setExperimentStatus } from "../learning/experiments";
import { runLearningCycle } from "../learning/pipeline";
import { runFollowups } from "./followups";
import { linkPaymentToLead } from "./payments";

/**
 * Owner commands, only accepted from TELEGRAM_ADMIN_CHAT_ID.
 * Replies are in English; customers never see any of this.
 */

const HELP = `TAHMİN10 yönetici

Sayılar
/stats [gün] — dönemin hunisi (varsayılan 7)
/funnel — tüm zamanlar hunisi, adım dönüşümleriyle
/campaigns [gün] — kampanya / reklam bazında sonuçlar
/objections [gün] — insanlar neye itiraz ediyor

Öğrenme
/playbook [N] — yayındaki (ya da N sürümündeki) rehberi oku
/proposals (veya /playbooks) — onayınızı bekleyen rehberler
/approve N · /reject N
/experiments — A/B testleri ve sayıları
/activate N · /stopexp N
/learn — öğrenme turunu şimdi çalıştır
/followups — takip mesajlarını şimdi gönder (saat sınırını yok sayar)

Kişiler
/say <telegram_id> <metin> — bot adına mesaj gönder
/done <telegram_id> — "insan gerekli" işaretini kaldır
/link <payment_id> <telegram_id> — bağlanmamış Whop ödemesini kişiye bağla ve VIP ver`;

type Funnel = Record<string, number>;

async function rpc<T>(name: string, args: Record<string, unknown> = {}): Promise<T | null> {
  const { data, error } = await db().rpc(name, args);
  if (error) {
    console.error(`[admin] rpc ${name}:`, error.message);
    return null;
  }
  return data as T;
}

const sinceDays = (days: number) => new Date(Date.now() - days * 24 * 3600 * 1000).toISOString();
const pct = (part: number, whole: number) => (whole > 0 ? `${((part / whole) * 100).toFixed(1)}%` : "–");
const money = (v: unknown) => `₺${Number(v ?? 0).toFixed(2)}`;

function parseDays(arg: string | undefined, fallback: number): number {
  const n = Number(arg);
  return Number.isFinite(n) && n > 0 && n <= 365 ? Math.round(n) : fallback;
}

function funnelText(title: string, f: Funnel): string {
  const steps: [string, number, number | null][] = [
    ["Landing clicks", f.landing_leads ?? 0, null],
    ["Started bot", f.started_bot ?? 0, f.landing_leads ?? 0],
    ["Replied", f.replied ?? 0, f.started_bot ?? 0],
    ["Invited to free", f.invited_free ?? 0, f.replied ?? 0],
    ["Joined free", f.joined_free ?? 0, f.invited_free ?? 0],
    ["Saw VIP plans", f.saw_plans ?? 0, f.joined_free ?? 0],
    ["Opened checkout", f.checkout ?? 0, f.saw_plans ?? 0],
    ["Paid", f.paid ?? 0, f.checkout ?? 0],
  ];
  const lines = steps.map(([label, value, prev]) => `${label}: ${value}${prev === null ? "" : `  (${pct(value, prev)} of previous)`}`);
  return [
    title,
    ...lines,
    "",
    `Bot start → paid: ${pct(f.paid ?? 0, f.started_bot ?? 0)}`,
    `Revenue: ${money(f.revenue)}`,
    `Said no: ${f.not_interested ?? 0} · Opted out: ${f.opted_out ?? 0} · Blocked bot: ${f.blocked ?? 0} · Do-not-sell: ${f.do_not_sell ?? 0}`,
  ].join("\n");
}

function playbookText(version: number, status: string, summary: string | null, c: PlaybookContent): string {
  const lines = [`PLAYBOOK v${version} [${status}]`];
  if (summary) lines.push(summary, "");
  lines.push("Guidelines:", ...c.guidelines.map((g) => `• (${g.id} · ${g.stage}) ${g.text}`));
  const objections = Object.entries(c.objection_responses);
  if (objections.length) lines.push("", "Objections:", ...objections.map(([k, v]) => `• ${k}: ${v}`));
  if (c.avoid.length) lines.push("", "Avoid:", ...c.avoid.map((a) => `• ${a}`));
  if (c.segment_tips.length) lines.push("", "Segments:", ...c.segment_tips.map((t) => `• ${t.segment}: ${t.tip}`));
  if (c.locked_winners.length) lines.push("", "Proven by A/B test:", ...c.locked_winners.map((w) => `• [${w.slot}] ${w.instruction} (exp #${w.experiment_id})`));
  return lines.join("\n");
}

async function run(command: string, args: string[], rawArgs: string): Promise<string> {
  switch (command) {
    case "/help":
    case "/admin":
      return HELP;

    case "/stats": {
      const days = parseDays(args[0], 7);
      const f = await rpc<Funnel>("funnel_stats", { p_since: sinceDays(days) });
      return f ? funnelText(`📊 Last ${days} day(s)`, f) : "Could not load stats. Was supabase/schema.sql executed?";
    }

    case "/funnel": {
      const f = await rpc<Funnel>("funnel_stats", { p_since: null });
      return f ? funnelText("📊 All time", f) : "Could not load stats. Was supabase/schema.sql executed?";
    }

    case "/campaigns": {
      const days = parseDays(args[0], 30);
      const rows = await rpc<Record<string, unknown>[]>("campaign_stats", { p_since: sinceDays(days) });
      if (!rows?.length) return `No campaign data in the last ${days} days.`;
      return [
        `📣 Campaigns — last ${days} days (clicks → started → free → checkout → paid)`,
        ...rows.map(
          (r) =>
            `• ${r.campaign ?? "(none)"} / ${r.ad ?? "-"}: ${r.leads} → ${r.started} → ${r.joined_free} → ${r.checkout} → ${r.paid}  ${money(r.revenue)}`,
        ),
      ].join("\n");
    }

    case "/objections": {
      const days = parseDays(args[0], 30);
      const rows = await rpc<Record<string, unknown>[]>("objection_stats", { p_since: sinceDays(days) });
      if (!rows?.length) return `No objections recorded in the last ${days} days.`;
      return [
        `🧱 Objections — last ${days} days`,
        ...rows.map((r) => `• ${r.type}: ${r.leads} people (${r.paid_leads} of them still bought)`),
      ].join("\n");
    }

    case "/playbook": {
      const n = Number(args[0]);
      if (!args[0]) {
        const p = await getActivePlaybook();
        return playbookText(p.version, "active", p.summary, p.content);
      }
      if (n === 1) return playbookText(1, "default", "Hand-written starting playbook.", DEFAULT_PLAYBOOK);
      const { data } = await db().from("playbooks").select("version, status, summary, content").eq("version", n).maybeSingle();
      if (!data) return `Playbook v${args[0]} not found.`;
      return playbookText(data.version, data.status, data.summary, data.content as PlaybookContent);
    }

    case "/playbooks":
    case "/proposals": {
      const { data } = await db().from("playbooks").select("version, summary, created_at").eq("status", "proposed").order("version", { ascending: false }).limit(10);
      if (!data?.length) return "No playbook proposals waiting.";
      return ["Waiting for your decision:", ...data.map((p) => `• v${p.version} — ${truncate(p.summary ?? "", 300)}\n  /playbook ${p.version} · /approve ${p.version} · /reject ${p.version}`)].join("\n");
    }

    case "/approve": {
      const n = Number(args[0]);
      if (!Number.isInteger(n)) return "Usage: /approve N";
      return (await activatePlaybook(n)) ? `✅ Playbook v${n} is now live. New conversations use it immediately.` : `v${n} is not a pending proposal.`;
    }

    case "/reject": {
      const n = Number(args[0]);
      if (!Number.isInteger(n)) return "Usage: /reject N";
      return (await rejectPlaybook(n)) ? `Playbook v${n} rejected. The current one stays.` : `v${n} is not a pending proposal.`;
    }

    case "/experiments": {
      const list = await listExperiments();
      if (!list.length) return "No experiments yet.";
      return list
        .slice(0, 12)
        .map((e) => {
          const r = (e.results ?? {}) as { A?: { n: number; s: number }; B?: { n: number; s: number }; pValue?: number };
          const numbers = r.A && r.B ? `\n  A ${r.A.s}/${r.A.n} (${pct(r.A.s, r.A.n)}) vs B ${r.B.s}/${r.B.n} (${pct(r.B.s, r.B.n)}), p=${Number(r.pValue ?? 1).toFixed(3)}` : "";
          const variants = e.variants.map((v) => `\n  ${v.key}: ${truncate(v.instruction, 160)}`).join("");
          return `#${e.id} [${e.status}${e.winner ? ` → ${e.winner}` : ""}] ${e.name}\n  slot ${e.slot} · metric ${e.metric} · min ${e.min_sample}/variant${variants}${numbers}`;
        })
        .join("\n\n");
    }

    case "/activate": {
      const n = Number(args[0]);
      if (!Number.isInteger(n)) return "Usage: /activate N";
      return setExperimentStatus(n, "running");
    }

    case "/stopexp": {
      const n = Number(args[0]);
      if (!Number.isInteger(n)) return "Usage: /stopexp N";
      return setExperimentStatus(n, "stopped");
    }

    case "/learn": {
      const r = await runLearningCycle({ digest: false });
      const coach = r.coach.status === "waiting" ? `waiting (${r.coach.pending}/${r.coach.needed})` : r.coach.status;
      return `Learning cycle done.\nClosed as silent: ${r.closedAsSilent}\nAnalysed: ${r.analyzed} (${r.analysisErrors} errors)\nExperiments decided: ${r.experimentNotes.length}\nCoach: ${coach}`;
    }

    case "/followups": {
      const r = await runFollowups({ force: true });
      return `Follow-ups: ${r.sent} sent, ${r.blocked} blocked, ${r.errors} errors (from ${r.candidates} candidates).`;
    }

    case "/say": {
      const id = args[0];
      const text = rawArgs.slice((id ?? "").length).trim();
      if (!id || !text) return "Usage: /say <telegram_id> <text>";
      const lead = await getLeadByTelegramId(id);
      if (!lead?.chat_id) return `No lead with Telegram id ${id}.`;
      await sendText(lead.chat_id, text);
      await recordMessage(lead.id, "assistant", text);
      await updateLead(lead.id, { last_bot_message_at: new Date().toISOString() });
      await recordEvent(lead.id, "ADMIN_MESSAGE", {});
      return `Sent to ${lead.first_name ?? id}.`;
    }

    case "/link": {
      const lead = args[1] ? await getLeadByTelegramId(args[1]) : null;
      if (!args[0] || !lead) return "Usage: /link <payment_id> <telegram_id> (the person must have started the bot)";
      return linkPaymentToLead(args[0], lead);
    }

    case "/done": {
      const lead = args[0] ? await getLeadByTelegramId(args[0]) : null;
      if (!lead) return "Usage: /done <telegram_id>";
      await updateLead(lead.id, { needs_human: false });
      return `${lead.first_name ?? args[0]} is back with the bot (follow-ups re-enabled).`;
    }

    default:
      return "";
  }
}

/** Returns true if the text was an admin command (handled or not), false if the admin is just chatting with the bot. */
export async function handleAdminCommand(chatId: number | string, text: string): Promise<boolean> {
  if (!text.startsWith("/")) return false;
  const [first = "", ...args] = text.trim().split(/\s+/);
  const command = first.toLowerCase().replace(/@\w+$/, "");
  const rawArgs = text.trim().slice(first.length).trim();

  let reply: string;
  try {
    reply = await run(command, args, rawArgs);
  } catch (error) {
    console.error("[admin]", error);
    reply = `Command failed: ${(error as Error).message.slice(0, 300)}`;
  }
  if (!reply) return false; // yönetici komutu değil → /start, /planlar vb. sahip için de çalışsın
  await sendText(chatId, truncate(reply, 4000));
  return true;
}
