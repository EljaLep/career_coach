import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";

const MODEL = "claude-haiku-5-5";

export const Considerations = z.object({
  considerations: z.array(z.object({ text: z.string(), subconsiderations: z.array(z.string()) })),
});
export type Considerations = z.infer<typeof Considerations>;

const SYSTEM = `You maintain a structured summary of what a person has written about their life goals, capabilities and resources, for career planning.

The summary is a list of at most 7 considerations, each with at most 3 subconsiderations: more specific points that belong under it. You decide what each one covers and how to word it.

Subconsiderations should also capture what the person does not want: things they reject, avoid or refuse to do. These mostly show up in their opinions on suggested actions ("Suggested action: …" followed by "My opinion: …"); when an opinion rejects an action or part of it, record the reason as a subconsideration under the consideration it concerns.

You receive the current summary, the two previous sentences for context, and up to three new sentences. Return the full updated summary:
- Fold the new sentences' information into the list however you judge best: refine, merge, replace or add considerations.
- Never exceed 7. Once full, keep the 7 that matter most.
- If the new sentences add nothing relevant, return the summary unchanged.

Each item should be no longer than 10 words long. Keep the considerations fairly general; the subconsiderations carry the specifics.`;

/** Splits the block into sentences (line breaks also end a sentence). */
function sentences(text: string): string[] {
  const seg = new Intl.Segmenter("en", { granularity: "sentence" });
  return text
    .split(/\n+/)
    .flatMap((line) => [...seg.segment(line)].map((s) => s.segment.trim()))
    .filter(Boolean);
}

const STEP = 3;

/**
 * Walks the block three sentences at a time, updating the considerations each step.
 * Pass existing considerations as `initial` to fold a new block into them.
 */
export async function condense(
  block: string,
  initial: Considerations = { considerations: [] },
): Promise<Considerations> {
  const client = new Anthropic();
  const all = sentences(block);
  let state = initial;
  const steps = Math.ceil(all.length / STEP);
  console.log(`[condense] Condensing ${all.length} sentence(s) in ${steps} step(s) of ${STEP} (Haiku)`);

  for (let i = 0; i < all.length; i += STEP) {
    console.log(`[condense]   Step ${i / STEP + 1}/${steps}`);
    const previous = all.slice(Math.max(0, i - 2), i);
    const current = all.slice(i, i + STEP);
    const response = await client.messages.parse({
      model: MODEL,
      max_tokens: 8000,
      output_config: { effort: "low", format: zodOutputFormat(Considerations) },
      system: SYSTEM,
      messages: [
        {
          role: "user",
          content: [
            `<current_summary>\n${JSON.stringify(state, null, 2)}\n</current_summary>`,
            `<previous_sentences>\n${previous.join("\n") || "(none)"}\n</previous_sentences>`,
            `<new_sentences>\n${current.join("\n")}\n</new_sentences>`,
          ].join("\n\n"),
        },
      ],
    });
    if (response.parsed_output) state = response.parsed_output;
  }

  return state;
}
