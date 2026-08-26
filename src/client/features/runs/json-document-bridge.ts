const READY = "json-viewer-ready";
const DOCUMENT = "json-viewer-document";
const RECEIVED = "json-viewer-received";
const HANDSHAKE_TIMEOUT_MS = 15_000;

interface ViewerMessage {
  type: string;
  channelId: string;
}

export interface JsonDocumentMessage extends ViewerMessage {
  type: typeof DOCUMENT;
  label: string;
  value: unknown;
}

function isViewerMessage(value: unknown, type: string, channelId: string): value is Record<string, unknown> & ViewerMessage {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return record.type === type && record.channelId === channelId;
}

function channelId(): string {
  return typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function openJsonDocument(value: unknown, label: string): boolean {
  const id = channelId();
  const target = new URL("/json-viewer", window.location.origin);
  target.searchParams.set("channel", id);
  let popup: Window | null = null;
  let timeout: number | null = null;

  const cleanup = () => {
    window.removeEventListener("message", receive);
    if (timeout !== null) window.clearTimeout(timeout);
  };
  const receive = (event: MessageEvent<unknown>) => {
    if (event.origin !== window.location.origin || event.source !== popup) return;
    if (isViewerMessage(event.data, READY, id)) {
      popup?.postMessage({ type: DOCUMENT, channelId: id, label, value } satisfies JsonDocumentMessage, window.location.origin);
      return;
    }
    if (isViewerMessage(event.data, RECEIVED, id)) cleanup();
  };

  window.addEventListener("message", receive);
  try { popup = window.open(`${target.pathname}${target.search}`, "_blank"); }
  catch { popup = null; }
  if (popup === null) { cleanup(); return false; }
  timeout = window.setTimeout(cleanup, HANDSHAKE_TIMEOUT_MS);
  return true;
}

export function jsonDocumentChannel(): string | null {
  const value = new URL(window.location.href).searchParams.get("channel");
  return value !== null && value.length > 0 && value.length <= 200 ? value : null;
}

export function isJsonDocumentMessage(value: unknown, channelId: string): value is JsonDocumentMessage {
  if (!isViewerMessage(value, DOCUMENT, channelId)) return false;
  return typeof value.label === "string" && value.label.trim().length > 0 && value.label.length <= 200 && "value" in value;
}

export const jsonViewerMessages = { ready: READY, received: RECEIVED } as const;
