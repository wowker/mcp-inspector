import { runDetailSchema } from "../../shared/run-replay.js";

interface DecodeRequest {
  source: ArrayBuffer;
  projectId: string;
  runId: string;
}

interface DecodeResponse {
  ok: boolean;
  run?: unknown;
  error?: string;
}

self.onmessage = (event: MessageEvent<DecodeRequest>) => {
  let response: DecodeResponse;
  try {
    const envelope: unknown = JSON.parse(new TextDecoder().decode(event.data.source));
    if (typeof envelope !== "object" || envelope === null || Array.isArray(envelope) || !("run" in envelope)) {
      throw new Error("Invalid Run response");
    }
    const parsed = runDetailSchema.safeParse((envelope as { run: unknown }).run);
    if (!parsed.success || parsed.data.projectId !== event.data.projectId || parsed.data.id !== event.data.runId ||
        parsed.data.events.some((item, index) => index > 0 && item.sequence <= parsed.data.events[index - 1]!.sequence)) {
      throw new Error("Invalid Run response");
    }
    response = { ok: true, run: parsed.data };
  } catch {
    response = { ok: false, error: "Invalid Run response" };
  }
  self.postMessage(response);
};
