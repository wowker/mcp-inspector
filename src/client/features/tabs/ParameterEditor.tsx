import { useEffect, useMemo, useState, type ReactNode } from "react";
import { CaretRight, Play } from "@phosphor-icons/react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import "../../i18n/index.js";
import type { DebugTabSummary } from "../../api/api-client.js";
import { formatRawArguments, parseRawArguments } from "../../../shared/json.js";
import { validateJsonSchema, type SchemaIssue } from "../../../shared/json-schema.js";
import { arrayObjectItemSchema, discriminatedObjectBranches, fieldsFromSchema, objectValueIsSafe, requiresWholeArgumentsFallback, safeObjectEditorSchema, valueFromInput, type SchemaField } from "./schema-form.js";
import { BooleanSwitch, EnumControl } from "./ParameterControls.js";
import { ArrayObjectEditor } from "./ArrayObjectEditor.js";
import { JsonSubtreeEditor } from "./JsonSubtreeEditor.js";
import { BranchObjectEditor, ObjectFieldEditor } from "./ObjectFieldEditor.js";
import {
  fieldMatchesFilter,
  parameterStatus,
  summarizeConstraints,
  type ParameterFilter,
} from "./parameter-editor-model.js";

interface Props {
  tab: DebugTabSummary; schema: Record<string, unknown>;
  onChange: (patch: Partial<DebugTabSummary>) => void; onExecute?: () => void;
  onSaveRequest?: (argumentsValue: Record<string, unknown>) => void;
  layoutControls?: ReactNode;
  executing?: boolean;
  showExecute?: boolean;
  workflowEnabled?: boolean;
  deferRequiredValidation?: boolean;
  expanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
  subtreeDrafts?: Readonly<Record<string, { text: string; base: string }>>;
  onSubtreeDraftChange?: (path: string, text: string, base: string) => void;
}

function issueMessage(issue: SchemaIssue, t: TFunction<"tools">): string {
  if (issue.keyword === "required") return t("validation.required");
  if (issue.keyword === "type") return t("validation.type");
  if (issue.keyword === "enum") return t("validation.enum");
  if (issue.keyword === "format") return t("validation.format");
  if (issue.keyword === "pattern") return t("validation.pattern");
  if (["minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum"].includes(issue.keyword)) {
    return t("validation.range");
  }
  if (["minLength", "maxLength"].includes(issue.keyword)) return t("validation.length");
  return t("validation.generic", { keyword: issue.keyword });
}

function rawErrorMessage(message: string, t: TFunction<"tools">): string {
  return /unexpected end/i.test(message)
    ? t("parameter.jsonIncomplete")
    : t("parameter.jsonSyntax");
}

function initialOptionalValue(field: SchemaField): unknown {
  if (field.defaultValue !== undefined) return field.defaultValue;
  if (field.kind === "string") return "";
  if (field.kind === "boolean") return false;
  if (field.schema.type === "array") return [];
  if (field.schema.type === "object") return {};
  return null;
}

export function ParameterEditor({ tab, schema, onChange, onExecute, onSaveRequest, layoutControls, executing = false, workflowEnabled = false,
  deferRequiredValidation = false,
  showExecute = true, expanded: controlledExpanded, onExpandedChange, subtreeDrafts = {}, onSubtreeDraftChange }: Props) {
  const { t } = useTranslation("tools");
  const [rawTouched, setRawTouched] = useState(false);
  const [localExpanded, setLocalExpanded] = useState(true);
  const [filters, setFilters] = useState<Record<string, ParameterFilter>>({});
  const [expandedDescriptions, setExpandedDescriptions] = useState<Record<string, boolean>>({});
  const expanded = controlledExpanded ?? localExpanded;
  useEffect(() => { if (controlledExpanded === undefined) setLocalExpanded(true); }, [controlledExpanded, tab.id]);
  const rawText = tab.rawText.trim() === "{}" && Object.keys(tab.arguments).length === 0 ? "" : tab.rawText;
  const parsed = parseRawArguments(rawText);
  const fields = useMemo(() => fieldsFromSchema(schema, tab.arguments), [schema, tab.arguments]);
  const wholeFallback = requiresWholeArgumentsFallback(schema);
  const hasEditableArguments = wholeFallback || fields.length > 0;
  const inputMode = hasEditableArguments ? tab.inputMode : "form";
  const validation = validateJsonSchema(schema, inputMode === "raw" && parsed.ok ? parsed.value : tab.arguments);
  const blockingIssues = deferRequiredValidation
    ? validation.issues.filter(({ keyword }) => keyword !== "required")
    : validation.issues;
  const canExecute = blockingIssues.length === 0 && (inputMode === "form" || parsed.ok);
  const filter = filters[tab.id] ?? "all";
  const status = parameterStatus(fields, blockingIssues);
  const displayedFields = fields.filter((field) => fieldMatchesFilter(field, blockingIssues, filter));
  const rawErrorId = `raw-${tab.id}-error`;
  useEffect(() => {
    if (!hasEditableArguments && tab.inputMode === "raw") onChange({ inputMode: "form" });
  }, [hasEditableArguments, onChange, tab.inputMode]);

  function commitRaw(): boolean {
    const current = parseRawArguments(rawText);
    if (!current.ok) { setRawTouched(true); return false; }
    onChange({ arguments: current.value, rawText });
    return true;
  }
  function mode(mode: "form" | "raw"): boolean {
    if (mode === "raw" && !hasEditableArguments) return false;
    if (mode === inputMode) return true;
    if (inputMode === "raw" && mode === "form" && parsed.ok) commitRaw();
    onChange({ inputMode: mode });
    return true;
  }
  function edit(name: string, value: unknown): void {
    const args = { ...tab.arguments };
    if (value === undefined) delete args[name];
    else args[name] = value;
    onChange({ arguments: args, rawText: formatRawArguments(args) });
  }
  function issuesAt(path: string): SchemaIssue[] { return blockingIssues.filter((item) => item.path === path); }
  function focusFirstIssue(): void {
    const issue = blockingIssues[0];
    if (issue === undefined) return;
    const field = fields.find((candidate) => issue.path === candidate.path || issue.path.startsWith(`${candidate.path}/`));
    document.getElementById(field === undefined ? `raw-${tab.id}` : `${tab.id}-${field.name}`)?.focus();
  }
  function execute(): void {
    if (!executing && canExecute && (inputMode === "form" || commitRaw())) onExecute?.();
  }
  function rawChanged(text: string): void {
    const current = parseRawArguments(text);
    onChange(current.ok ? { rawText: text, arguments: current.value } : { rawText: text });
  }
  return <section className="parameter-editor" onKeyDown={(event) => {
    if (showExecute && (event.metaKey || event.ctrlKey) && event.key === "Enter") { event.preventDefault(); execute(); }
  }}>
    <div className="editor-toolbar">
      <div className="editor-primary-actions">
        <button type="button" className="editor-collapse" aria-expanded={expanded}
          aria-controls={`parameter-content-${tab.id}`} aria-label={expanded ? t("parameter.collapse") : t("parameter.expand")}
          title={expanded ? t("parameter.collapse") : t("parameter.expand")} onClick={() => {
            const next = !expanded;
            if (controlledExpanded === undefined) setLocalExpanded(next);
            onExpandedChange?.(next);
          }}>
          <CaretRight size={18} weight="bold" aria-hidden="true" />
        </button>
        <div className="editor-mode-group">
          <div role="tablist" aria-label={t("parameter.modes")} onKeyDown={(event) => {
            if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
            const nextMode = event.key === "Home" ? "form" : event.key === "End" ? "raw" : inputMode === "form" ? "raw" : "form";
            event.preventDefault(); if (mode(nextMode)) queueMicrotask(() => document.getElementById(`mode-${nextMode}-${tab.id}`)?.focus());
          }}>
            <button id={`mode-form-${tab.id}`} aria-controls={`panel-form-${tab.id}`} type="button" role="tab" tabIndex={inputMode === "form" ? 0 : -1} aria-selected={inputMode === "form"} onClick={() => mode("form")}>{t("parameter.formMode")}</button>
            <button id={`mode-raw-${tab.id}`} aria-controls={`panel-raw-${tab.id}`} type="button" role="tab" tabIndex={inputMode === "raw" ? 0 : -1} aria-selected={inputMode === "raw"}
              disabled={!hasEditableArguments} title={!hasEditableArguments ? t("parameter.noArguments") : undefined} onClick={() => mode("raw")}>{t("parameter.rawMode")}</button>
          </div>
        </div>
        {showExecute && <button type="button" className="editor-execute" disabled={!canExecute || executing} onClick={execute}>
          <Play size={14} weight="fill" aria-hidden="true" />{executing
            ? workflowEnabled ? t("parameter.executingWorkflow") : t("parameter.executing")
            : workflowEnabled ? t("parameter.executeWorkflow") : t("parameter.execute")}
        </button>}
      </div>
      <div className="editor-actions">{layoutControls}{onSaveRequest !== undefined && <button type="button" className="run-result-action" disabled={inputMode === "raw" && !parsed.ok}
        onClick={() => onSaveRequest(inputMode === "raw" && parsed.ok ? parsed.value : tab.arguments)}>{t("parameter.saveRequest")}</button>}
        <button type="button" className="run-result-action" onClick={() => void navigator.clipboard?.writeText(
        inputMode === "raw" && parsed.ok ? formatRawArguments(parsed.value) : formatRawArguments(tab.arguments))}>{t("parameter.copyArguments")}</button></div>
    </div>
    {expanded && <div id={`parameter-content-${tab.id}`} className="parameter-content">
    {validation.warning !== null && <p role="status" className="editor-warning">{validation.warning}</p>}
    {deferRequiredValidation && <p role="status" className="editor-warning">{t("parameter.deferredWarning")}</p>}
    {inputMode === "form" && !parsed.ok && hasEditableArguments && <p role="status" className="editor-warning">
      {t("parameter.rawDraftWarning")}
    </p>}
    {inputMode === "form" && !wholeFallback && fields.length > 0 &&
      (status.requiredTotal > 0 || status.errorCount > 0 || fields.length >= 6) && <div className="parameter-overview">
      <div className="parameter-status" aria-label={t("parameter.statusLabel")}>
        {status.requiredTotal > 0 && <span>{t("parameter.requiredStatus", { completed: status.requiredCompleted, total: status.requiredTotal })}</span>}
        {status.errorCount > 0 && <button type="button" onClick={focusFirstIssue}
          aria-label={t("parameter.focusError", { count: status.errorCount })}>{t("parameter.errorStatus", { count: status.errorCount })}</button>}
      </div>
      {fields.length >= 6 && <div className="parameter-filters" role="group" aria-label={t("parameter.filterLabel")}>
        {(["all", "required", "filled", "errors"] as const).map((value) => <button type="button" key={value}
          aria-pressed={filter === value} onClick={() => setFilters((current) => ({ ...current, [tab.id]: value }))}>
          {t({ all: "parameter.filterAll", required: "parameter.filterRequired", filled: "parameter.filterFilled", errors: "parameter.filterErrors" }[value])}
        </button>)}
      </div>}
    </div>}
    {inputMode === "raw" ? <div id={`panel-raw-${tab.id}`} role="tabpanel" aria-labelledby={`mode-raw-${tab.id}`} className="raw-arguments-panel">
      <div className="raw-arguments-heading"><label htmlFor={`raw-${tab.id}`}>{t("parameter.wholeJson")}</label><span>{t("parameter.jsonObject")}</span></div>
      <textarea id={`raw-${tab.id}`} value={rawText} onChange={(event) => rawChanged(event.target.value)}
        onBlur={() => commitRaw()} aria-invalid={!parsed.ok || blockingIssues.length > 0}
        aria-describedby={!parsed.ok || blockingIssues.length > 0 ? rawErrorId : undefined} />
      {!parsed.ok && (rawTouched || inputMode === "raw") && <p id={rawErrorId} role="alert">
        {rawErrorMessage(parsed.message, t)}{parsed.offset === null ? "" : t("parameter.jsonPosition", { offset: parsed.offset })}
      </p>}
      {parsed.ok && blockingIssues.length > 0 && <div id={rawErrorId} className="validation-summary" role="alert"><strong>{t("parameter.rawInvalidTitle")}</strong>
        <p>{t("parameter.rawInvalidHint")}</p>
        <ul>{blockingIssues.map((item) => <li key={`${item.path}:${item.keyword}`}><code>{item.path || "/"}</code><span>{issueMessage(item, t)}</span></li>)}</ul>
      </div>}
    </div> : <div id={`panel-form-${tab.id}`} role="tabpanel" aria-labelledby={`mode-form-${tab.id}`} className="schema-fields">
      {wholeFallback && <div className="schema-field schema-field--json schema-field--whole">
        <label htmlFor={`${tab.id}-whole`}>{t("parameter.wholeArguments")}</label>
        <JsonSubtreeEditor id={`${tab.id}-whole`} fieldName="arguments" value={tab.arguments} draft={subtreeDrafts[""]} objectOnly
          onDraftChange={(text, base) => onSubtreeDraftChange?.("", text, base)}
          onCommit={(value) => onChange({ arguments: value as Record<string, unknown>, rawText: formatRawArguments(value as Record<string, unknown>) })} />
      </div>}
      {!wholeFallback && fields.length === 0 && (
        <div className="parameter-empty" role="status">
          <strong>{t("parameter.emptyTitle")}</strong>
          <span>{t("parameter.emptyHint")}</span>
        </div>
      )}
      {!wholeFallback && displayedFields.map((field) => {
        const included = field.required || Object.hasOwn(tab.arguments, field.name);
        const skipped = !included;
        const errors = included ? issuesAt(field.path) : []; const inputId = `${tab.id}-${field.name}`;
        const labelId = `${inputId}-label`;
        const visibleErrors = errors.filter(({ keyword }) => keyword !== "required");
        const describedBy = visibleErrors.length > 0 ? `${inputId}-error` : undefined;
        return <div className={`schema-field schema-field--${field.kind}`} key={field.name}>
          <div className="schema-field__heading">
            <label id={labelId} htmlFor={field.kind === "enum" ? undefined : inputId}>{field.name}{field.required && <><span className="required-marker" aria-hidden="true">*</span><span className="sr-only">{t("parameter.required")}</span></>}
              {field.additional ? t("parameter.additional") : ""}</label>
            {!field.required && !field.additional && <label className="schema-field__skip" title={t("parameter.skipTitle")}>
              <input type="checkbox" checked={skipped} aria-label={t("parameter.skipAria", { name: field.name })}
                onChange={(event) => edit(field.name, event.target.checked ? undefined : initialOptionalValue(field))} />
                <span>{t("parameter.skipText")}</span>
            </label>}
          </div>
          {field.description && <div className="schema-field__description-wrap"><p className={expandedDescriptions[`${tab.id}:${field.path}`]
            ? "schema-field__description" : "schema-field__description schema-field__description--clamped"}>{field.description}</p>
            {field.description.length > 120 && <button type="button" aria-label={t(expandedDescriptions[`${tab.id}:${field.path}`]
              ? "parameter.collapseDescription" : "parameter.expandDescription", { name: field.name })}
              onClick={() => setExpandedDescriptions((current) => ({ ...current, [`${tab.id}:${field.path}`]: !current[`${tab.id}:${field.path}`] }))}>
              {t(expandedDescriptions[`${tab.id}:${field.path}`] ? "parameter.collapseText" : "parameter.expandText")}
            </button>}</div>}
          {field.defaultValue !== undefined && field.value === undefined && <p>{t("parameter.defaultValue", { value: JSON.stringify(field.defaultValue) })}</p>}
          <div className="schema-field__metadata" aria-hidden="true">
            {summarizeConstraints(field).map((item) => <span key={item}>{item}</span>)}
          </div>
          {field.kind === "boolean" ? <BooleanSwitch id={inputId} labelId={labelId} checked={Boolean(field.value)}
            disabled={!included} invalid={errors.length > 0} describedBy={describedBy} onChange={(checked) => edit(field.name, checked)} />
          : field.kind === "enum" ? <EnumControl id={inputId} labelId={labelId} value={field.value}
              options={field.enumValues ?? []} required={field.required} invalid={errors.length > 0}
              disabled={!included} describedBy={describedBy} onSelect={(index) => edit(field.name, field.enumValues?.[index])}
              onClear={() => edit(field.name, undefined)} />
          : field.kind === "json" && discriminatedObjectBranches(field.schema) !== null &&
            (field.value === undefined || objectValueIsSafe(field.value))
            ? <BranchObjectEditor id={inputId} fieldName={field.name} fieldPath={field.path}
              model={discriminatedObjectBranches(field.schema)!}
              value={typeof field.value === "object" && field.value !== null && !Array.isArray(field.value)
                ? field.value as Record<string, unknown> : {}}
              disabled={!included} drafts={subtreeDrafts} onDraftChange={onSubtreeDraftChange}
              onChange={(value) => edit(field.name, value)} />
          : field.kind === "json" && safeObjectEditorSchema(field.schema, field.value) !== null
            ? <ObjectFieldEditor id={inputId} fieldName={field.name} fieldPath={field.path}
              schema={safeObjectEditorSchema(field.schema, field.value)!}
              value={typeof field.value === "object" && field.value !== null && !Array.isArray(field.value)
                ? field.value as Record<string, unknown> : {}}
              disabled={!included} drafts={subtreeDrafts} onDraftChange={onSubtreeDraftChange}
              onChange={(value) => edit(field.name, value)} />
          : field.kind === "json" && arrayObjectItemSchema(field.schema) !== null && Array.isArray(field.value)
            ? <ArrayObjectEditor id={inputId} fieldName={field.name} itemSchema={arrayObjectItemSchema(field.schema)!}
              value={field.value} disabled={!included} onChange={(value) => edit(field.name, value)} />
          : field.kind === "json" ? <JsonSubtreeEditor id={inputId} fieldName={field.name} value={field.value} describedBy={describedBy}
              ariaLabel={field.name}
              required={field.required} disabled={!included} draft={subtreeDrafts[field.path]} onDraftChange={(text, base) => onSubtreeDraftChange?.(field.path, text, base)}
              onCommit={(value) => edit(field.name, value)} />
          : <input id={inputId} type={field.kind === "string" ? "text" : "number"} value={field.value === undefined ? "" : String(field.value)}
              step={field.kind === "integer" ? 1 : "any"} required={field.required} placeholder={field.required ? t("parameter.requiredPlaceholder") : undefined}
              disabled={!included}
              aria-invalid={errors.length > 0} aria-describedby={describedBy}
              min={typeof field.constraints.minimum === "number" ? field.constraints.minimum : undefined}
              max={typeof field.constraints.maximum === "number" ? field.constraints.maximum : undefined}
              minLength={typeof field.constraints.minLength === "number" ? field.constraints.minLength : undefined}
              maxLength={typeof field.constraints.maxLength === "number" ? field.constraints.maxLength : undefined}
              pattern={typeof field.constraints.pattern === "string" ? field.constraints.pattern : undefined}
              onChange={(event) => { const next = valueFromInput(field, event.target.value); if (next.ok) edit(field.name, next.value); }} />}
          {visibleErrors.length > 0 && <p id={`${inputId}-error`} role="alert">{visibleErrors.map((issue) => issueMessage(issue, t)).join("；")}</p>}
        </div>;
      })}
    </div>}
    </div>}
  </section>;
}
