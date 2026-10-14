import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import type { Slot } from "@/considerations";
import { db } from "@/db";
import { action } from "@/db/schema";
import type { GenerationState } from "@/generation-state";

const MODEL = "claude-opus-5-5";

const Ideas = z.object({ ideas: z.array(z.string()) });

/** Considerations as text, each with its subconsiderations indented under it. */
function profile(slots: Slot[]) {
  return slots.flatMap((s) => [`- ${s.text}`, ...s.subs.map((sub) => `  - ${sub.text}`)]).join("\n");
}

/** Generates 10 actions into the db from the generation state. */
export async function generateActions(state: GenerationState) {
  const client = new Anthropic();
  console.log("[generate] Generating 10 new actions (Opus, high effort) from the generation state:");
  for (const c of state.considerations) console.log(`[generate]   consideration: ${c.text}`);
  for (const p of state.passages) console.log(`[generate]   passage: ${p.replace(/\s+/g, " ").slice(0, 100)}…`);
  console.log(`[generate]   ${state.themes.length} theme(s) already suggested`);

  const started = Date.now();
  const response = await client.beta.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    output_config: { effort: "high", format: betaZodOutputFormat(Ideas) },
    // On a safety decline, the API re-runs the request on a fallback model.
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system:
      "You propose concrete career actions. Each idea is a brief, specific action described in two sentences: what to do, and why it fits this person.\nVary how predictable the ideas are: at least 3 should be fairly obvious next steps for this person, and at least 3 should be unconventional ideas they would hardly think of themselves.\nYou see a random selection of the person's considerations and of passages they wrote. Dig deep into what you are shown rather than trying to cover the whole person, and ground the ideas in its specifics (their field, skills, places, people, projects, numbers). Passages with their opinions on earlier suggestions show what they liked and rejected, and why: build on the former and steer clear of the latter.\nThe themes of actions already suggested are listed; propose actions in new directions, not more of the same.",
    messages: [
      {
        role: "user",
        content: [
          `<considerations>\n${profile(state.considerations) || "(none)"}\n</considerations>`,
          `<passages>\n${state.passages.join("\n\n") || "(none)"}\n</passages>`,
          `<already_suggested_themes>\n${state.themes.map((t) => `- ${t}`).join("\n") || "(none)"}\n</already_suggested_themes>`,
          "Propose 10 new action ideas for this person.",
        ].join("\n\n"),
      },
    ],
  });

  const ideas = response.parsed_output?.ideas ?? [];
  const { input_tokens, output_tokens } = response.usage;
  console.log(
    `[generate] Got ${ideas.length} action(s) in ${((Date.now() - started) / 1000).toFixed(1)} s (${input_tokens} input / ${output_tokens} output tokens, ≈ $${((input_tokens * 4 + output_tokens * 20) / 1e6).toFixed(3)})`,
  );
  for (const idea of ideas) console.log(`[generate]   - ${idea}`);
  if (!ideas.length) return [];
  return db.insert(action).values(ideas.map((text) => ({ text }))).returning().all();
}
