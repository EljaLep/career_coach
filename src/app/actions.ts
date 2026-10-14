"use server";

import { eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { bestAction, rankActions, Weights } from "@/best-action";
import { condense } from "@/condense";
import { loadConsiderations, readSlots, saveConsiderations } from "@/considerations";
import { db } from "@/db";
import { action, consideration, dataBlock } from "@/db/schema";
import { generateActions } from "@/generate-actions";
import { chooseGenerationState } from "@/generation-state";
import { judgeActions } from "@/judge-action";
import { foldSuggested } from "@/suggested-themes";
import { updateStatus } from "@/update-status";

/** Appends a prompt answer to the block in row 1 and advances the prompt cursor. */
export async function appendToBlock(text: string) {
  const body = z.string().trim().min(1).parse(text);
  console.log(`[prompt] Saving prompt answer (${body.length} chars) to the data block`);
  db.insert(dataBlock)
    .values({ id: 1, body, promptCursor: 1 })
    .onConflictDoUpdate({
      target: dataBlock.id,
      set: {
        body: sql`${dataBlock.body} || char(10) || char(10) || ${body}`,
        promptCursor: sql`${dataBlock.promptCursor} + 1`,
        updatedAt: sql`(unixepoch())`,
      },
    })
    .run();
}

/** All data rows (the prompt block, then reflections) joined into one text. */
function allData() {
  const rows = db.select().from(dataBlock).orderBy(dataBlock.id).all();
  return rows.map((r) => r.body).join("\n\n");
}

/**
 * The queue is every unshown action; its priority is the score, computed with the current
 * weights when an action is taken out.
 */
const unshown = () => db.select().from(action).where(isNull(action.shownAt)).all();

/** The weights the user last set, shown with a running update. */
let latestWeights: Weights | null = null;

/**
 * Re-ranks the queue with the weights the user just set. A running update picks them up too:
 * they are published for the UI.
 */
export async function rerankQueue(weights: Weights) {
  latestWeights = Weights.parse(weights);
  if (updateStatus.running) updateStatus.weights = latestWeights;
  const ranked = rankActions(latestWeights);
  console.log(`[queue] Weights changed; re-ranked ${ranked.length} queued action(s)`);
  for (const r of ranked.slice(0, 3)) console.log(`[queue]   + (${r.score.toFixed(3)}) ${r.action.text}`);
}

/**
 * The update currently running in the background, if any. Only one runs at a time. The latest
 * weights are published with its name for the UI.
 */
let running: Promise<void> | null = null;
function run(name: string, job: () => Promise<void>) {
  const started = Date.now();
  console.log(`[update] ===== ${name}: started =====`);
  updateStatus.running = name;
  updateStatus.weights = latestWeights;
  running = job()
    .then(() => console.log(`[update] ===== ${name}: finished in ${((Date.now() - started) / 1000).toFixed(1)} s =====`))
    .catch((e) => console.error(`[update] ===== ${name}: FAILED =====`, e))
    .finally(() => {
      running = null;
      updateStatus.running = null;
      updateStatus.weights = null;
    });
  return running;
}

/** The block where comments gather until the next Generate Ideas, if any. */
const pendingBlock = () => db.select().from(dataBlock).where(eq(dataBlock.pending, true)).get();

/**
 * Brings the considerations up to date. From scratch on the first run or when prompt answers
 * changed since the considerations were last saved; otherwise only the pending comments are
 * folded in. The pending block is then closed.
 */
async function updateConsiderations() {
  const pending = pendingBlock();
  const prompts = db.select().from(dataBlock).where(eq(dataBlock.id, 1)).get();
  const saved = db.select().from(consideration).where(eq(consideration.id, 1)).get();
  if (!saved || (prompts && prompts.updatedAt > saved.updatedAt)) {
    console.log("[update] Condensing all data into considerations from scratch");
    saveConsiderations(await condense(allData()));
  } else if (pending) {
    console.log("[update] Folding the gathered comments into the considerations");
    saveConsiderations(await condense(pending.body, loadConsiderations()));
  } else {
    console.log("[update] No new data; considerations unchanged");
  }
  if (pending) db.update(dataBlock).set({ pending: false }).where(eq(dataBlock.id, pending.id)).run();
}

/**
 * Generates new actions from the generation state, then (in parallel) folds them into the
 * suggested themes and judges every queued action against the current considerations. Finally
 * logs the queue size.
 */
async function explore() {
  const fresh = await generateActions(chooseGenerationState(allData()));
  await Promise.all([foldSuggested(fresh.map((a) => a.text)), judgeActions(readSlots(), unshown())]);
  console.log(`[queue] ${unshown().length} action(s) now queued`);
}

/** Takes the highest-scoring queued action out; waits for a running update only if the queue is empty. */
async function takeBest(weights: Weights) {
  let best = bestAction(weights);
  if (!best && running) {
    console.log("[queue] Queue is empty; waiting for the running update to finish");
    await running;
    best = bestAction(weights);
  }
  if (!best) {
    console.log("[queue] No scored action available to suggest");
    return null;
  }
  console.log(
    `[queue] Suggesting action ${best.action.id} (score ${best.score.toFixed(3)}, decided by considerations ${best.considered.join(" & ")}, surprisingness ${best.action.surprisingness?.toFixed(2) ?? "unscored"}): ${best.action.text}`,
  );
  db.update(action).set({ shownAt: new Date() }).where(eq(action.id, best.action.id)).run();
  return best.action.text;
}

/**
 * The only place model calls happen: brings the considerations up to date with the gathered
 * data, chooses a new random generation state, generates and judges new actions, then suggests
 * the best one. If the queue already has a scored action, the update runs in the background and
 * the answer comes at once: null (keep the shown suggestion) when `showing`, else the best queued
 * action.
 */
export async function generateIdeas(weights: Weights, showing: boolean) {
  latestWeights = Weights.parse(weights);
  console.log("[ideas] Generate Ideas pressed");
  // run() catches its own errors, so this never rejects.
  const update = (async () => {
    if (running) {
      console.log("[ideas] An update is running; waiting for it to finish first");
      await running;
    }
    await run("Generate Ideas", async () => {
      await updateConsiderations();
      await explore();
    });
  })();
  if (bestAction(latestWeights)) {
    console.log("[ideas] Queue has actions; updating in the background");
    return { suggestion: showing ? null : await takeBest(weights), considerations: readSlots() };
  }
  await update;
  return { suggestion: await takeBest(weights), considerations: readSlots() };
}

/**
 * The user's comment on a suggested action: appended to the pending block (no model calls) and
 * answered at once with the next action from the queue.
 */
export async function submitFeedback(suggestion: string, text: string, weights: Weights) {
  const opinion = z.string().trim().min(1).parse(text);
  Weights.parse(weights);
  const comment = `Suggested action: ${suggestion}\nMy opinion: ${opinion}`;
  const pending = pendingBlock();
  if (pending) {
    db.update(dataBlock)
      .set({ body: sql`${dataBlock.body} || char(10) || char(10) || ${comment}`, updatedAt: sql`(unixepoch())` })
      .where(eq(dataBlock.id, pending.id))
      .run();
  } else {
    db.insert(dataBlock).values({ body: comment, pending: true }).run();
  }
  console.log("[comment] Comment added to the pending block; it is processed on the next Generate Ideas");
  return { suggestion: await takeBest(weights), considerations: readSlots() };
}
