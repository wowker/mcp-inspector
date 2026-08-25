import { useEffect, useMemo, useState } from "react";
import type { RunDetail, RunEvent } from "../../api/api-client.js";
import { JsonViewer, parseJsonDocument } from "./JsonViewer.js";

type View = "overview" | "details" | "rpc" | "http" | "timeline";
const terminalLabels: Record<string, string> = { queued: "排队中", connecting: "连接中", authorizing: "授权中",
  running: "运行中", succeeded: "成功", failed: "失败", cancelled: "已取消", interrupted: "已中断" };
const supportedImages = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
const sensitiveHeaders = /^(authorization|proxy-authorization|cookie|set-cookie|x-api-key)$/i;

function json(value: unknown): string {
  try { return JSON.stringify(value, null, 2) ?? "null"; } catch { return "[无法序列化]"; }
}

function CopyButton({ value, label = "复制", className }: { value: unknown; label?: string; className?: string }) {
  const [error, setError] = useState(false);
  async function copy(): Promise<void> {
    try {
      if (navigator.clipboard?.writeText === undefined) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(typeof value === "string" ? value : json(value)); setError(false);
    } catch { setError(true); }
  }
  return <span className="copy-control"><button type="button" className={className} onClick={() => void copy()}>{label}</button>
    {error && <span role="alert">复制失败，请手动选择内容</span>}</span>;
}

function JsonValue({ value, label = "JSON", copyLabel = "复制", hideLabel = false, defaultExpanded = "useful" }: {
  value: unknown;
  label?: string;
  copyLabel?: string;
  hideLabel?: boolean;
  defaultExpanded?: "useful" | "all";
}) {
  return <section className="json-block"><div className={`block-toolbar${hideLabel ? " block-toolbar--actions-only" : ""}`}>
    {!hideLabel && <strong>{label}</strong>}<CopyButton value={value} label={copyLabel} /></div>
    <JsonViewer value={value} label={`${label} JSON`} defaultExpanded={defaultExpanded} /></section>;
}

function ImageBlock({ block }: { block: Record<string, unknown> }) {
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
    <img src={url} alt="MCP 返回图片" className="result-image" /></section>;
}

function UnsupportedBlock({ block }: { block: Record<string, unknown> }) {
  const mime = typeof block.mimeType === "string" ? block.mimeType : "未知 MIME";
  return <section className="content-block unsupported-block"><div className="block-toolbar"><strong>{String(block.type ?? "未知内容块")} · {mime}</strong>
    <CopyButton value={block} label="复制原始块" /></div><p>此内容不会在页面中执行或自动加载。</p></section>;
}

function ContentBlock({ value, index }: { value: unknown; index: number }) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return <JsonValue value={value} label={`内容块 ${index + 1}`} />;
  const block = value as Record<string, unknown>;
  if (block.type === "text" && typeof block.text === "string") {
    const parsed = parseJsonDocument(block.text);
    return <section className="content-block"><div className={`block-toolbar${parsed === null ? "" : " block-toolbar--actions-only"}`}>
      {parsed === null && <strong>文本</strong>}<CopyButton value={block.text} /></div>
      {parsed === null ? <pre>{block.text}</pre> : <JsonViewer value={parsed} label="响应 JSON" defaultExpanded="all" />}</section>;
  }
  if (block.type === "image") return <ImageBlock block={block} />;
  if (block.type === "resource" && typeof block.resource === "object" && block.resource !== null && !Array.isArray(block.resource)) {
    const resource = block.resource as Record<string, unknown>;
    if (typeof resource.text === "string") return <section className="content-block"><div className="block-toolbar">
      <strong>嵌入文本资源 · {String(resource.mimeType ?? "text/plain")}</strong><CopyButton value={block} /></div>
      <p className="resource-uri">URI（未加载）：{String(resource.uri ?? "")}</p><pre>{resource.text}</pre></section>;
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

function metadata(run: RunDetail) {
  return [
    ["Run ID", run.id], ["状态", terminalLabels[run.status] ?? run.status], ["总耗时", run.durationMs === null ? "未记录" : `${run.durationMs} ms`],
    ["网络耗时", run.networkDurationMs === null ? "未记录" : `${run.networkDurationMs} ms`], ["创建", run.createdAt],
    ["开始", run.startedAt ?? "未记录"], ["完成", run.completedAt ?? "未记录"], ["Tool 快照哈希", run.toolSnapshotHash],
    ["协议版本", run.protocolVersion ?? "未记录"], ["Server", json(run.serverInfo)], ["Inspector Client", json(run.clientInfo)],
  ];
}

export function RunResultPanel({ run, onSaveResponse }: { run: RunDetail; onSaveResponse?: (response: NonNullable<RunDetail["response"]>) => void }) {
  const [view, setView] = useState<View>("overview");
  const [rawOpen, setRawOpen] = useState(false);
  useEffect(() => { setView("overview"); setRawOpen(false); }, [run.id]);
  const ordered = useMemo(() => [...run.events].sort((left, right) => left.sequence - right.sequence), [run.events]);
  const result = run.response?.result;
  const resultRecord = typeof result === "object" && result !== null && !Array.isArray(result) ? result as Record<string, unknown> : null;
  const content = Array.isArray(resultRecord?.content) ? resultRecord.content : [];
  const requestHttp = typeof run.request.http === "object" && run.request.http !== null && !Array.isArray(run.request.http)
    ? run.request.http as Record<string, unknown> : null;
  const safeRequestHttp = requestHttp === null ? null : { ...requestHttp, headers: redactHeaders(requestHttp.headers) };
  const labels: Array<[View, string]> = [["overview", "请求与结果"], ["details", "调用详情"], ["rpc", "RPC"], ["http", "HTTP"], ["timeline", "时间线"]];
  const origin = Date.parse(run.createdAt);
  return <article className="run-result" aria-label={`运行 ${run.id} 详情`}>
    <header><div className="run-summary"><div className={`run-status run-status--${run.status}`}>{terminalLabels[run.status] ?? run.status}</div>
      <span>{run.durationMs === null ? "总耗时未记录" : `${run.durationMs} ms`}</span>
      {run.networkDurationMs !== null && <span>网络 {run.networkDurationMs} ms</span>}</div>
      <div className="run-result-actions">{run.response !== null && onSaveResponse !== undefined && <button type="button" className="run-result-action" onClick={() => onSaveResponse(run.response!)}>保存响应</button>}
        <CopyButton value={run.response} label="复制全部结果" className="run-result-action" /></div></header>
    {run.response?.truncated && <p role="status" className="truncated-warning">结果已截断（原始大小 {run.response.originalBytes ?? "未知"} bytes），以下仅为安全预览。</p>}
    <div role="tablist" aria-label="运行结果视图" className="result-tabs" onKeyDown={(event) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      const index = labels.findIndex(([id]) => id === view); const next = event.key === "Home" ? 0 : event.key === "End" ? labels.length - 1
        : event.key === "ArrowRight" ? (index + 1) % labels.length : (index - 1 + labels.length) % labels.length;
      event.preventDefault(); const target = labels[next]?.[0]; if (target !== undefined) { setView(target); queueMicrotask(() => document.getElementById(`result-tab-${target}-${run.id}`)?.focus()); }
    }}>{labels.map(([id, label]) => <button id={`result-tab-${id}-${run.id}`} key={id} type="button" role="tab" tabIndex={view === id ? 0 : -1}
      aria-selected={view === id} aria-controls={`result-${id}-${run.id}`} onClick={() => setView(id)}>{label}</button>)}</div>
    <section id={`result-${view}-${run.id}`} role="tabpanel" aria-labelledby={`result-tab-${view}-${run.id}`} className="result-view">
      {view === "overview" && <div className="run-overview">
        <section className="result-section" aria-labelledby={`request-title-${run.id}`}>
          <div className="section-toolbar"><h2 id={`request-title-${run.id}`}>请求参数</h2><CopyButton value={run.request.arguments} label="复制参数" /></div>
          <JsonViewer value={run.request.arguments} label="请求参数 JSON" />
        </section>
        <section className="result-section" aria-labelledby={`response-title-${run.id}`}>
          <div className="section-toolbar"><h2 id={`response-title-${run.id}`}>请求结果</h2></div>
          {run.response === null ? <p role="status">等待运行结果…</p> : <div className="result-content-flow">
            {run.response.error !== null && <JsonValue value={run.response.error} label="错误" defaultExpanded="all" />}
            {resultRecord !== null && "structuredContent" in resultRecord && <JsonValue value={resultRecord.structuredContent} label="结构化响应" hideLabel defaultExpanded="all" />}
            {content.map((block, index) => <ContentBlock key={index} value={block} index={index} />)}
            {result !== null && resultRecord === null && <JsonValue value={result} label="结果" defaultExpanded="all" />}
          </div>}
        </section>
        <details className="raw-disclosure" open={rawOpen} onToggle={(event) => setRawOpen(event.currentTarget.open)}><summary>原始请求与响应</summary>
          {rawOpen && <div className="raw-disclosure__content">
            <JsonValue value={run.request.jsonrpc} label="完整 JSON-RPC" copyLabel="复制 JSON-RPC" />
            <JsonValue value={safeRequestHttp} label="安全 HTTP 摘要" copyLabel="复制 HTTP 摘要" />
            <JsonValue value={run.response} label="完整响应" />
          </div>}
        </details>
      </div>}
      {view === "details" && <dl className="run-metadata">{metadata(run).map(([name, value]) => <div key={name}><dt>{name}</dt><dd>{value}</dd></div>)}</dl>}
      {view === "rpc" && <div className="trace-list">{ordered.filter(({ kind }) => kind === "rpc-out" || kind === "rpc-in").map((event) =>
        <JsonValue key={event.sequence} value={payloadRecord(event)?.message ?? event.payload} label={`#${event.sequence} ${event.kind}`} />)}</div>}
      {view === "http" && <div className="trace-list">{httpExchanges(ordered).map((exchange) => {
        const request = exchange.request === undefined ? null : payloadRecord(exchange.request); const response = exchange.response === undefined ? null : payloadRecord(exchange.response);
        const safe = { request: request === null ? null : { ...request, headers: redactHeaders(request.headers) },
          response: response === null ? null : { ...response, headers: redactHeaders(response.headers) } };
        return <section className="http-exchange" key={exchange.key}><div className="block-toolbar"><strong>{request === null ? "未知请求" : `${String(request.method)} ${String(request.url)}`}
          {response === null ? "" : ` → ${String(response.status)}`}</strong><CopyButton value={safe} /></div><JsonViewer value={safe} label="HTTP 交换 JSON" /></section>;
      })}</div>}
      {view === "timeline" && <ol className="timeline">{ordered.map((event) => <li key={event.sequence}><span data-testid="timeline-sequence">#{event.sequence}</span>
        <strong>{event.kind}</strong><time>{Number.isFinite(origin) ? `+${Math.max(0, Date.parse(event.occurredAt) - origin)} ms` : event.occurredAt}</time></li>)}</ol>}
    </section>
  </article>;
}
