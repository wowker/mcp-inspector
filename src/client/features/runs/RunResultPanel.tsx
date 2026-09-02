import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { ArrowClockwise, ArrowsLeftRight, ArrowsOutSimple, CaretRight, Flask, Question, Wrench, X } from "@phosphor-icons/react";
import { toast } from "sonner";
import type { RunDetail, RunEvent, WorkflowExecutionDetail } from "../../api/api-client.js";
import { JsonViewer, parseJsonDocument } from "./JsonViewer.js";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";

type View = "workflow" | "overview" | "details" | "rpc" | "http" | "timeline";
function resultViews(workflowEnabled: boolean, t: TFunction<"runs">): Array<[View, string]> {
  const base: Array<[View, string]> = [["overview", t("result.views.overview")], ["details", t("result.views.details")],
    ["http", t("result.views.http")], ["rpc", t("result.views.rpc")], ["timeline", t("result.views.timeline")]];
  return workflowEnabled ? [["workflow", t("result.views.workflow")], ...base] : base;
}
const supportedImages = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
const sensitiveHeaders = /^(authorization|proxy-authorization|cookie|set-cookie|x-api-key)$/i;

function json(value: unknown, serializationFailed: string): string {
  try { return JSON.stringify(value, null, 2) ?? "null"; } catch { return serializationFailed; }
}

function canonicalJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => [key, canonicalJson(item)]));
}

function canonicalJsonText(value: unknown): string | null {
  try { return JSON.stringify(canonicalJson(value)) ?? null; }
  catch { return null; }
}

function CopyButton({ value, label, className, onCopied }: {
  value: unknown;
  label?: string;
  className?: string;
  onCopied?: () => void;
}) {
  const { t } = useTranslation("runs");
  const [error, setError] = useState(false);
  async function copy(): Promise<void> {
    try {
      if (navigator.clipboard?.writeText === undefined) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(typeof value === "string" ? value : json(value, t("serializationFailed"))); setError(false); onCopied?.();
    } catch { setError(true); }
  }
  return <span className="copy-control"><button type="button" className={className ?? "run-result-action"} onClick={() => void copy()}>{label ?? t("result.copy")}</button>
    {error && <span role="alert">{t("result.copyFailed")}</span>}</span>;
}

function JsonDialogButton({ value, label }: { value: unknown; label: string }) {
  const { t } = useTranslation("runs");
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    return () => { document.body.style.overflow = previousOverflow; };
  }, [open]);

  function close(): void {
    setOpen(false);
    triggerRef.current?.focus();
  }

  function handleDialogKeyDown(event: KeyboardEvent<HTMLElement>): void {
    if (event.key === "Escape") { event.preventDefault(); close(); return; }
    if (event.key !== "Tab") return;
    const focusable = [...event.currentTarget.querySelectorAll<HTMLElement>(
      "button:not([disabled]), [href], [tabindex]:not([tabindex='-1'])",
    )];
    if (focusable.length === 0) return;
    const first = focusable[0]!;
    const last = focusable.at(-1)!;
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }

  return <span className="open-json-control"><button ref={triggerRef} type="button" className="run-result-action"
    onClick={() => setOpen(true)}><ArrowsOutSimple size={15} weight="bold" aria-hidden="true" />{t("result.enlarge")}</button>
    {open && createPortal(<div className="json-inspector-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) close();
    }}>
      <section className="json-inspector-dialog" role="dialog" aria-modal="true" aria-labelledby="json-inspector-title"
        onKeyDown={handleDialogKeyDown}>
        <header className="json-inspector-dialog__header">
          <div><span className="json-inspector-dialog__eyebrow">JSON VIEWER</span><h2 id="json-inspector-title">{label}</h2></div>
          <div className="json-inspector-dialog__actions">
            <CopyButton value={value} label={t("result.copy")} onCopied={() => toast.success(t("result.copied"))} />
            <button ref={closeRef} type="button" className="json-inspector-dialog__close"
              aria-label={t("result.closeViewer")} onClick={close}><X size={20} weight="bold" aria-hidden="true" /></button>
          </div>
        </header>
        <div className="json-inspector-dialog__content">
          <JsonViewer value={value} label={`${label} JSON`} defaultExpanded="all" />
        </div>
      </section>
    </div>, document.body)}
  </span>;
}

function JsonValue({ value, label = "JSON", copyLabel, hideLabel = false, defaultExpanded = "useful", allowOpenTab = false }: {
  value: unknown;
  label?: string;
  copyLabel?: string;
  hideLabel?: boolean;
  defaultExpanded?: "useful" | "all";
  allowOpenTab?: boolean;
}) {
  const { t } = useTranslation("runs");
  return <section className="json-block"><div className={`block-toolbar${hideLabel ? " block-toolbar--actions-only" : ""}`}>
    {!hideLabel && <strong>{label}</strong>}<CopyButton value={value} label={copyLabel ?? t("result.copy")} />
    {allowOpenTab && <JsonDialogButton value={value} label={label} />}</div>
    <JsonViewer value={value} label={`${label} JSON`} defaultExpanded={defaultExpanded} /></section>;
}

function ImageBlock({ block }: { block: Record<string, unknown> }) {
  const { t } = useTranslation("runs");
  const mime = typeof block.mimeType === "string" ? block.mimeType.toLowerCase() : "unknown";
  const data = typeof block.data === "string" ? block.data : null;
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (data === null || !supportedImages.has(mime)) { setUrl(null); return; }
    let objectUrl: string | null = null;
    try {
      const bytes = Uint8Array.from(atob(data), (character) => character.charCodeAt(0));
      objectUrl = URL.createObjectURL(new Blob([bytes], { type: mime })); setUrl(objectUrl);
    } catch { setUrl(null); }
    return () => { if (objectUrl !== null) URL.revokeObjectURL(objectUrl); };
  }, [data, mime]);
  if (url === null) return <UnsupportedBlock block={block} />;
  return <section className="content-block"><div className="block-toolbar"><strong>{mime}</strong><CopyButton value={block} /></div>
    <img src={url} alt={t("result.imageAlt")} className="result-image" /></section>;
}

function UnsupportedBlock({ block }: { block: Record<string, unknown> }) {
  const { t } = useTranslation("runs");
  const mime = typeof block.mimeType === "string" ? block.mimeType : t("result.unknownMime");
  return <section className="content-block unsupported-block"><div className="block-toolbar"><strong>{String(block.type ?? t("result.unknownBlock"))} · {mime}</strong>
    <CopyButton value={block} label={t("result.copyRawBlock")} /></div><p>{t("result.unsupported")}</p></section>;
}

function ContentBlock({ value, index, allowOpenTab = false }: { value: unknown; index: number; allowOpenTab?: boolean }) {
  const { t } = useTranslation("runs");
  if (typeof value !== "object" || value === null || Array.isArray(value)) return <JsonValue value={value} label={t("result.contentBlock", { index: index + 1 })} allowOpenTab={allowOpenTab} />;
  const block = value as Record<string, unknown>;
  if (block.type === "text" && typeof block.text === "string") {
    const parsed = parseJsonDocument(block.text);
    return <section className="content-block"><div className={`block-toolbar${parsed === null ? "" : " block-toolbar--actions-only"}`}>
      {parsed === null && <strong>{t("result.text")}</strong>}<CopyButton value={block.text} label={t("result.copy")} />
      {parsed !== null && allowOpenTab && <JsonDialogButton value={parsed} label={t("result.responseContent", { index: index + 1 })} />}</div>
      {parsed === null ? <pre>{block.text}</pre> : <JsonViewer value={parsed} label={`${t("result.response")} JSON`} defaultExpanded="all" />}</section>;
  }
  if (block.type === "image") return <ImageBlock block={block} />;
  if (block.type === "resource" && typeof block.resource === "object" && block.resource !== null && !Array.isArray(block.resource)) {
    const resource = block.resource as Record<string, unknown>;
    if (typeof resource.text === "string") return <section className="content-block"><div className="block-toolbar">
      <strong>{t("result.embeddedText")} · {String(resource.mimeType ?? "text/plain")}</strong><CopyButton value={block} label={t("result.copy")} /></div>
      <p className="resource-uri">{t("result.uriNotLoaded", { uri: String(resource.uri ?? "") })}</p><pre>{resource.text}</pre></section>;
  }
  return <UnsupportedBlock block={block} />;
}

function payloadRecord(event: RunEvent): Record<string, unknown> | null {
  return typeof event.payload === "object" && event.payload !== null && !Array.isArray(event.payload)
    ? event.payload as Record<string, unknown> : null;
}

function redactHeaders(value: unknown): unknown {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .map(([name, header]) => [name, sensitiveHeaders.test(name) ? "[REDACTED]" : header]));
}

interface HttpExchange { key: string; request?: RunEvent; response?: RunEvent }
function httpExchanges(events: RunEvent[]): HttpExchange[] {
  const exchanges = new Map<string, HttpExchange>(); let anonymous = 0; let pendingAnonymous: HttpExchange | undefined;
  for (const event of [...events].sort((a, b) => a.sequence - b.sequence)) {
    if (event.kind !== "http-request" && event.kind !== "http-response") continue;
    const payload = payloadRecord(event); const exchangeId = typeof payload?.exchangeId === "string" ? payload.exchangeId : null;
    if (exchangeId !== null) {
      const exchange = exchanges.get(exchangeId) ?? { key: exchangeId };
      if (event.kind === "http-request") exchange.request = event; else exchange.response = event;
      exchanges.set(exchangeId, exchange);
    } else if (event.kind === "http-request") {
      pendingAnonymous = { key: `anonymous-${anonymous += 1}`, request: event }; exchanges.set(pendingAnonymous.key, pendingAnonymous);
    } else if (pendingAnonymous !== undefined && pendingAnonymous.response === undefined) pendingAnonymous.response = event;
    else { const orphan = { key: `orphan-${anonymous += 1}`, response: event }; exchanges.set(orphan.key, orphan); }
  }
  return [...exchanges.values()];
}

interface MetadataEntry { name: string; value: string; help?: string }

function metadata(run: RunDetail, t: TFunction<"runs">): MetadataEntry[] {
  return [
    { name: "Run ID", value: run.id, help: t("result.metadata.runHelp") },
    { name: t("result.metadata.status"), value: t(`status.${run.status}`, { defaultValue: run.status }) },
    { name: t("result.metadata.totalDuration"), value: run.durationMs === null ? t("result.metadata.notRecorded") : `${run.durationMs} ms` },
    { name: t("result.metadata.networkDuration"), value: run.networkDurationMs === null ? t("result.metadata.notRecorded") : `${run.networkDurationMs} ms` },
    { name: t("result.metadata.created"), value: run.createdAt },
    { name: t("result.metadata.started"), value: run.startedAt ?? t("result.metadata.notRecorded") },
    { name: t("result.metadata.completed"), value: run.completedAt ?? t("result.metadata.notRecorded") },
    { name: t("result.metadata.snapshotHash"), value: run.toolSnapshotHash, help: t("result.metadata.snapshotHelp") },
    { name: t("result.metadata.protocolVersion"), value: run.protocolVersion ?? t("result.metadata.notRecorded") },
    { name: "Server", value: json(run.serverInfo, t("serializationFailed")) },
    { name: "Inspector Client", value: json(run.clientInfo, t("serializationFailed")) },
  ];
}

function MetadataLabel({ name, help }: Pick<MetadataEntry, "name" | "help">) {
  const { t } = useTranslation("runs");
  const [open, setOpen] = useState(false);
  return <dt><span>{name}</span>{help !== undefined && <span className="metadata-help">
    <button type="button" aria-label={t("result.metadata.learnAria", { name })} aria-expanded={open} onClick={() => setOpen((current) => !current)}>
      <Question size={15} weight="bold" aria-hidden="true" />
    </button>
    {open && <p>{help}</p>}
  </span>}</dt>;
}

function ResultCollapseButton({ expanded, controls, onExpandedChange }: {
  expanded: boolean;
  controls: string;
  onExpandedChange?: (expanded: boolean) => void;
}) {
  const { t } = useTranslation("runs");
  if (onExpandedChange === undefined) return null;
  return <button type="button" className="result-collapse" aria-expanded={expanded} aria-controls={controls}
    aria-label={expanded ? t("result.collapse") : t("result.expand")} title={expanded ? t("result.collapse") : t("result.expand")}
    onClick={() => onExpandedChange(!expanded)}>
    <CaretRight size={18} weight="bold" aria-hidden="true" />
  </button>;
}

function WorkflowExecutionView({ execution, onCancel, mainToolFailed = false }: {
  execution: WorkflowExecutionDetail | null;
  onCancel?: (execution: WorkflowExecutionDetail) => void;
  mainToolFailed?: boolean;
}) {
  const { t } = useTranslation("runs");
  if (execution === null) return <div className="workflow-view workflow-view--empty" role="status">
    <strong>{t("result.workflow.idle")}</strong>
    <p>{t("result.workflow.idleDescription")}</p>
  </div>;
  const logs = execution.events.filter(({ kind }) => kind === "script-log")
    .sort((left, right) => left.sequence - right.sequence);
  const isTerminal = ["succeeded", "failed", "cancelled", "interrupted"].includes(execution.status);
  const phaseLabel = (value: unknown): string => value === "before" ? t("result.workflow.before") : value === "after" ? t("result.workflow.after") : t("result.workflow.script");
  const visualStatus = mainToolFailed ? "main-tool-failed" : execution.status;
  return <div className={`workflow-view workflow-view--${visualStatus}`}>
    <header className="workflow-view__summary">
      <div><strong>{mainToolFailed ? t("result.workflow.title") : t("result.workflow.titleStatus", { status: execution.status })}</strong>
        <span>{execution.durationMs === null ? t("result.workflow.running") : t("result.workflow.total", { duration: formatDuration(execution.durationMs) })}</span>
        <span>{t("result.workflow.runs", { count: execution.runs.length })}</span><span>{t("result.workflow.logs", { count: logs.length })}</span></div>
      {!isTerminal && onCancel !== undefined && <button type="button" className="run-result-action"
        onClick={() => onCancel(execution)}>{t("result.workflow.cancel")}</button>}
    </header>
    {!mainToolFailed && execution.error !== null && <p className="workflow-view__error" role="alert">
      <strong>{execution.error.code}</strong><span>{execution.error.message}</span>
    </p>}
    {execution.runs.length > 0 && <section className="workflow-view__runs" aria-label={t("result.workflow.runsAria")}>
      <h3>{t("result.workflow.stages")}</h3><ol>{[...execution.runs].sort((left, right) => left.ordinal - right.ordinal).map((run) => <li key={run.runId}>
        <span>#{run.ordinal + 1}</span><strong>{run.phase === "helper-before" ? t("result.workflow.beforeHelper") : run.phase === "helper-after" ? t("result.workflow.afterHelper") : t("result.workflow.main")}</strong>
        <code>{run.runId.slice(0, 8)}</code>{run.sourceLine === null ? null : <span>{t("result.workflow.sourceLine", { line: run.sourceLine })}</span>}
      </li>)}</ol>
    </section>}
    <section className="workflow-view__logs" aria-label={t("result.workflow.logsAria")}>
      <h3>{t("result.workflow.logsTitle")}</h3>
      {logs.length === 0 ? <p className="workflow-view__empty-log">{t("result.workflow.noLogs")}</p>
        : <ol>{logs.map((event) => {
          const payload = typeof event.payload === "object" && event.payload !== null && !Array.isArray(event.payload)
            ? event.payload as Record<string, unknown> : {};
          const logValue = payload.data ?? payload;
          return <li className="workflow-log-entry" key={event.sequence}>
            <header className="workflow-log-entry__header"><div className="workflow-log-entry__meta">
              <span>#{event.sequence}</span><strong>{phaseLabel(payload.phase)}</strong>
              <span className={`workflow-log-level workflow-log-level--${String(payload.level ?? "info")}`}>{String(payload.level ?? "info")}</span>
              <time>{event.occurredAt}</time></div>
              <div className="workflow-log-entry__actions"><CopyButton value={logValue} />
                <JsonDialogButton value={logValue} label={t("result.workflow.logLabel", { sequence: event.sequence })} /></div>
            </header>
            <p>{String(payload.message ?? "")}</p>
            <div className="workflow-log-entry__content">
              <JsonViewer value={logValue} label={t("result.workflow.logData", { sequence: event.sequence })} defaultExpanded="all" />
            </div>
          </li>;
        })}</ol>}
    </section>
  </div>;
}

export function EmptyRunResultPanel({ expanded = true, onExpandedChange, workflowExecution, onCancelWorkflow }: {
  expanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
  workflowExecution?: WorkflowExecutionDetail | null;
  onCancelWorkflow?: (execution: WorkflowExecutionDetail) => void;
} = {}) {
  const { t } = useTranslation("runs");
  const workflowEnabled = workflowExecution !== undefined;
  const [view, setView] = useState<View>(workflowEnabled ? "workflow" : "overview");
  const hadWorkflow = useRef(workflowEnabled);
  useEffect(() => {
    if (workflowEnabled && !hadWorkflow.current) setView("workflow");
    else if (!workflowEnabled && view === "workflow") setView("overview");
    hadWorkflow.current = workflowEnabled;
  }, [view, workflowEnabled]);
  const views = resultViews(workflowEnabled, t);
  const contentId = "empty-run-result-content";
  return <article className="run-result run-result--empty" aria-label={t("result.idleAria")}>
    <div className="run-result__sticky-header">
      <header><div className="run-summary-shell"><ResultCollapseButton expanded={expanded} controls={contentId} onExpandedChange={onExpandedChange} />
        <div className="run-summary"><div className="run-status run-status--idle">{t("result.idle")}</div><span>{t("result.totalEmpty")}</span><span>{t("result.networkEmpty")}</span></div></div></header>
      {expanded && <div role="tablist" aria-label={t("result.viewsAria")} className="result-tabs" onKeyDown={(event) => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        const index = views.findIndex(([id]) => id === view); const next = event.key === "Home" ? 0 : event.key === "End" ? views.length - 1
          : event.key === "ArrowRight" ? (index + 1) % views.length : (index - 1 + views.length) % views.length;
        event.preventDefault(); const target = views[next]?.[0]; if (target !== undefined) {
          setView(target); queueMicrotask(() => document.getElementById(`empty-result-tab-${target}`)?.focus());
        }
      }}>{views.map(([id, label]) => <button id={`empty-result-tab-${id}`} key={id} type="button" role="tab"
        tabIndex={view === id ? 0 : -1} aria-controls={contentId}
        aria-selected={view === id} onClick={() => setView(id)}>{label}</button>)}</div>
      }
    </div>
    {expanded && <section id={contentId} role="tabpanel" aria-labelledby={`empty-result-tab-${view}`} className="result-view">
      {view === "workflow" && workflowExecution !== undefined && <WorkflowExecutionView execution={workflowExecution} onCancel={onCancelWorkflow} />}
      {view === "overview" && <div className="run-overview">
        <details className="result-disclosure" open><summary>{t("result.requestArguments")}</summary><div className="result-disclosure__content result-empty-content" /></details>
        <details className="result-disclosure" open><summary>{t("result.response")}</summary><div className="result-disclosure__content result-empty-content" /></details>
        <details className="raw-disclosure"><summary>{t("result.raw")}</summary></details>
      </div>}
      {view === "details" && <dl className="run-metadata">{["Run ID", t("result.metadata.status"), t("result.metadata.totalDuration"), t("result.metadata.networkDuration"), t("result.metadata.snapshotHash"), t("result.metadata.protocolVersion")].map((name) =>
        <div key={name}><dt>{name}</dt><dd /></div>)}</dl>}
      {(view === "http" || view === "rpc" || view === "timeline") && <div className="result-empty-content result-empty-content--trace" />}
    </section>}
  </article>;
}

function formatDuration(durationMs: number): string {
  return durationMs < 1_000 ? `${durationMs} ms` : `${(durationMs / 1_000).toFixed(2)} s`;
}

export function RunResultPanel({ run, onSaveResponse, onOpenDebug, onCreateTest, onReplay, onCompare, openingDebug = false, expanded = true, onExpandedChange,
  workflowExecution, onCancelWorkflow }: {
  run: RunDetail;
  onSaveResponse?: (response: NonNullable<RunDetail["response"]>) => void;
  onOpenDebug?: (run: RunDetail) => void;
  onCreateTest?: (run: RunDetail) => void;
  onReplay?: (run: RunDetail) => void;
  onCompare?: (run: RunDetail) => void;
  openingDebug?: boolean;
  expanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
  workflowExecution?: WorkflowExecutionDetail | null;
  onCancelWorkflow?: (execution: WorkflowExecutionDetail) => void;
}) {
  const { t } = useTranslation("runs");
  const workflowEnabled = workflowExecution !== undefined;
  const [view, setView] = useState<View>(workflowEnabled ? "workflow" : "overview");
  const hadWorkflow = useRef(workflowEnabled);
  const [requestOpen, setRequestOpen] = useState(true);
  const [responseOpen, setResponseOpen] = useState(true);
  const [rawOpen, setRawOpen] = useState(false);
  useEffect(() => {
    setView(workflowEnabled ? "workflow" : "overview");
    setRequestOpen(true);
    setResponseOpen(true);
    setRawOpen(false);
  }, [run.id]);
  useEffect(() => {
    if (workflowEnabled && !hadWorkflow.current) setView("workflow");
    else if (!workflowEnabled && view === "workflow") setView("overview");
    hadWorkflow.current = workflowEnabled;
  }, [view, workflowEnabled]);
  const views = resultViews(workflowEnabled, t);
  const ordered = useMemo(() => [...run.events].sort((left, right) => left.sequence - right.sequence), [run.events]);
  const result = run.response?.result;
  const resultRecord = typeof result === "object" && result !== null && !Array.isArray(result) ? result as Record<string, unknown> : null;
  const content = Array.isArray(resultRecord?.content) ? resultRecord.content : [];
  const structuredContent = resultRecord !== null && "structuredContent" in resultRecord ? resultRecord.structuredContent : undefined;
  const structuredFingerprint = useMemo(() => structuredContent === undefined ? null : canonicalJsonText(structuredContent), [structuredContent]);
  const visibleContent = content.map((block, index) => ({ block, index })).filter(({ block }) => {
    if (structuredFingerprint === null) return true;
    if (typeof block !== "object" || block === null || Array.isArray(block)) return true;
    const record = block as Record<string, unknown>;
    if (record.type !== "text" || typeof record.text !== "string") return true;
    const parsed = parseJsonDocument(record.text);
    return parsed === null || canonicalJsonText(parsed) !== structuredFingerprint;
  });
  const requestHttp = typeof run.request.http === "object" && run.request.http !== null && !Array.isArray(run.request.http)
    ? run.request.http as Record<string, unknown> : null;
  const shouldRedact = run.redactSensitiveInfo !== false;
  const visibleHeaders = (headers: unknown) => shouldRedact ? redactHeaders(headers) : headers;
  const safeRequestHttp = requestHttp === null ? null : { ...requestHttp, headers: visibleHeaders(requestHttp.headers) };
  const origin = Date.parse(run.createdAt);
  const contentId = `run-result-content-${run.id}`;
  const mainToolFailure = run.status === "failed" && workflowExecution?.runs.some(
    ({ phase, runId }) => phase === "main" && runId === run.id,
  ) === true;
  return <article className="run-result" aria-label={t("result.runAria", { id: run.id })}>
    <div className="run-result__sticky-header">
      <header><div className="run-summary-shell"><ResultCollapseButton expanded={expanded} controls={contentId} onExpandedChange={onExpandedChange} />
        <div className="run-summary"><div className={`run-status run-status--${run.status}`}>{t(`status.${run.status}`, { defaultValue: run.status })}</div>
        <span>{run.durationMs === null ? t("result.totalMissing") : t("result.total", { duration: formatDuration(run.durationMs) })}</span>
        {run.networkDurationMs !== null && <span>{t("result.network", { duration: formatDuration(run.networkDurationMs) })}</span>}</div></div>
        <div className="run-result-actions">{run.response !== null && onSaveResponse !== undefined && <button type="button" className="run-result-action" onClick={() => onSaveResponse(run.response!)}>{t("result.saveResponse")}</button>}
          {onOpenDebug !== undefined && <button type="button" className="run-result-action" disabled={openingDebug} onClick={() => onOpenDebug(run)}>
            <Wrench size={15} weight="bold" aria-hidden="true" />{openingDebug ? t("result.openingDebug") : t("result.openDebug")}
          </button>}
          {onCreateTest !== undefined && <button type="button" className="run-result-action" onClick={() => onCreateTest(run)}>
            <Flask size={15} weight="bold" aria-hidden="true" />{t("result.createTest")}
          </button>}
          {onReplay !== undefined && <button type="button" className="run-result-action" onClick={() => onReplay(run)}>
            <ArrowClockwise size={15} weight="bold" aria-hidden="true" />{t("result.replay")}
          </button>}
          {onCompare !== undefined && run.replayedFromRunId !== null && <button type="button" className="run-result-action" onClick={() => onCompare(run)}>
            <ArrowsLeftRight size={15} weight="bold" aria-hidden="true" />{t("result.compare")}
          </button>}
          <CopyButton value={run.response} label={t("result.copyAll")} className="run-result-action" /></div></header>
      {expanded && run.response?.truncated && <p role="status" className="truncated-warning">{t("result.truncated", { bytes: run.response.originalBytes ?? t("result.unknown") })}</p>}
      {expanded && <div role="tablist" aria-label={t("result.viewsAria")} className="result-tabs" onKeyDown={(event) => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        const index = views.findIndex(([id]) => id === view); const next = event.key === "Home" ? 0 : event.key === "End" ? views.length - 1
          : event.key === "ArrowRight" ? (index + 1) % views.length : (index - 1 + views.length) % views.length;
        event.preventDefault(); const target = views[next]?.[0]; if (target !== undefined) { setView(target); queueMicrotask(() => document.getElementById(`result-tab-${target}-${run.id}`)?.focus()); }
      }}>{views.map(([id, label]) => <button id={`result-tab-${id}-${run.id}`} key={id} type="button" role="tab" tabIndex={view === id ? 0 : -1}
        aria-selected={view === id} aria-controls={contentId} onClick={() => setView(id)}>{label}</button>)}</div>}
    </div>
    {expanded && <section id={contentId} role="tabpanel" aria-labelledby={`result-tab-${view}-${run.id}`} className="result-view">
      {view === "workflow" && workflowExecution !== undefined && <WorkflowExecutionView execution={workflowExecution}
        onCancel={onCancelWorkflow} mainToolFailed={mainToolFailure} />}
      {view === "overview" && <div className="run-overview">
        <details className="result-disclosure" open={requestOpen} onToggle={(event) => setRequestOpen(event.currentTarget.open)}>
          <summary>{t("result.requestArguments")}</summary>
          {requestOpen && <div className="result-disclosure__content">
            <div className="section-toolbar section-toolbar--actions-only"><CopyButton value={run.request.arguments} label={t("result.copyArguments")} /></div>
            <JsonViewer value={run.request.arguments} label={`${t("result.requestArguments")} JSON`} />
          </div>}
        </details>
        <details className="result-disclosure" open={responseOpen} onToggle={(event) => setResponseOpen(event.currentTarget.open)}>
          <summary>{t("result.response")}</summary>
          {responseOpen && <div className="result-disclosure__content">
            {run.response === null ? <p role="status">{t("result.waiting")}</p> : <div className="result-content-flow">
              {run.response.error !== null && <JsonValue value={run.response.error} label={t("result.error")} defaultExpanded="all" allowOpenTab />}
              {structuredContent !== undefined && <JsonValue value={structuredContent} label={t("result.structured")} hideLabel defaultExpanded="all" allowOpenTab />}
              {visibleContent.map(({ block, index }) => <ContentBlock key={index} value={block} index={index} allowOpenTab />)}
              {result !== null && resultRecord === null && <JsonValue value={result} label={t("result.result")} defaultExpanded="all" allowOpenTab />}
            </div>}
          </div>}
        </details>
        <details className="raw-disclosure" open={rawOpen} onToggle={(event) => setRawOpen(event.currentTarget.open)}><summary>{t("result.raw")}</summary>
          {rawOpen && <div className="raw-disclosure__content">
            <JsonValue value={run.request.jsonrpc} label={t("result.fullJsonRpc")} copyLabel={t("result.copyJsonRpc")} />
            <JsonValue value={safeRequestHttp} label={t("result.safeHttp")} copyLabel={t("result.copyHttp")} />
            <JsonValue value={run.response} label={t("result.fullResponse")} />
          </div>}
        </details>
      </div>}
      {view === "details" && <dl className="run-metadata">{metadata(run, t).map(({ name, value, help }) => <div key={name}><MetadataLabel name={name} help={help} /><dd>{value}</dd></div>)}</dl>}
      {view === "rpc" && <div className="trace-list">{ordered.filter(({ kind }) => kind === "rpc-out" || kind === "rpc-in").map((event) =>
        <JsonValue key={event.sequence} value={payloadRecord(event)?.message ?? event.payload} label={`#${event.sequence} ${event.kind}`} />)}</div>}
      {view === "http" && <div className="trace-list">{httpExchanges(ordered).map((exchange) => {
        const request = exchange.request === undefined ? null : payloadRecord(exchange.request); const response = exchange.response === undefined ? null : payloadRecord(exchange.response);
        const safe = { request: request === null ? null : { ...request, headers: visibleHeaders(request.headers) },
          response: response === null ? null : { ...response, headers: visibleHeaders(response.headers) } };
        return <section className="http-exchange" key={exchange.key}><div className="block-toolbar"><strong>{request === null ? t("result.unknownRequest") : `${String(request.method)} ${String(request.url)}`}
          {response === null ? "" : ` → ${String(response.status)}`}</strong><CopyButton value={safe} /></div><JsonViewer value={safe} label={t("result.httpExchange")} /></section>;
      })}</div>}
      {view === "timeline" && <ol className="timeline">{ordered.map((event) => <li key={event.sequence}><span data-testid="timeline-sequence">#{event.sequence}</span>
        <strong>{event.kind}</strong><time>{Number.isFinite(origin) ? `+${Math.max(0, Date.parse(event.occurredAt) - origin)} ms` : event.occurredAt}</time></li>)}</ol>}
    </section>}
  </article>;
}
