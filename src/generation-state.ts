import { eq } from "drizzle-orm";
import { readSlots, type Slot } from "@/considerations";
import { db } from "@/db";
import { generationState } from "@/db/schema";
import { loadThemes } from "@/suggested-themes";

/** How much of the information the generator sees, chosen at random. */
const SHOWN_CONSIDERATIONS = 3;
const SHOWN_PASSAGES = 6;

/**
 * What the action generator is shown: the chosen considerations (current wording, with their
 * subconsiderations), the chosen passages, and the themes of the actions suggested so far.
 */
export type GenerationState = { considerations: Slot[]; passages: string[]; themes: string[] };

/** n items picked at random, kept in their original order. */
function sample<T>(items: T[], n: number): T[] {
  const indices = items.map((_, i) => i);
  for (let i = indices.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }
  return indices.slice(0, n).sort((a, b) => a - b).map((i) => items[i]);
}

/**
 * Picks a new random selection of considerations and passages of the writing (prompt answers and
 * opinions on suggested actions, split on blank lines), saves it and returns the full state.
 */
export function chooseGenerationState(writing: string): GenerationState {
  const filled = readSlots()
    .map((s, i) => ({ s, slot: i + 1 }))
    .filter(({ s }) => s.text);
  const values = {
    slots: sample(filled, SHOWN_CONSIDERATIONS).map(({ slot }) => slot),
    passages: sample(writing.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean), SHOWN_PASSAGES),
    updatedAt: new Date(),
  };
  db.insert(generationState)
    .values({ id: 1, ...values })
    .onConflictDoUpdate({ target: generationState.id, set: values })
    .run();
  console.log(`[state] Chose a new generation state: considerations ${values.slots.join(", ")} and ${values.passages.length} passage(s)`);
  return readGenerationState()!;
}

/** The saved state, with the chosen considerations in their current wording; null if none chosen yet. */
export function readGenerationState(): GenerationState | null {
  const row = db.select().from(generationState).where(eq(generationState.id, 1)).get();
  if (!row) return null;
  const slots = readSlots();
  return {
    // A slot emptied by a later condense drops out.
    considerations: row.slots.map((n) => slots[n - 1]).filter((s) => s?.text),
    passages: row.passages,
    themes: loadThemes(),
  };
}
