"use client";

import { useState, useTransition } from "react";
import type { Weights } from "@/best-action";
import type { Slot } from "@/considerations";
import { FINAL_PROMPT, PROMPTS } from "@/prompts";
import { appendToBlock, generateIdeas, submitFeedback } from "./actions";
import { GenerationStateBox, GenerationStatus, useServerStatus } from "./generation-status";

const MEASURES = ["volatility", "valence", "risk", "surprisingness"] as const;

/** Measures whose weight runs -1–1, with labels for the two ends of the slider. */
const ENDS = { volatility: ["stable", "upheaval"], risk: ["safe", "risky"] } as const;

/** A weight slider, 0–1 unless another minimum is given. */
function Slider({
  value,
  onChange,
  label,
  min = 0,
}: {
  value: number;
  onChange: (v: number) => void;
  label: string;
  min?: number;
}) {
  return (
    <input
      type="range"
      min={min}
      max={1}
      step={0.05}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      aria-label={label}
      className="w-20 shrink-0 accent-zinc-700"
    />
  );
}

/** One box with a prompt above it; the prompt advances on each submit. The 7 considerations sit on the left. */
export function PromptBox({
  start,
  initialConsiderations,
}: {
  start: number;
  initialConsiderations: Slot[];
}) {
  const [index, setIndex] = useState(start);
  const [text, setText] = useState("");
  const [pending, startTransition] = useTransition();
  const [thinking, startThinking] = useTransition();
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const [considerations, setConsiderations] = useState(initialConsiderations);
  const [weights, setWeights] = useState<Weights>({
    considerations: Array(7).fill(1),
    volatility: 0, // appetite for change: -1 prefers stable, 1 prefers upheaval
    valence: 1,
    risk: 0, // risk appetite: -1 prefers safe, 1 prefers risky
    surprisingness: 1,
  });
  const setConsiderationWeight = (i: number, v: number) =>
    setWeights((w) => ({ ...w, considerations: w.considerations.map((x, j) => (j === i ? v : x)) }));
  const prompt = PROMPTS[index] ?? FINAL_PROMPT;
  const status = useServerStatus();

  function submit() {
    if (!text.trim() || pending || thinking) return;
    // Action suggestion phase: the text is the user's opinion on the suggestion.
    if (suggestion) {
      startThinking(async () => {
        const next = await submitFeedback(suggestion, text, weights);
        setText("");
        setSuggestion(next.suggestion);
        setConsiderations(next.considerations);
      });
      return;
    }
    startTransition(async () => {
      await appendToBlock(text);
      setText("");
      setSuggestion(null);
      setIndex((i) => i + 1);
    });
  }

  function generate() {
    startThinking(async () => {
      setSuggestion(null);
      const next = await generateIdeas(weights);
      setSuggestion(next.suggestion);
      setConsiderations(next.considerations);
    });
  }

  return (
    <div className="flex w-full max-w-7xl gap-10">
      <aside className="w-80 shrink-0">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">Considerations</h2>
        <ol className="mt-3 space-y-2 text-sm">
          {considerations.map((c, i) => (
            <li key={i} className="flex items-start gap-2">
              <span className="text-zinc-400">{i + 1}.</span>
              <div className="flex-1">
                <span className={c.text ? "text-zinc-700 dark:text-zinc-300" : "text-zinc-400"}>{c.text ?? "—"}</span>
                {c.text && c.subs.length > 0 && (
                  <ul className="mt-1 space-y-0.5 text-xs text-zinc-500">
                    {c.subs.map((s) => (
                      <li key={s.id}>– {s.text}</li>
                    ))}
                  </ul>
                )}
              </div>
              <Slider
                value={weights.considerations[i]}
                onChange={(v) => setConsiderationWeight(i, v)}
                label={`Weight of consideration ${i + 1}`}
              />
            </li>
          ))}
        </ol>
      </aside>

      <div className="w-full max-w-2xl">
        <div className="mb-4 min-h-24">
          {thinking ? (
            <h1 className="animate-pulse text-xl font-semibold tracking-tight text-zinc-500">Thinking…</h1>
          ) : suggestion ? (
            <>
              <h1 className="text-xl font-semibold tracking-tight">Suggested action</h1>
              <p className="mt-2 text-zinc-600 dark:text-zinc-400">{suggestion}</p>
              <p className="mt-1 text-sm italic text-zinc-400">
                What do you think of this suggestion? Elaborate on your opinion.
              </p>
            </>
          ) : (
            <>
              <h1 className="text-xl font-semibold tracking-tight">{prompt.title}</h1>
              <p className="mt-2 text-zinc-600 dark:text-zinc-400">{prompt.body}</p>
              {prompt.hint && <p className="mt-1 text-sm italic text-zinc-400">{prompt.hint}</p>}
            </>
          )}
        </div>

        <form onSubmit={(e) => { e.preventDefault(); submit(); }}>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); submit(); }
            }}
            autoFocus
            rows={8}
            disabled={pending || thinking}
            placeholder="Write freely…"
            className="w-full resize-y rounded-xl border border-zinc-300 bg-white p-4 text-base leading-relaxed outline-none focus:border-zinc-500 focus:ring-4 focus:ring-zinc-200 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900 dark:focus:ring-zinc-800"
          />
          <div className="mt-3 flex items-center justify-between text-xs text-zinc-400">
            <span>{!suggestion && index < PROMPTS.length ? `${index + 1} / ${PROMPTS.length}` : ""}</span>
            <div className="flex items-center gap-3">
              <span>Ctrl + Enter</span>
              <button
                type="button"
                onClick={generate}
                disabled={pending || thinking}
                className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                Generate Ideas
              </button>
              <button
                type="submit"
                disabled={pending || thinking || !text.trim()}
                className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900"
              >
                Submit
              </button>
            </div>
          </div>
        </form>
        <GenerationStateBox state={status.generation} />
      </div>

      <aside className="w-56 shrink-0">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">Weights</h2>
        <ul className="mt-3 space-y-2 text-sm">
          {MEASURES.map((m) => (
            <li key={m}>
              <div className="flex items-center justify-between gap-2">
                <span className="capitalize text-zinc-700 dark:text-zinc-300">{m}</span>
                <Slider
                  value={weights[m]}
                  onChange={(v) => setWeights((w) => ({ ...w, [m]: v }))}
                  label={`Weight of ${m}`}
                  min={m in ENDS ? -1 : 0}
                />
              </div>
              {m in ENDS && (
                <div className="ml-auto flex w-20 justify-between text-[10px] text-zinc-400">
                  <span>{ENDS[m as keyof typeof ENDS][0]}</span>
                  <span>{ENDS[m as keyof typeof ENDS][1]}</span>
                </div>
              )}
            </li>
          ))}
        </ul>
        <GenerationStatus status={status} considerations={considerations} />
      </aside>
    </div>
  );
}
