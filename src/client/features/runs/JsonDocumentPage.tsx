import { useEffect, useRef, useState } from "react";
import { BracketsCurly, Copy } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import { JsonViewer } from "./JsonViewer.js";
import { isJsonDocumentMessage, jsonDocumentChannel, jsonViewerMessages, type JsonDocumentMessage } from "./json-document-bridge.js";

type DocumentState =
  | { status: "loading" }
  | { status: "ready"; document: JsonDocumentMessage }
  | { status: "error"; message: string };

function stringify(value: unknown, fallback: string): string {
  try { return JSON.stringify(value, null, 2) ?? "null"; }
  catch { return fallback; }
}

export function JsonDocumentPage() {
  const { t } = useTranslation("runs");
  const effectMessages = useRef({ unreadable: t("jsonViewer.unreadable"), timeout: t("jsonViewer.timeout") });
  effectMessages.current = { unreadable: t("jsonViewer.unreadable"), timeout: t("jsonViewer.timeout") };
  const [state, setState] = useState<DocumentState>({ status: "loading" });
  const [copyError, setCopyError] = useState(false);

  useEffect(() => {
    const channelId = jsonDocumentChannel();
    const source = window.opener;
    if (channelId === null || source === null) {
      setState({ status: "error", message: effectMessages.current.unreadable });
      return;
    }
    const timeout = window.setTimeout(() => setState((current) => current.status === "loading"
      ? { status: "error", message: effectMessages.current.timeout }
      : current), 15_000);
    const receive = (event: MessageEvent<unknown>) => {
      if (event.origin !== window.location.origin || event.source !== source || !isJsonDocumentMessage(event.data, channelId)) return;
      window.clearTimeout(timeout);
      setState({ status: "ready", document: event.data });
      document.title = `${event.data.label} | JSON Viewer`;
      source.postMessage({ type: jsonViewerMessages.received, channelId }, window.location.origin);
      try { window.opener = null; } catch { /* The document is already isolated by origin checks. */ }
    };
    window.addEventListener("message", receive);
    source.postMessage({ type: jsonViewerMessages.ready, channelId }, window.location.origin);
    return () => { window.clearTimeout(timeout); window.removeEventListener("message", receive); };
  }, []);

  async function copyJson(): Promise<void> {
    if (state.status !== "ready") return;
    try {
      if (navigator.clipboard?.writeText === undefined) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(stringify(state.document.value, t("jsonViewer.unserializable")));
      setCopyError(false);
    } catch { setCopyError(true); }
  }

  return <main className="json-document-page">
    <header className="json-document-page__header">
      <div className="json-document-page__identity"><BracketsCurly size={20} weight="duotone" aria-hidden="true" />
        <div><span>JSON Viewer</span><h1>{state.status === "ready" ? state.document.label : t("jsonViewer.requestResult")}</h1></div></div>
      {state.status === "ready" && <div className="json-document-page__actions">
        <button type="button" className="run-result-action" onClick={() => void copyJson()}><Copy size={15} aria-hidden="true" />{t("jsonViewer.copy")}</button>
        {copyError && <span role="alert">{t("jsonViewer.copyFailed")}</span>}
      </div>}
    </header>
    <section className="json-document-page__content" aria-live="polite">
      {state.status === "loading" && <p role="status">{t("jsonViewer.loading")}</p>}
      {state.status === "error" && <p role="alert">{state.message}</p>}
      {state.status === "ready" && <JsonViewer value={state.document.value} label={`${state.document.label} JSON`} defaultExpanded="all" />}
    </section>
  </main>;
}
