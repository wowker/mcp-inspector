import { useEffect, useMemo, useState } from "react";
import type { DebugTabSummary } from "../../api/api-client.js";
import { formatRawArguments, parseRawArguments } from "../../../shared/json.js";
import { validateJsonSchema, type SchemaIssue } from "../../../shared/json-schema.js";
import { fieldsFromSchema, valueFromInput } from "./schema-form.js";

interface Props {
  tab: DebugTabSummary; schema: Record<string, unknown>;
  onChange: (patch: Partial<DebugTabSummary>) => void; onExecute?: () => void;
}

function JsonSubtreeEditor({ id, value, describedBy, onCommit }: {
  id: string; value: unknown; describedBy?: string; onCommit: (value: unknown) => void;
}) {
  const formatted = value === undefined ? "" : JSON.stringify(value, null, 2);
  const [text, setText] = useState(formatted);
  const [invalid, setInvalid] = useState(false);
  useEffect(() => setText(formatted), [formatted]);
  return <><textarea id={id} value={text} aria-describedby={describedBy} aria-invalid={invalid}
    onChange={(event) => { setText(event.target.value); setInvalid(false); }}
    onBlur={() => { try { onCommit(JSON.parse(text)); setInvalid(false); } catch { setInvalid(true); } }} />
    {invalid && <p role="alert">请输入有效 JSON</p>}</>;
}

export function ParameterEditor({ tab, schema, onChange, onExecute }: Props) {
  const [rawTouched, setRawTouched] = useState(false);
  const parsed = parseRawArguments(tab.rawText);
  const validation = validateJsonSchema(schema, tab.inputMode === "raw" && parsed.ok ? parsed.value : tab.arguments);
  const fields = useMemo(() => fieldsFromSchema(schema, tab.arguments), [schema, tab.arguments]);
  const canExecute = parsed.ok && validation.issues.length === 0;

  function commitRaw(): boolean {
    const current = parseRawArguments(tab.rawText);
    if (!current.ok) { setRawTouched(true); return false; }
    const result = validateJsonSchema(schema, current.value);
    onChange({ arguments: current.value, rawText: tab.rawText });
    return result.issues.length === 0;
  }
  function mode(mode: "form" | "raw"): void {
    if (mode === "form" && !commitRaw()) return;
    onChange({ inputMode: mode });
  }
  function edit(name: string, value: unknown): void {
    const args = { ...tab.arguments, [name]: value };
    onChange({ arguments: args, rawText: formatRawArguments(args) });
  }
  function issuesAt(path: string): SchemaIssue[] { return validation.issues.filter((item) => item.path === path); }
  function execute(): void { if (commitRaw() && canExecute) onExecute?.(); }

  return <section className="parameter-editor" onKeyDown={(event) => {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") { event.preventDefault(); execute(); }
  }}>
    <div className="editor-toolbar">
      <div role="tablist" aria-label="参数输入模式">
        <button type="button" role="tab" aria-selected={tab.inputMode === "form"} onClick={() => mode("form")}>Form</button>
        <button type="button" role="tab" aria-selected={tab.inputMode === "raw"} onClick={() => mode("raw")}>Raw JSON</button>
      </div>
      <button type="button" onClick={() => void navigator.clipboard?.writeText(formatRawArguments(tab.arguments))}>复制参数</button>
      <button type="button" disabled={!canExecute} onClick={execute}>执行</button>
    </div>
    {validation.warning !== null && <p role="status">{validation.warning}</p>}
    {tab.inputMode === "raw" ? <div>
      <label htmlFor={`raw-${tab.id}`}>完整 arguments JSON</label>
      <textarea id={`raw-${tab.id}`} value={tab.rawText} onChange={(event) => onChange({ rawText: event.target.value })}
        onBlur={() => commitRaw()} aria-invalid={!parsed.ok || validation.issues.length > 0} />
      {!parsed.ok && (rawTouched || tab.inputMode === "raw") && <p role="alert">{parsed.message}{parsed.offset === null ? "" : `（位置 ${parsed.offset}）`}</p>}
      {parsed.ok && validation.issues.map((item) => <p role="alert" key={`${item.path}:${item.keyword}`}>{item.path || "/"}：{item.message}</p>)}
    </div> : <div className="schema-fields">
      {fields.map((field) => {
        const errors = issuesAt(field.path); const inputId = `${tab.id}-${field.name}`;
        const describedBy = errors.length > 0 ? `${inputId}-error` : undefined;
        return <div className="schema-field" key={field.name}>
          <label htmlFor={inputId}>{field.name}{field.required ? "（必填）" : ""}{field.additional ? "（附加参数）" : ""}</label>
          {field.description && <p>{field.description}</p>}
          {field.defaultValue !== undefined && field.value === undefined && <p>默认值：{JSON.stringify(field.defaultValue)}</p>}
          {field.kind === "boolean" ? <input id={inputId} type="checkbox" checked={Boolean(field.value)} aria-describedby={describedBy}
            onChange={(event) => edit(field.name, event.target.checked)} />
          : field.kind === "enum" ? <select id={inputId} value={String(field.enumValues?.findIndex((item) => Object.is(item, field.value)) ?? "")}
              aria-describedby={describedBy} onChange={(event) => { const next = valueFromInput(field, event.target.value); if (next.ok) edit(field.name, next.value); }}>
              <option value="">请选择</option>{field.enumValues?.map((item, index) => <option value={index} key={index}>{String(item)}</option>)}</select>
          : field.kind === "json" ? <JsonSubtreeEditor id={inputId} value={field.value} describedBy={describedBy}
              onCommit={(value) => edit(field.name, value)} />
          : <input id={inputId} type={field.kind === "string" ? "text" : "number"} value={field.value === undefined ? "" : String(field.value)}
              step={field.kind === "integer" ? 1 : "any"} aria-describedby={describedBy}
              min={typeof field.constraints.minimum === "number" ? field.constraints.minimum : undefined}
              max={typeof field.constraints.maximum === "number" ? field.constraints.maximum : undefined}
              minLength={typeof field.constraints.minLength === "number" ? field.constraints.minLength : undefined}
              maxLength={typeof field.constraints.maxLength === "number" ? field.constraints.maxLength : undefined}
              onChange={(event) => { const next = valueFromInput(field, event.target.value); if (next.ok) edit(field.name, next.value); }} />}
          {errors.length > 0 && <p id={`${inputId}-error`} role="alert">{errors.map(({ message }) => message).join("；")}</p>}
        </div>;
      })}
    </div>}
  </section>;
}
