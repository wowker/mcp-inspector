import { JsonView } from "react-json-view-lite";

const viewerStyles = {
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
  ariaLables: { collapseJson: "收起 JSON", expandJson: "展开 JSON" },
};

function stringify(value: unknown): string {
  try { return JSON.stringify(value, null, 2) ?? "null"; } catch { return "[无法序列化]"; }
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

export function JsonViewer({ value, label = "JSON 数据" }: { value: unknown; label?: string }) {
  const data = parseJsonDocument(value);
  if (data === null) return <pre className="json-viewer json-viewer--primitive" aria-label={label}>{stringify(value)}</pre>;
  return <JsonView data={data} aria-label={label} style={viewerStyles} shouldExpandNode={expandUsefulLevels} clickToExpandNode />;
}
