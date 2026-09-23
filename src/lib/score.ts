import { SIGNALS, SCORE_TARGET_POINTS } from "../config/funnel";

/**
 * Deterministic 0–100 score. The AI only reports EVIDENCE; this function
 * decides what that evidence is worth. Change weights in config/funnel.ts —
 * no prompt changes needed.
 *
 * 100 = SCORE_TARGET_POINTS of weighted evidence (not "every signal present"),
 * so a clearly interested person can actually reach the threshold.
 */
export function computeScore(values: { key: string; value: number }[]): number {
  const WEIGHTS = new Map<string, number>(SIGNALS.map((s) => [s.key, s.weight as number]));
  let points = 0;
  for (const { key, value } of values) {
    const weight = WEIGHTS.get(key);
    if (weight === undefined) continue;
    points += weight * Math.min(1, Math.max(0, Number(value) || 0));
  }
  return Math.max(0, Math.min(100, Math.round((points / SCORE_TARGET_POINTS) * 100)));
}
