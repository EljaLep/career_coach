import { eq } from "drizzle-orm";
import type { Considerations } from "@/condense";
import { db } from "@/db";
import { consideration, subconsideration } from "@/db/schema";

/** One of the 7 consideration slots with its subconsiderations; text is null when the slot is empty. */
export type Slot = { text: string | null; subs: { id: number; text: string }[] };

/** The 7 slots as stored. */
export function readSlots(): Slot[] {
  const row = db.select().from(consideration).where(eq(consideration.id, 1)).get();
  const texts = row
    ? [row.slot1, row.slot2, row.slot3, row.slot4, row.slot5, row.slot6, row.slot7]
    : Array<string | null>(7).fill(null);
  const subs = db.select().from(subconsideration).orderBy(subconsideration.id).all();
  return texts.map((text, i) => ({
    text,
    subs: subs.filter((s) => s.slot === i + 1).map(({ id, text }) => ({ id, text })),
  }));
}

/** Saves considerations into the 7 slots and replaces all subconsiderations. */
export function saveConsiderations(result: Considerations) {
  console.log("[considerations] Saving the updated considerations:");
  for (const [i, x] of result.considerations.slice(0, 7).entries()) {
    console.log(`[considerations]   ${i + 1}. ${x.text}`);
    for (const sub of x.subconsiderations.slice(0, 3)) console.log(`[considerations]      - ${sub}`);
  }
  // Empty slots are stored as null so a shorter result clears old values.
  const c = result.considerations.slice(0, 7);
  const slots = {
    slot1: c[0]?.text ?? null,
    slot2: c[1]?.text ?? null,
    slot3: c[2]?.text ?? null,
    slot4: c[3]?.text ?? null,
    slot5: c[4]?.text ?? null,
    slot6: c[5]?.text ?? null,
    slot7: c[6]?.text ?? null,
    updatedAt: new Date(),
  };
  const subs = c.flatMap((x, i) => x.subconsiderations.slice(0, 3).map((text) => ({ slot: i + 1, text })));
  db.transaction((tx) => {
    tx.insert(consideration)
      .values({ id: 1, ...slots })
      .onConflictDoUpdate({ target: consideration.id, set: slots })
      .run();
    // Old sub scores go with them (cascade); they are re-judged afterwards.
    tx.delete(subconsideration).run();
    if (subs.length) tx.insert(subconsideration).values(subs).run();
  });
}

/** Reads the saved considerations back as the starting state for an update. */
export function loadConsiderations(): Considerations {
  return {
    considerations: readSlots().flatMap((s) =>
      s.text ? [{ text: s.text, subconsiderations: s.subs.map((x) => x.text) }] : [],
    ),
  };
}
