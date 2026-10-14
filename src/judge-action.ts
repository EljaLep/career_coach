import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { eq } from "drizzle-orm";
import { z } from "zod";
import type { Slot } from "@/considerations";
import { db } from "@/db";
import { action, effort, risk, subScore, valence } from "@/db/schema";

const MODEL = "claude-haiku-5-5";

/**
 * The three measures. Valence runs 0.0–1.0 with 1 as the favourable end. Effort runs
 * -1.0–1.0 from effortless to very demanding and risk from completely safe to severe risk;
 * whether effort and risk are wanted is the user's weight.
 */
const MEASURES = {
  effort: {
    table: effort,
    min: -1,
    definition: "how much effort the action takes with respect to the consideration (-1 = effortless, 0 = moderate effort, 1 = very demanding)",
  },
  valence: {
    table: valence,
    min: 0,
    definition: "whether the effect on the consideration is a cost or a benefit (0 = strongly costs, 0.5 = neutral, 1 = strongly benefits)",
  },
  risk: {
    table: risk,
    min: -1,
    definition: "how risky the action is for the consideration (-1 = completely safe, 0 = moderate risk, 1 = severe risk)",
  },
} as const;
type Measure = keyof typeof MEASURES;

const Judgement = z.object({
  actions: z.array(
    z.object({
      action: z.number().int(),
      scores: z.array(z.object({ item: z.string(), score: z.number() })),
    }),
  ),
});

const clamp = (n: number, min = 0) => Math.min(1, Math.max(min, n));

/**
 * One call: scores every action against all considerations and their subconsiderations on a
 * single measure, then saves it. Items are labelled "3" for a consideration, "3.2" for its subs.
 */
async function judgeMeasure(
  client: Anthropic,
  measure: Measure,
  slots: Slot[],
  actions: { id: number; text: string }[],
) {
  const { table, min, definition } = MEASURES[measure];
  const listedConsiderations = slots
    .flatMap((s, i) =>
      s.text ? [`${i + 1}. ${s.text}`, ...s.subs.map((sub, j) => `  ${i + 1}.${j + 1}. ${sub.text}`)] : [],
    )
    .join("\n");
  const subLabels = slots.flatMap((s, i) =>
    s.text ? s.subs.map((sub, j) => ({ label: `${i + 1}.${j + 1}`, id: sub.id })) : [],
  );
  const listedActions = actions.map((a) => `[${a.id}] ${a.text}`).join("\n");

  console.log(`[judge]   Scoring ${measure} for ${actions.length} action(s) against ${subLabels.length} subconsideration(s) and their considerations`);
  const response = await client.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    output_config: { effort: "low", format: zodOutputFormat(Judgement) },
    system: `You judge proposed career actions against a person's considerations and their subconsiderations on one measure: ${measure}. Score ${min.toFixed(1)} to 1.0: ${definition}.
Return every action by its id, each with one score per listed item by its label ("3" for a consideration, "3.2" for a subconsideration).`,
    messages: [
      {
        role: "user",
        content: `<considerations>\n${listedConsiderations}\n</considerations>\n\n<actions>\n${listedActions}\n</actions>`,
      },
    ],
  });

  console.log(`[judge]   ${measure} done: ${response.parsed_output?.actions.length ?? 0} action(s) scored`);
  for (const judged of response.parsed_output?.actions ?? []) {
    if (!actions.some((a) => a.id === judged.action)) continue;
    const byLabel = new Map(judged.scores.map((s) => [s.item.trim().replace(/\.$/, ""), s.score]));
    // Null where the consideration is empty or wasn't scored.
    const v = (i: number) => {
      const s = slots[i].text ? byLabel.get(`${i + 1}`) : undefined;
      return s === undefined ? null : clamp(s, min);
    };
    const values = { slot1: v(0), slot2: v(1), slot3: v(2), slot4: v(3), slot5: v(4), slot6: v(5), slot7: v(6) };
    db.insert(table)
      .values({ actionId: judged.action, ...values })
      .onConflictDoUpdate({ target: table.actionId, set: values })
      .run();

    for (const { label, id } of subLabels) {
      const s = byLabel.get(label);
      if (s === undefined) continue;
      const set: Partial<Record<Measure, number>> = { [measure]: clamp(s, min) };
      db.insert(subScore)
        .values({ actionId: judged.action, subconsiderationId: id, ...set })
        .onConflictDoUpdate({ target: [subScore.actionId, subScore.subconsiderationId], set })
        .run();
    }
  }
}

const Surprise = z.object({
  actions: z.array(z.object({ action: z.number().int(), score: z.number() })),
});

/** One call: scores how unpredictable each action is for this person as a whole, then saves it. */
async function judgeSurprise(client: Anthropic, slots: Slot[], actions: { id: number; text: string }[]) {
  const profile = slots
    .flatMap((s) => (s.text ? [`- ${s.text}`, ...s.subs.map((sub) => `  - ${sub.text}`)] : []))
    .join("\n");
  const listedActions = actions.map((a) => `[${a.id}] ${a.text}`).join("\n");

  console.log(`[judge]   Scoring surprisingness for ${actions.length} action(s)`);
  const response = await client.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    output_config: { format: zodOutputFormat(Surprise) },
    system: `You judge proposed career actions for a person on one measure: surprisingness. Score 0.0 to 1.0: how unpredictable the idea is given the person's profile (0 = the obvious next step anyone would suggest, 1 = an unconventional idea they would hardly think of themselves).
Return every action by its id with one score.`,
    messages: [
      {
        role: "user",
        content: `<profile>\n${profile}\n</profile>\n\n<actions>\n${listedActions}\n</actions>`,
      },
    ],
  });

  console.log(`[judge]   surprisingness done: ${response.parsed_output?.actions.length ?? 0} action(s) scored`);
  for (const judged of response.parsed_output?.actions ?? []) {
    if (!actions.some((a) => a.id === judged.action)) continue;
    db.update(action).set({ surprisingness: clamp(judged.score) }).where(eq(action.id, judged.action)).run();
  }
}

/** Actions per judge call; more would overflow max_tokens (about 28 scores per action). */
const BATCH = 10;

/**
 * Scores the actions against the considerations and subconsiderations (one call per measure)
 * and on surprisingness (one call), in batches of BATCH actions, all in parallel.
 */
export async function judgeActions(slots: Slot[], actions: { id: number; text: string }[]) {
  if (!actions.length) return;
  const batches = Array.from({ length: Math.ceil(actions.length / BATCH) }, (_, i) =>
    actions.slice(i * BATCH, (i + 1) * BATCH),
  );
  console.log(
    `[judge] Judging ${actions.length} queued action(s) on effort, valence, risk and surprisingness (${batches.length} batch(es) × 4 Haiku calls in parallel)`,
  );
  const client = new Anthropic();
  await Promise.all(
    batches.flatMap((batch) => [
      ...(Object.keys(MEASURES) as Measure[]).map((m) => judgeMeasure(client, m, slots, batch)),
      judgeSurprise(client, slots, batch),
    ]),
  );
}
