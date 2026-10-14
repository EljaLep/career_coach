import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { suggestedThemes } from "@/db/schema";

const MODEL = "claude-haiku-5-5";

const Themes = z.object({ themes: z.array(z.string()) });

const SYSTEM = `You keep a condensed record of the kinds of career actions already suggested to a person, so that future suggestions can explore new directions.

The record is a list of at most 10 general themes, each no longer than 10 words (for example "Asking professors and mentors for advice").

You receive the current list and newly suggested actions. Return the full updated list:
- Every suggested action, old and new, must fall under one of the themes.
- Generalise, merge or add themes as needed. Describe the kind of action, not its details.
- Never exceed 10.`;

/** The themes of the actions suggested so far. */
export function loadThemes(): string[] {
  return db.select().from(suggestedThemes).where(eq(suggestedThemes.id, 1)).get()?.themes ?? [];
}

/** Folds newly generated actions into the themes and saves them. */
export async function foldSuggested(actions: string[]) {
  if (!actions.length) return;
  const current = loadThemes();
  console.log(`[themes] Folding ${actions.length} new action(s) into ${current.length} suggested theme(s) (Haiku)`);
  const client = new Anthropic();
  const response = await client.messages.parse({
    model: MODEL,
    max_tokens: 8000,
    output_config: { effort: "low", format: zodOutputFormat(Themes) },
    system: SYSTEM,
    messages: [
      {
        role: "user",
        content: [
          `<current_themes>\n${current.map((t) => `- ${t}`).join("\n") || "(none)"}\n</current_themes>`,
          `<new_actions>\n${actions.map((a) => `- ${a}`).join("\n")}\n</new_actions>`,
        ].join("\n\n"),
      },
    ],
  });

  const themes = response.parsed_output?.themes.slice(0, 10);
  if (!themes) return;
  const values = { themes, updatedAt: new Date() };
  db.insert(suggestedThemes)
    .values({ id: 1, ...values })
    .onConflictDoUpdate({ target: suggestedThemes.id, set: values })
    .run();
  console.log("[themes] Suggested themes now:");
  for (const t of themes) console.log(`[themes]   - ${t}`);
}
