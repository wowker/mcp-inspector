import type { RunEvent } from "./run-types.js";

export type RunEventListener = (event: RunEvent) => void;

export class RunEventBus {
  private readonly listeners = new Map<string, Set<RunEventListener>>();

  publish(event: RunEvent): void {
    for (const listener of this.listeners.get(event.runId) ?? []) {
      try { listener(event); } catch { /* A subscriber cannot affect committed trace data. */ }
    }
  }

  subscribe(runId: string, listener: RunEventListener): () => void {
    const listeners = this.listeners.get(runId) ?? new Set<RunEventListener>();
    listeners.add(listener); this.listeners.set(runId, listeners);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) this.listeners.delete(runId);
    };
  }

  subscriberCount(runId: string): number { return this.listeners.get(runId)?.size ?? 0; }
}
