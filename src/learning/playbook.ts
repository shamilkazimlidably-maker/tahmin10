import { z } from "zod";
import { db, must } from "../lib/supabase";
import { LEARNING, type Stage } from "../config/funnel";
import { findForbiddenClaims } from "../sales/guardrails";

/* ------------------------------------------------------------------ */
/*  Shape                                                             */
/* ------------------------------------------------------------------ */

const guideline = z.object({
  id: z.string().min(1).max(12),
  stage: z.string().max(20).catch("ANY"),
  text: z.string().min(8).max(260),
});

export const playbookContentSchema = z.object({
  guidelines: z.array(guideline).max(LEARNING.maxGuidelines),
  objection_responses: z.record(z.string(), z.string().max(500)).catch({}),
  avoid: z.array(z.string().max(180)).max(8).catch([]),
  segment_tips: z
    .array(z.object({ segment: z.string().max(40), tip: z.string().max(220) }))
    .max(6)
    .catch([]),
  /** Written ONLY by the experiment engine, never by the coach. */
  locked_winners: z
    .array(z.object({ slot: z.string(), instruction: z.string().max(400), experiment_id: z.number() }))
    .catch([]),
});

export type PlaybookContent = z.infer<typeof playbookContentSchema>;
export type Playbook = { id: number | null; version: number; status: string; content: PlaybookContent; summary: string | null };

/** Version 1 — hand-written starting point. The coach evolves it from here. */
export const DEFAULT_PLAYBOOK: PlaybookContent = {
  guidelines: [
    { id: "g1", stage: "DISCOVERY", text: "Ürünle değil futbolla aç. Her şeyden önce tuttuğu takımı ya da takip ettiği ligi sor." },
    { id: "g2", stage: "ANY", text: "Bir sonraki soruyu sormadan önce kişinin az önce söylediğini birkaç kelimeyle karşıla." },
    { id: "g3", stage: "DISCOVERY", text: "Ücretsiz kanal davetini kişinin anlattığı bir şeye bağla (ligi, tahminleri ne sıklıkla takip ettiği)." },
    { id: "g4", stage: "ENGAGED", text: "Kanala girdikten sonra, ücretli bir şeyden söz etmeden önce ücretsiz içeriği nasıl bulduğunu sor." },
    { id: "g5", stage: "ENGAGED", text: "VIP köprüsünü kişinin kendi sözleriyle kur: 'X istediğini söylemiştin — VIP tam olarak bunu ekliyor'." },
    { id: "g6", stage: "VIP_OFFERED", text: "Fiyat sorulunca hemen ve açıkça söyle; sonra haftalık planı düşük riskli deneme yolu olarak an." },
    { id: "g7", stage: "VIP_OFFERED", text: "'Düşüneyim' geçerli bir cevaptır. Kapıyı tek satırla açık bırak ve futbola dön." },
    { id: "g8", stage: "ANY", text: "Güven itirazında 'banko' satıcılarından farkımızı vurgula: garanti yok, ücretsiz kanaldan önce dene." },
  ],
  objection_responses: {
    price: "Fiyatı özür dilemeden teyit et, haftalık planı deneme olarak göster. BİLGİLER'deki tam fiyatı kullan. Örn: \"Haftalık planla sadece 7 gün deneyip sana uyup uymadığına bakabilirsin.\"",
    trust: "Tahminlerin garanti değil görüş olduğunu açıkça söyle ve ücretsiz kanalı değerlendirme yolu olarak göster. Örn: \"Temkinli olman çok normal. Birkaç gün ücretsizi takip et, kararını hiç para ödemeden ver.\"",
    value: "Yalnızca gerçek VIP faydalarını say ve birini kişinin aradığını söylediği şeye bağla.",
    timing: "Kabul et. Örn: \"Tamam, acele yok. Ücretsiz kanal senin için orada.\"",
    results: "İsabet ya da kazanç garantisi olmadığını açıkça söyle. BİLGİLER'de olmayan hiçbir sayıyı söyleme.",
  },
  avoid: [
    "Aynı mesajda iki soru sormak.",
    "Kişi VIP anlatımını zaten duyduktan sonra tekrar etmek.",
    "Fiyat sorusuna soruyla cevap vermek.",
    "'Abi', 'hocam', 'kanka' hitaplarını kişi kullanmadan başlatmak.",
  ],
  segment_tips: [],
  locked_winners: [],
};

/* ------------------------------------------------------------------ */
/*  Storage                                                           */
/* ------------------------------------------------------------------ */

export async function getActivePlaybook(): Promise<Playbook> {
  const { data, error } = await db()
    .from("playbooks")
    .select("id, version, status, content, summary")
    .eq("status", "active")
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) console.error("[playbook]", error.message);
  if (data) {
    const parsed = playbookContentSchema.safeParse(data.content);
    if (parsed.success) return { ...data, content: parsed.data } as Playbook;
    console.error("[playbook] stored playbook failed validation; using default.");
  }
  return { id: null, version: 1, status: "active", content: DEFAULT_PLAYBOOK, summary: "Default hand-written playbook." };
}

async function nextVersion(): Promise<number> {
  const rows = must(await db().from("playbooks").select("version").order("version", { ascending: false }).limit(1), "playbook.version") as {
    version: number;
  }[];
  return Math.max(1, rows[0]?.version ?? 1) + 1;
}

/** Returns a list of reasons the proposal must be rejected (empty = OK). */
export function validateProposal(content: PlaybookContent, previous: PlaybookContent): string[] {
  const problems: string[] = [];
  const texts = [
    ...content.guidelines.map((g) => g.text),
    ...Object.values(content.objection_responses),
    ...content.segment_tips.map((t) => t.tip),
  ];
  for (const text of texts) {
    const claims = findForbiddenClaims(text).filter((c) => c !== "raw_link");
    if (claims.length) problems.push(`forbidden tactic (${claims.join(", ")}): "${text.slice(0, 80)}"`);
    if (/\b(pressure|urgency|scarcity|fomo|guilt|lie|pretend to be human|hide that)\b/i.test(text) && !/\b(no|never|avoid|without|don't|do not)\b/i.test(text)) {
      problems.push(`manipulative tactic: "${text.slice(0, 80)}"`);
    }
  }

  const before = new Map(previous.guidelines.map((g) => [g.id, g.text]));
  const after = new Map(content.guidelines.map((g) => [g.id, g.text]));
  let changes = 0;
  for (const [id, text] of after) if (before.get(id) !== text) changes++;
  for (const id of before.keys()) if (!after.has(id)) changes++;
  if (changes > LEARNING.maxGuidelineChangesPerVersion) {
    problems.push(`too many guideline changes (${changes} > ${LEARNING.maxGuidelineChangesPerVersion}) — unstable`);
  }
  return problems;
}

export async function savePlaybook(params: {
  content: PlaybookContent;
  status: "proposed" | "active";
  summary: string;
  createdBy: "coach" | "experiment" | "admin";
  basedOnBatch?: number | null;
}): Promise<{ id: number; version: number }> {
  const version = await nextVersion();
  if (params.status === "active") {
    await db().from("playbooks").update({ status: "retired", retired_at: new Date().toISOString() }).eq("status", "active");
  }
  const row = must(
    await db()
      .from("playbooks")
      .insert({
        version,
        status: params.status,
        content: params.content,
        summary: params.summary,
        created_by: params.createdBy,
        based_on_batch: params.basedOnBatch ?? null,
        activated_at: params.status === "active" ? new Date().toISOString() : null,
      })
      .select("id, version")
      .single(),
    "savePlaybook",
  ) as { id: number; version: number };
  return row;
}

export async function activatePlaybook(version: number): Promise<boolean> {
  const row = must(await db().from("playbooks").select("id, status").eq("version", version).maybeSingle(), "playbook.find") as {
    id: number;
    status: string;
  } | null;
  if (!row || row.status !== "proposed") return false;
  await db().from("playbooks").update({ status: "retired", retired_at: new Date().toISOString() }).eq("status", "active");
  must(await db().from("playbooks").update({ status: "active", activated_at: new Date().toISOString() }).eq("id", row.id), "playbook.activate");
  return true;
}

export async function rejectPlaybook(version: number): Promise<boolean> {
  const { data } = await db().from("playbooks").update({ status: "rejected" }).eq("version", version).eq("status", "proposed").select("id");
  return Boolean(data?.length);
}

/* ------------------------------------------------------------------ */
/*  Rendering into the sales prompt                                   */
/* ------------------------------------------------------------------ */

export function renderPlaybook(playbook: Playbook, stage: Stage): string {
  const c = playbook.content;
  const relevant = c.guidelines.filter((g) => g.stage === "ANY" || g.stage === stage);
  const lines: string[] = [`# PLAYBOOK v${playbook.version} (advisory — learned from past conversations; FATOS and REGRAS always win)`];
  if (relevant.length) lines.push("Guidelines for this stage:", ...relevant.map((g) => `- ${g.text}`));
  const winners = c.locked_winners.map((w) => `- [${w.slot}] ${w.instruction}`);
  if (winners.length) lines.push("Proven by A/B test:", ...winners);
  const objections = Object.entries(c.objection_responses).filter(([, v]) => v);
  if (objections.length && ["ENGAGED", "VIP_OFFERED", "CHECKOUT", "NOT_INTERESTED"].includes(stage)) {
    lines.push("Objections:", ...objections.map(([k, v]) => `- ${k}: ${v}`));
  }
  if (c.avoid.length) lines.push("Avoid:", ...c.avoid.map((a) => `- ${a}`));
  if (c.segment_tips.length) lines.push("Segments:", ...c.segment_tips.map((t) => `- ${t.segment}: ${t.tip}`));
  return lines.join("\n");
}
