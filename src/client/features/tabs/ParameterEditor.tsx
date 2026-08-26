import { useEffect, useMemo, useState } from "react";
import type { DebugTabSummary } from "../../api/api-client.js";
import { formatRawArguments, parseRawArguments } from "../../../shared/json.js";
import { validateJsonSchema, type SchemaIssue } from "../../../shared/json-schema.js";
import { fieldsFromSchema, requiresWholeArgumentsFallback, valueFromInput } from "./schema-form.js";

interface Props {
  tab: DebugTabSummary; schema: Record<string, unknown>;
  onChange: (patch: Partial<DebugTabSummary>) => void; onExecute?: () => void;
  onSaveRequest?: (argumentsValue: Record<string, unknown>) => void;
  executing?: boolean;
  subtreeDrafts?: Readonly<Record<string, { text: string; base: string }>>;
  onSubtreeDraftChange?: (path: string, text: string, base: string) => void;
}

function issueMessage(issue: SchemaIssue): string {
  if (issue.keyword === "required") return "请输入必填参数";
  if (issue.keyword === "type") return "参数类型不符合 Tool Schema";
  if (issue.keyword === "enum") return "请选择 Tool Schema 允许的值";
  if (issue.keyword === "format") return "参数格式不符合 Tool Schema";
  if (issue.keyword === "pattern") return "参数内容不符合格式约束";
  if (["minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum"].includes(issue.keyword)) {
    return "参数数值超出允许范围";
  }
  if (["minLength", "maxLength"].includes(issue.keyword)) return "参数长度不符合约束";
  return `参数不符合 ${issue.keyword} 约束`;
}

function rawErrorMessage(message: string): string {
  return /unexpected end/i.test(message)
    ? "JSON 尚未填写完整"
    : "JSON 语法错误，请检查括号、引号和逗号";
}

function JsonSubtreeEditor({ id, value, describedBy, draft, objectOnly = false, required = false, onDraftChange, onCommit }: {
  id: string; value: unknown; describedBy?: string; draft?: { text: string; base: string };
  objectOnly?: boolean; required?: boolean; onDraftChange?: (text: string, base: string) => void; onCommit: (value: unknown) => void;
}) {
  const formatted = value === undefined ? "" : JSON.stringify(value, null, 2);
  const [localText, setLocalText] = useState(formatted);
  const [invalid, setInvalid] = useState(false);
  const text = draft?.base === formatted ? draft.text : draft === undefined ? localText : formatted;
  useEffect(() => { if (draft === undefined) setLocalText(formatted); }, [draft, formatted]);
  return <><textarea id={id} value={text} required={required} placeholder={required ? "请输入必填参数" : undefined}
    aria-describedby={describedBy} aria-invalid={invalid}
    onChange={(event) => { onDraftChange?.(event.target.value, formatted); if (draft === undefined) setLocalText(event.target.value); setInvalid(false); }}
    onBlur={() => { try { const parsed: unknown = JSON.parse(text);
      if (objectOnly && (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))) throw new Error("object required");
      onCommit(parsed); setInvalid(false); } catch { setInvalid(true); } }} />
    {invalid && <p role="alert">{objectOnly ? "必须是 JSON 对象" : "请输入有效 JSON"}</p>}</>;
}

export function ParameterEditor({ tab, schema, onChange, onExecute, onSaveRequest, executing = false, subtreeDrafts = {}, onSubtreeDraftChange }: Props) {
  const [rawTouched, setRawTouched] = useState(false);
  const parsed = parseRawArguments(tab.rawText);
  const validation = validateJsonSchema(schema, tab.inputMode === "raw" && parsed.ok ? parsed.value : tab.arguments);
  const fields = useMemo(() => fieldsFromSchema(schema, tab.arguments), [schema, tab.arguments]);
  const canExecute = validation.issues.length === 0 && (tab.inputMode === "form" || parsed.ok);
  const rawErrorId = `raw-${tab.id}-error`;

  function commitRaw(): boolean {
    const current = parseRawArguments(tab.rawText);
    if (!current.ok) { setRawTouched(true); return false; }
    onChange({ arguments: current.value, rawText: tab.rawText });
    return true;
  }
  function mode(mode: "form" | "raw"): boolean {
    if (mode === tab.inputMode) return true;
    if (tab.inputMode === "raw" && mode === "form" && parsed.ok) commitRaw();
    onChange({ inputMode: mode });
    return true;
  }
  function edit(name: string, value: unknown): void {
    const args = { ...tab.arguments, [name]: value };
    onChange({ arguments: args, rawText: formatRawArguments(args) });
  }
  function issuesAt(path: string): SchemaIssue[] { return validation.issues.filter((item) => item.path === path); }
  function execute(): void {
    if (!executing && canExecute && (tab.inputMode === "form" || commitRaw())) onExecute?.();
  }
  function rawChanged(text: string): void {
    const current = parseRawArguments(text);
    onChange(current.ok ? { rawText: text, arguments: current.value } : { rawText: text });
  }
  const wholeFallback = requiresWholeArgumentsFallback(schema);

  return <section className="parameter-editor" onKeyDown={(event) => {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") { event.preventDefault(); execute(); }
  }}>
    <div className="editor-toolbar">
      <div className="editor-mode-group"><span>参数输入</span>
        <div role="tablist" aria-label="参数输入模式" onKeyDown={(event) => {
          if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
          const nextMode = event.key === "Home" ? "form" : event.key === "End" ? "raw" : tab.inputMode === "form" ? "raw" : "form";
          event.preventDefault(); if (mode(nextMode)) queueMicrotask(() => document.getElementById(`mode-${nextMode}-${tab.id}`)?.focus());
        }}>
          <button id={`mode-form-${tab.id}`} aria-controls={`panel-form-${tab.id}`} type="button" role="tab" tabIndex={tab.inputMode === "form" ? 0 : -1} aria-selected={tab.inputMode === "form"} onClick={() => mode("form")}>Form</button>
          <button id={`mode-raw-${tab.id}`} aria-controls={`panel-raw-${tab.id}`} type="button" role="tab" tabIndex={tab.inputMode === "raw" ? 0 : -1} aria-selected={tab.inputMode === "raw"} onClick={() => mode("raw")}>Raw JSON</button>
        </div>
      </div>
      <div className="editor-actions">{onSaveRequest !== undefined && <button type="button" disabled={tab.inputMode === "raw" && !parsed.ok}
        onClick={() => onSaveRequest(tab.inputMode === "raw" && parsed.ok ? parsed.value : tab.arguments)}>保存请求</button>}
        <button type="button" onClick={() => void navigator.clipboard?.writeText(
        tab.inputMode === "raw" && parsed.ok ? formatRawArguments(parsed.value) : formatRawArguments(tab.arguments))}>复制参数</button>
        <button type="button" className="editor-execute" disabled={!canExecute || executing} onClick={execute}>{executing ? "执行中…" : "执行"}</button></div>
    </div>
    {validation.warning !== null && <p role="status" className="editor-warning">{validation.warning}</p>}
    {tab.inputMode === "form" && !parsed.ok && <p role="status" className="editor-warning">
      Raw JSON 草稿暂时无效。Form 正在使用上一次有效参数，返回 Raw JSON 后可继续修改草稿。
    </p>}
    {tab.inputMode === "raw" ? <div id={`panel-raw-${tab.id}`} role="tabpanel" aria-labelledby={`mode-raw-${tab.id}`} className="raw-arguments-panel">
      <div className="raw-arguments-heading"><label htmlFor={`raw-${tab.id}`}>完整 arguments JSON</label><span>JSON Object</span></div>
      <textarea id={`raw-${tab.id}`} value={tab.rawText} onChange={(event) => rawChanged(event.target.value)}
        onBlur={() => commitRaw()} aria-invalid={!parsed.ok || validation.issues.length > 0}
        aria-describedby={!parsed.ok || validation.issues.length > 0 ? rawErrorId : undefined} />
      {!parsed.ok && (rawTouched || tab.inputMode === "raw") && <p id={rawErrorId} role="alert">
        {rawErrorMessage(parsed.message)}{parsed.offset === null ? "" : `（位置 ${parsed.offset}）`}
      </p>}
      {parsed.ok && validation.issues.length > 0 && <div id={rawErrorId} className="validation-summary" role="alert"><strong>参数尚未满足 Tool Schema</strong>
        <p>可以继续在 Form 或 Raw JSON 中修改，满足全部约束后即可执行。</p>
        <ul>{validation.issues.map((item) => <li key={`${item.path}:${item.keyword}`}><code>{item.path || "/"}</code><span>{issueMessage(item)}</span></li>)}</ul>
      </div>}
    </div> : <div id={`panel-form-${tab.id}`} role="tabpanel" aria-labelledby={`mode-form-${tab.id}`} className="schema-fields">
      {wholeFallback && <div className="schema-field schema-field--json schema-field--whole">
        <label htmlFor={`${tab.id}-whole`}>完整 arguments（复杂 Schema）</label>
        <JsonSubtreeEditor id={`${tab.id}-whole`} value={tab.arguments} draft={subtreeDrafts[""]} objectOnly
          onDraftChange={(text, base) => onSubtreeDraftChange?.("", text, base)}
          onCommit={(value) => onChange({ arguments: value as Record<string, unknown>, rawText: formatRawArguments(value as Record<string, unknown>) })} />
      </div>}
      {!wholeFallback && fields.map((field) => {
        const errors = issuesAt(field.path); const inputId = `${tab.id}-${field.name}`;
        const visibleErrors = errors.filter(({ keyword }) => keyword !== "required");
        const describedBy = visibleErrors.length > 0 ? `${inputId}-error` : undefined;
        return <div className={`schema-field schema-field--${field.kind}`} key={field.name}>
          <label htmlFor={inputId}>{field.name}{field.required && <><span className="required-marker" aria-hidden="true">*</span><span className="sr-only">必填</span></>}
            {field.additional ? "（附加参数）" : ""}</label>
          {field.description && <p>{field.description}</p>}
          {field.defaultValue !== undefined && field.value === undefined && <p>默认值：{JSON.stringify(field.defaultValue)}</p>}
          {Object.keys(field.constraints).length > 0 && <p>约束：{Object.entries(field.constraints)
            .map(([name, value]) => `${name}=${String(value)}`).join("，")}</p>}
          {field.kind === "boolean" ? <input id={inputId} type="checkbox" checked={Boolean(field.value)}
            aria-invalid={errors.length > 0} aria-describedby={describedBy}
            onChange={(event) => edit(field.name, event.target.checked)} />
          : field.kind === "enum" ? <select id={inputId} value={String(field.enumValues?.findIndex((item) => Object.is(item, field.value)) ?? "")}
              required={field.required} aria-invalid={errors.length > 0} aria-describedby={describedBy}
              onChange={(event) => { const next = valueFromInput(field, event.target.value); if (next.ok) edit(field.name, next.value); }}>
              <option value="">{field.required ? "请选择必填参数" : "请选择"}</option>{field.enumValues?.map((item, index) => <option value={index} key={index}>{String(item)}</option>)}</select>
          : field.kind === "json" ? <JsonSubtreeEditor id={inputId} value={field.value} describedBy={describedBy}
              required={field.required} draft={subtreeDrafts[field.path]} onDraftChange={(text, base) => onSubtreeDraftChange?.(field.path, text, base)}
              onCommit={(value) => edit(field.name, value)} />
          : <input id={inputId} type={field.kind === "string" ? "text" : "number"} value={field.value === undefined ? "" : String(field.value)}
              step={field.kind === "integer" ? 1 : "any"} required={field.required} placeholder={field.required ? "请输入必填参数" : undefined}
              aria-invalid={errors.length > 0} aria-describedby={describedBy}
              min={typeof field.constraints.minimum === "number" ? field.constraints.minimum : undefined}
              max={typeof field.constraints.maximum === "number" ? field.constraints.maximum : undefined}
              minLength={typeof field.constraints.minLength === "number" ? field.constraints.minLength : undefined}
              maxLength={typeof field.constraints.maxLength === "number" ? field.constraints.maxLength : undefined}
              pattern={typeof field.constraints.pattern === "string" ? field.constraints.pattern : undefined}
              onChange={(event) => { const next = valueFromInput(field, event.target.value); if (next.ok) edit(field.name, next.value); }} />}
          {visibleErrors.length > 0 && <p id={`${inputId}-error`} role="alert">{visibleErrors.map(issueMessage).join("；")}</p>}
        </div>;
      })}
    </div>}
  </section>;
}
