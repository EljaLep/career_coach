import type { Weights } from "@/best-action";
import type { GenerationState } from "@/generation-state";

/** What the background update is doing, shared by the server actions and the status route. */
export type UpdateStatus = {
  /** Name of the running update, or null when idle. */
  running: string | null;
  /** The weights the user last set, shown while an update runs. */
  weights: Weights | null;
};

/** What the status route returns. */
export type ServerStatus = UpdateStatus & { queued: number; waiting: number; generation: GenerationState | null };

// Kept on globalThis so every module instance (and dev hot reloads) sees the same status.
const g = globalThis as unknown as { updateStatus?: UpdateStatus };
export const updateStatus: UpdateStatus = (g.updateStatus ??= { running: null, weights: null });
