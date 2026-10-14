import { count, eq, isNull } from "drizzle-orm";
import { connection } from "next/server";
import { db } from "@/db";
import { action, dataBlock } from "@/db/schema";
import { readGenerationState } from "@/generation-state";
import { updateStatus, type ServerStatus } from "@/update-status";

/**
 * The running update, the number of queued actions, the number of comments waiting for the next
 * Generate Ideas and the generation state, polled by the UI.
 */
export async function GET() {
  // In-memory state and the db; defer to request time so it isn't prerendered.
  await connection();
  const queued = db.select({ n: count() }).from(action).where(isNull(action.shownAt)).get()?.n ?? 0;
  const pending = db.select().from(dataBlock).where(eq(dataBlock.pending, true)).get();
  const waiting = pending?.body.match(/^Suggested action: /gm)?.length ?? 0;
  return Response.json({ ...updateStatus, queued, waiting, generation: readGenerationState() } satisfies ServerStatus);
}
