"use client";

import { useEffect, useState } from "react";
import type { Slot } from "@/considerations";
import type { ServerStatus } from "@/update-status";

const METRICS = ["volatility", "valence", "risk", "surprisingness"] as const;

/** Polls the server status (background update, queue size, generation state) every second. */
export function useServerStatus() {
  const [status, setStatus] = useState<ServerStatus>({ running: null, weights: null, queued: 0, waiting: 0, generation: null });

  useEffect(() => {
    let active = true;
    async function poll() {
      const res = await fetch("/api/status", { cache: "no-store" });
      if (active) setStatus(await res.json());
    }
    poll();
    const timer = setInterval(poll, 1000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);

  return status;
}

/**
 * Shows the number of queued actions and of comments waiting for Generate Ideas. While an update runs, shows that it is in progress and the
 * weights it ranks with; otherwise "Waiting for data".
 */
export function GenerationStatus({ status, considerations }: { status: ServerStatus; considerations: Slot[] }) {
  const { running, weights, queued, waiting } = status;
  return (
    <section className="mt-8 rounded-xl border border-zinc-200 p-3 text-sm dark:border-zinc-800">
      <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-zinc-500">
        <span className={`h-2 w-2 rounded-full ${running ? "animate-pulse bg-emerald-500" : "bg-zinc-300 dark:bg-zinc-700"}`} />
        Generation
      </h2>
      <p className="mt-2 text-xs text-zinc-500">
        Actions in queue: <span className="tabular-nums text-zinc-700 dark:text-zinc-300">{queued}</span>
      </p>
      <p className="text-xs text-zinc-500">
        Comments waiting: <span className="tabular-nums text-zinc-700 dark:text-zinc-300">{waiting}</span>
      </p>
      {!running ? (
        <p className="mt-2 text-zinc-400">Waiting for data</p>
      ) : (
        <>
          <p className="mt-2 animate-pulse text-zinc-700 dark:text-zinc-300">{running}…</p>
          {weights && (
            <>
              <h3 className="mt-3 text-xs font-medium text-zinc-500">Consideration weights</h3>
              <ul className="mt-1 space-y-0.5 text-xs">
                {considerations.map((c, i) =>
                  c.text ? (
                    <li key={i} className="flex justify-between gap-2">
                      <span className="truncate text-zinc-600 dark:text-zinc-400">{i + 1}. {c.text}</span>
                      <span className="tabular-nums text-zinc-700 dark:text-zinc-300">{weights.considerations[i].toFixed(2)}</span>
                    </li>
                  ) : null,
                )}
              </ul>
              <h3 className="mt-3 text-xs font-medium text-zinc-500">Metric weights</h3>
              <ul className="mt-1 space-y-0.5 text-xs">
                {METRICS.map((m) => (
                  <li key={m} className="flex justify-between gap-2">
                    <span className="capitalize text-zinc-600 dark:text-zinc-400">{m}</span>
                    <span className="tabular-nums text-zinc-700 dark:text-zinc-300">{weights[m].toFixed(2)}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </section>
  );
}

/** The information the action generator is shown. Re-chosen only by Generate Ideas. */
export function GenerationStateBox({ state }: { state: ServerStatus["generation"] }) {
  return (
    <section className="mt-8 rounded-xl border border-zinc-200 p-4 text-sm dark:border-zinc-800">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">Generation state</h2>
      {!state ? (
        <p className="mt-2 text-zinc-400">No state yet. Press Generate Ideas to choose one.</p>
      ) : (
        <>
          <h3 className="mt-3 text-xs font-medium text-zinc-500">Considerations</h3>
          <ul className="mt-1 space-y-1">
            {state.considerations.map((c, i) => (
              <li key={i} className="text-zinc-700 dark:text-zinc-300">
                {c.text}
                {c.subs.length > 0 && (
                  <ul className="mt-0.5 space-y-0.5 text-xs text-zinc-500">
                    {c.subs.map((s) => (
                      <li key={s.id}>– {s.text}</li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
          <h3 className="mt-3 text-xs font-medium text-zinc-500">Passages</h3>
          <ul className="mt-1 max-h-64 space-y-2 overflow-y-auto">
            {state.passages.map((p, i) => (
              <li key={i} className="whitespace-pre-wrap border-l-2 border-zinc-200 pl-2 text-xs text-zinc-600 dark:border-zinc-700 dark:text-zinc-400">
                {p}
              </li>
            ))}
          </ul>
          <h3 className="mt-3 text-xs font-medium text-zinc-500">Already suggested themes</h3>
          {state.themes.length ? (
            <ul className="mt-1 space-y-0.5 text-xs text-zinc-600 dark:text-zinc-400">
              {state.themes.map((t, i) => (
                <li key={i}>– {t}</li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-xs text-zinc-400">None yet</p>
          )}
        </>
      )}
    </section>
  );
}
