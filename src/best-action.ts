import { eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { action, risk, subconsideration, subScore, valence, volatility } from "@/db/schema";

const weight = z.number().min(0).max(1);

/**
 * User-set weights: one per consideration slot, one per measure and one for surprisingness.
 * The volatility and risk weights run -1–1 as appetites: volatility -1 prefers stability, 1
 * prefers upheaval; risk -1 prefers safe actions, 1 prefers risky ones.
 */
export const Weights = z.object({
  considerations: z.array(weight).length(7),
  volatility: z.number().min(-1).max(1),
  valence: weight,
  risk: z.number().min(-1).max(1),
  surprisingness: weight,
});
export type Weights = z.infer<typeof Weights>;

const MEASURES = ["volatility", "valence", "risk"] as const;
type Scores = Record<(typeof MEASURES)[number], number | null>;

type Slots = {
  slot1: number | null; slot2: number | null; slot3: number | null; slot4: number | null;
  slot5: number | null; slot6: number | null; slot7: number | null;
};
const values = (s: Slots) => [s.slot1, s.slot2, s.slot3, s.slot4, s.slot5, s.slot6, s.slot7];

/**
 * How much an action moves a consideration, 0–1: the average of how much it disturbs it,
 * how strongly it costs or benefits it, and how risky it is for it (volatility and risk -1–1
 * mapped to 0–1).
 */
const change = (s: Scores) => ((s.volatility! + 1) / 2 + Math.abs(2 * s.valence! - 1) + (s.risk! + 1) / 2) / 3;

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

/**
 * Scores every scored, unshown action and returns them best first. Per action, each scored
 * consideration's relevance is its weight × how much the action changes it; only the 2 most
 * relevant count. Each of those adds its weight × Σ (measure weight × the mean of its score and
 * its subconsiderations' scores on that measure); volatility and risk scores and weights run -1–1,
 * so a negative weight rewards stable/safe actions and a positive one disruptive/risky actions.
 * On top, the action's surprisingness × its weight (0 until scored). Recomputed for every unshown action on each call.
 */
export function rankActions(weights: Weights) {
  const rows = db
    .select({ action, volatility, valence, risk })
    .from(action)
    .innerJoin(volatility, eq(volatility.actionId, action.id))
    .innerJoin(valence, eq(valence.actionId, action.id))
    .innerJoin(risk, eq(risk.actionId, action.id))
    .where(isNull(action.shownAt))
    .all();

  const subRows = db
    .select({
      actionId: subScore.actionId,
      slot: subconsideration.slot,
      volatility: subScore.volatility,
      valence: subScore.valence,
      risk: subScore.risk,
    })
    .from(subScore)
    .innerJoin(subconsideration, eq(subconsideration.id, subScore.subconsiderationId))
    .innerJoin(action, eq(action.id, subScore.actionId))
    .where(isNull(action.shownAt))
    .all();
  const subs = new Map<string, Scores[]>();
  for (const { actionId, slot, ...s } of subRows) {
    const key = `${actionId}:${slot}`;
    subs.set(key, [...(subs.get(key) ?? []), s]);
  }

  const c = weights.considerations;
  return rows
    .map((row) => {
      const scores = (i: number): Scores => ({
        volatility: values(row.volatility)[i],
        valence: values(row.valence)[i],
        risk: values(row.risk)[i],
      });
      const top = c
        .map((_, i) => ({ i, s: scores(i) }))
        .filter(({ s }) => MEASURES.every((m) => s[m] !== null))
        .sort((a, b) => c[b.i] * change(b.s) - c[a.i] * change(a.s))
        .slice(0, 2);

      const surprise = weights.surprisingness * (row.action.surprisingness ?? 0);
      const score = top.reduce((sum, { i, s }) => {
        const items = [s, ...(subs.get(`${row.action.id}:${i + 1}`) ?? [])];
        const measured = MEASURES.reduce((acc, m) => {
          const xs = items.map((x) => x[m]).filter((x): x is number => x !== null);
          return acc + weights[m] * mean(xs);
        }, 0);
        return sum + c[i] * measured;
      }, surprise);
      return { action: row.action, score, considered: top.map(({ i }) => i + 1) };
    })
    .sort((a, b) => b.score - a.score);
}

/** The unshown action with the highest score, or null if none is scored. */
export function bestAction(weights: Weights) {
  return rankActions(weights)[0] ?? null;
}
