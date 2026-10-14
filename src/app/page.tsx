import { eq } from "drizzle-orm";
import { connection } from "next/server";
import { Suspense } from "react";
import { readSlots } from "@/considerations";
import { db } from "@/db";
import { dataBlock } from "@/db/schema";
import { PromptBox } from "./prompt-box";

export default function Home() {
  return (
    <Suspense>
      <Box />
    </Suspense>
  );
}

async function Box() {
  // better-sqlite3 is synchronous; defer to request time so it isn't prerendered.
  await connection();
  const block = db.select().from(dataBlock).where(eq(dataBlock.id, 1)).get();
  return <PromptBox start={block?.promptCursor ?? 0} initialConsiderations={readSlots()} />;
}
