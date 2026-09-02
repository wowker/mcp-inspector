import { JsonView } from "react-json-view-lite";
import { useTranslation } from "react-i18next";

const LARGE_JSON_BYTES = 1024 * 1024;
const LARGE_JSON_NODES = 5_000;
const PREVIEW_NODES = 500;
const PREVIEW_ENTRIES = 50;
const PREVIEW_STRING_LENGTH = 2_000;

function viewerStyles(collapseJson: string, expandJson: string) { return {
  container: "json-viewer",
  childFieldsContainer: "json-viewer__children",
  basicChildStyle: "json-viewer__row",
  collapseIcon: "json-viewer__toggle json-viewer__toggle--open",
  expandIcon: "json-viewer__toggle json-viewer__toggle--closed",
  collapsedContent: "json-viewer__collapsed",
  label: "json-viewer__key",
  clickableLabel: "json-viewer__key json-viewer__key--clickable",
  nullValue: "json-viewer__null",
  undefinedValue: "json-viewer__null",
  numberValue: "json-viewer__number",
  stringValue: "json-viewer__string",
  booleanValue: "json-viewer__boolean",
  otherValue: "json-viewer__value",
  punctuation: "json-viewer__punctuation",
  quotesForFieldNames: false,
  noQuotesForStringValues: false,
  stringifyStringValues: true,
  ariaLables: { collapseJson, expandJson },
}; }

function stringify(value: unknown, fallback: string): string {
  try { return JSON.stringify(value, null, 2) ?? "null"; } catch { return fallback; }
}

export function parseJsonDocument(value: unknown): object | unknown[] | null {
  if (typeof value === "object" && value !== null) return value;
  if (typeof value !== "string") return null;
  const source = value.trim();
  if (!(source.startsWith("{") || source.startsWith("["))) return null;
  try {
    const parsed: unknown = JSON.parse(source);
    return typeof parsed === "object" && parsed !== null ? parsed : null;
  } catch { return null; }
}

function expandUsefulLevels(level: number, value: unknown): boolean {
  if (Array.isArray(value) && value.length > 100) return false;
  if (typeof value === "object" && value !== null && Object.keys(value).length > 100) return false;
  return level < 2;
}

export function analyzeJsonDocument(value: object | unknown[]): { approximateBytes: number; nodes: number; large: boolean } {
  const pending: unknown[] = [value];
  const seen = new Set<object>();
  let approximateBytes = 0;
  let nodes = 0;
  while (pending.length > 0 && approximateBytes <= LARGE_JSON_BYTES && nodes <= LARGE_JSON_NODES) {
    const current = pending.pop();
    nodes += 1;
    if (typeof current === "string") { approximateBytes += current.length * 2; continue; }
    if (typeof current !== "object" || current === null) { approximateBytes += 16; continue; }
    if (seen.has(current)) continue;
    seen.add(current);
    const entries = Object.entries(current);
    approximateBytes += entries.reduce((total, [key]) => total + key.length * 2 + 4, 0);
    for (const [, child] of entries) pending.push(child);
  }
  return { approximateBytes, nodes, large: approximateBytes > LARGE_JSON_BYTES || nodes > LARGE_JSON_NODES };
}

export function createBoundedJsonPreview(value: object | unknown[], truncatedLabel: string): object | unknown[] {
  let remaining = PREVIEW_NODES;
  const visit = (current: unknown): unknown => {
    if (remaining <= 0) return truncatedLabel;
    remaining -= 1;
    if (typeof current === "string") return current.length > PREVIEW_STRING_LENGTH
      ? `${current.slice(0, PREVIEW_STRING_LENGTH)}… ${truncatedLabel}`
      : current;
    if (typeof current !== "object" || current === null) return current;
    const entries = Object.entries(current);
    if (Array.isArray(current)) {
      const preview = entries.slice(0, PREVIEW_ENTRIES).map(([, child]) => visit(child));
      if (entries.length > PREVIEW_ENTRIES) preview.push(`${truncatedLabel} (${entries.length - PREVIEW_ENTRIES})`);
      return preview;
    }
    const preview: Record<string, unknown> = {};
    for (const [key, child] of entries.slice(0, PREVIEW_ENTRIES)) preview[key] = visit(child);
    if (entries.length > PREVIEW_ENTRIES) preview[truncatedLabel] = entries.length - PREVIEW_ENTRIES;
    return preview;
  };
  return visit(value) as object | unknown[];
}

export function JsonViewer({ value, label, defaultExpanded = "useful" }: {
  value: unknown;
  label?: string;
  defaultExpanded?: "useful" | "all";
}) {
  const { t } = useTranslation("runs");
  const accessibleLabel = label ?? t("jsonViewer.label");
  if (typeof value === "string" && value.trim().length > LARGE_JSON_BYTES) {
    return <div className="json-viewer-large" role="status" aria-label={accessibleLabel}>
      <strong>{t("jsonViewer.largeTitle")}</strong>
      <span>{t("jsonViewer.largeRaw", { size: (value.length / 1024 / 1024).toFixed(1) })}</span>
    </div>;
  }
  const data = parseJsonDocument(value);
  if (data === null) return <pre className="json-viewer json-viewer--primitive" aria-label={accessibleLabel}>{stringify(value, t("jsonViewer.unserializable"))}</pre>;
  const analysis = analyzeJsonDocument(data);
  const renderedData = analysis.large ? createBoundedJsonPreview(data, t("jsonViewer.truncated")) : data;
  return <>
    {analysis.large && <div className="json-viewer-large" role="status">
      <strong>{t("jsonViewer.largeTitle")}</strong>
      <span>{t("jsonViewer.largePreview", { size: Math.max(1, Math.ceil(analysis.approximateBytes / 1024 / 1024)) })}</span>
    </div>}
    <JsonView data={renderedData} aria-label={accessibleLabel} style={viewerStyles(t("jsonViewer.collapse"), t("jsonViewer.expand"))}
      shouldExpandNode={defaultExpanded === "all" ? () => true : expandUsefulLevels} clickToExpandNode />
  </>;
}
