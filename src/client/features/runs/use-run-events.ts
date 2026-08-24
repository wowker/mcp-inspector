import { useEffect, useState } from "react";
import { decodeRunEvent, type InspectorApiClient, type RunDetail, type RunEvent } from "../../api/api-client.js";

const terminal = new Set(["succeeded", "failed", "cancelled", "interrupted"]);
const statuses = new Set(["queued", "connecting", "authorizing", "running", ...terminal]);
const delays = [250, 500, 1_000, 2_000];

async function wait(milliseconds: number, signal: AbortSignal): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const aborted = () => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => { signal.removeEventListener("abort", aborted); resolve(); }, milliseconds);
    signal.addEventListener("abort", aborted, { once: true });
  });
}

export async function consumeRunEventStream(response: Response, runId: string, signal: AbortSignal,
  onEvent: (event: RunEvent) => void): Promise<void> {
  if (response.body === null) throw new Error("Run event stream has no body");
  const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = "";
  try {
    while (!signal.aborted) {
      const chunk = await reader.read(); if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true }); buffer = buffer.replaceAll("\r\n", "\n");
      let boundary = buffer.indexOf("\n\n");
      while (boundary >= 0) {
        const frame = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 2);
        const data = frame.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5).replace(/^ /, "")).join("\n");
        if (data.length > 0) onEvent(decodeRunEvent(JSON.parse(data) as unknown, runId));
        boundary = buffer.indexOf("\n\n");
      }
    }
  } finally { try { await reader.cancel(); } catch { /* already closed */ } }
}

export interface RunEventState { run: RunDetail | null; error: string | null; observing: boolean }
export function useRunEvents(api: InspectorApiClient, projectId: string, runId: string | null): RunEventState {
  const [state, setState] = useState<RunEventState>({ run: null, error: null, observing: false });
  useEffect(() => {
    const controller = new AbortController(); let current = true;
    setState({ run: null, error: null, observing: runId !== null });
    if (runId === null) return () => controller.abort();
    void (async () => {
      let cursor = 0; let attempt = 0;
      try {
        let authoritative = await api.getRun(projectId, runId); if (!current) return;
        cursor = authoritative.events.at(-1)?.sequence ?? 0; setState({ run: authoritative, error: null, observing: !terminal.has(authoritative.status) });
        while (current && !terminal.has(authoritative.status)) {
          const streamController = new AbortController();
          const abortStream = () => streamController.abort(controller.signal.reason);
          controller.signal.addEventListener("abort", abortStream, { once: true });
          let terminalSeen = false;
          try {
            const response = await api.openRunEventStream(projectId, runId, cursor, streamController.signal);
            authoritative = await api.getRun(projectId, runId); if (!current) return;
            cursor = Math.max(cursor, authoritative.events.at(-1)?.sequence ?? 0);
            setState({ run: authoritative, error: null, observing: !terminal.has(authoritative.status) });
            if (terminal.has(authoritative.status)) { controller.abort(); return; }
            await consumeRunEventStream(response, runId, controller.signal, (event) => {
              if (!current || event.sequence <= cursor) return; cursor = event.sequence;
              const payload = typeof event.payload === "object" && event.payload !== null && !Array.isArray(event.payload)
                ? event.payload as Record<string, unknown> : null;
              const eventStatus = event.kind === "run-status" && typeof payload?.status === "string" && statuses.has(payload.status)
                ? payload.status as RunDetail["status"] : null;
              if (eventStatus !== null && terminal.has(eventStatus)) { terminalSeen = true; streamController.abort(); }
              setState((previous) => {
                if (previous.run === null || previous.run.id !== runId) return previous;
                return { ...previous, run: { ...previous.run, status: eventStatus ?? previous.run.status,
                  events: [...previous.run.events.filter((item) => item.sequence !== event.sequence), event].sort((a, b) => a.sequence - b.sequence) } };
              });
            });
            if (!current) return;
            authoritative = await api.getRun(projectId, runId); if (!current) return;
            cursor = Math.max(cursor, authoritative.events.at(-1)?.sequence ?? 0);
            setState({ run: authoritative, error: null, observing: !terminal.has(authoritative.status) });
            if (terminal.has(authoritative.status)) return;
            throw new Error("Run event stream ended");
          } catch (cause) {
            if (!current || controller.signal.aborted) return;
            if (terminalSeen) {
              try { authoritative = await api.getRun(projectId, runId); if (!current) return;
                cursor = Math.max(cursor, authoritative.events.at(-1)?.sequence ?? 0);
                setState({ run: authoritative, error: null, observing: !terminal.has(authoritative.status) });
                if (terminal.has(authoritative.status)) return;
              } catch (terminalCause) { cause = terminalCause; }
            }
            setState((previous) => ({ ...previous, error: cause instanceof Error ? cause.message : "运行事件连接中断", observing: true }));
            await wait(delays[Math.min(attempt, delays.length - 1)]!, controller.signal); attempt += 1;
          } finally { controller.signal.removeEventListener("abort", abortStream); streamController.abort(); }
        }
      } catch (cause) {
        if (current && !controller.signal.aborted) setState({ run: null, error: cause instanceof Error ? cause.message : "加载运行失败", observing: false });
      }
    })();
    return () => { current = false; controller.abort(); };
  }, [api, projectId, runId]);
  return state;
}
