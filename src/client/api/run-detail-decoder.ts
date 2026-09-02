import type { RunDetail } from "../../shared/run-replay.js";

export const RUN_DETAIL_WORKER_THRESHOLD_BYTES = 512 * 1024;

interface WorkerResponse {
  ok: boolean;
  run?: RunDetail;
  error?: string;
}

function workerSupported(): boolean {
  return typeof Worker === "function";
}

export async function decodeLargeRunDetail(source: ArrayBuffer, projectId: string, runId: string): Promise<RunDetail | null> {
  if (source.byteLength < RUN_DETAIL_WORKER_THRESHOLD_BYTES || !workerSupported()) return null;
  const worker = new Worker(new URL("./run-detail-worker.ts", import.meta.url), { type: "module", name: "run-detail-decoder" });
  try {
    return await new Promise<RunDetail>((resolve, reject) => {
      worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
        if (event.data.ok && event.data.run !== undefined) resolve(event.data.run);
        else reject(new Error(event.data.error ?? "Invalid Run response"));
      };
      worker.onerror = () => reject(new Error("Invalid Run response"));
      worker.postMessage({ source, projectId, runId }, [source]);
    });
  } finally {
    worker.terminate();
  }
}
