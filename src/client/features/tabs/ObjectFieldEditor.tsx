import { useEffect, useId, useState } from "react";
import { CaretRight } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import "../../i18n/index.js";
import { ArrayObjectEditor } from "./ArrayObjectEditor.js";
import { JsonSubtreeEditor, type JsonSubtreeDraft } from "./JsonSubtreeEditor.js";
import { BooleanSwitch, EnumControl } from "./ParameterControls.js";
import {
  appendJsonPointer,
  arrayObjectItemSchema,
  discriminatedObjectBranches,
  fieldsFromSchema,
  objectValueIsSafe,
  planObjectBranchSwitch,
  safeObjectEditorSchema,
  selectedObjectBranch,
  type ObjectBranchModel,
  valueFromInput,
  type SchemaField,
} from "./schema-form.js";

const MAX_STRUCTURED_OBJECT_DEPTH = 2;

interface Props {
  id: string;
  fieldName: string;
  fieldPath: string;
  schema: Record<string, unknown>;
  value: Record<string, unknown>;
  disabled?: boolean;
  depth?: number;
  labelPrefix?: string;
  drafts: Readonly<Record<string, JsonSubtreeDraft>>;
  onDraftChange?: (path: string, text: string, base: string) => void;
  onChange: (value: Record<string, unknown>) => void;
}

interface BranchProps extends Omit<Props, "schema"> {
  model: ObjectBranchModel;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function initialOptionalValue(field: SchemaField): unknown {
  if (field.defaultValue !== undefined) return field.defaultValue;
  if (field.kind === "string") return "";
  if (field.kind === "boolean") return false;
  if (field.schema.type === "array") return [];
  if (field.schema.type === "object") return {};
  return null;
}

function branchEditorSchema(model: ObjectBranchModel, optionIndex: number,
  value: Record<string, unknown>): Record<string, unknown> | null {
  const option = model.options[optionIndex];
  if (option === undefined) return null;
  const properties = isRecord(option.schema.properties) ? { ...option.schema.properties } : {};
  delete properties[model.propertyName];
  if (Object.keys(properties).length === 0) return null;
  const schema: Record<string, unknown> = { ...option.schema, properties };
  if (Array.isArray(schema.required)) {
    schema.required = schema.required.filter((name): name is string =>
      typeof name === "string" && name !== model.propertyName);
  }
  return safeObjectEditorSchema(schema, value);
}

export function BranchObjectEditor({ id, fieldName, fieldPath, model, value, disabled = false, depth = 0,
  labelPrefix = fieldName, drafts, onDraftChange, onChange }: BranchProps) {
  const { t } = useTranslation("tools");
  const selected = selectedObjectBranch(model, value);
  const [pendingIndex, setPendingIndex] = useState<number | null>(null);
  const pendingPlan = pendingIndex === null ? null : planObjectBranchSwitch(model, value, pendingIndex);
  const schema = branchEditorSchema(model, selected, value);
  useEffect(() => { setPendingIndex(null); }, [selected]);

  function apply(optionIndex: number): void {
    const plan = planObjectBranchSwitch(model, value, optionIndex);
    if (plan.removed.length > 0) { setPendingIndex(optionIndex); return; }
    onChange(plan.value);
  }

  return <section className="branch-object-editor" role="group" aria-label={t("parameter.branchGroup", { name: fieldName })}>
    <div className="branch-object-editor__choices" role="radiogroup" aria-label={t("parameter.branchGroup", { name: fieldName })}>
      {model.options.map((option, index) => <label className="schema-radio-option" key={`${option.title}:${JSON.stringify(option.value)}`}>
        <input type="radio" name={`${id}-branch`} checked={selected === index} disabled={disabled}
          onChange={() => apply(index)} />
        <span className="schema-radio-option__dot" aria-hidden="true" /><span>{option.title}</span>
      </label>)}
    </div>
    {pendingIndex !== null && pendingPlan !== null && <div className="branch-object-editor__confirmation" role="alert"
      aria-label={t("parameter.confirmBranchAria", { name: fieldName })}>
      <strong>{t("parameter.confirmBranchTitle")}</strong>
      <p>{t("parameter.confirmBranchHint", { fields: pendingPlan.removed.join(", ") })}</p>
      <div><button type="button" className="button-secondary" onClick={() => setPendingIndex(null)}>{t("parameter.cancelBranch")}</button>
        <button type="button" className="button-danger" onClick={() => {
          onChange(pendingPlan.value); setPendingIndex(null);
        }}>{t("parameter.confirmBranch")}</button></div>
    </div>}
    {schema !== null && <ObjectFieldEditor id={`${id}-fields`} fieldName={fieldName} fieldPath={fieldPath}
      schema={schema} value={value} disabled={disabled} depth={depth} labelPrefix={labelPrefix}
      drafts={drafts} onDraftChange={onDraftChange} onChange={onChange} />}
  </section>;
}

function NestedField({ id, field, parentPath, labelPrefix, depth, disabled, drafts, onDraftChange, onChange }: {
  id: string;
  field: SchemaField;
  parentPath: string;
  labelPrefix: string;
  depth: number;
  disabled: boolean;
  drafts: Readonly<Record<string, JsonSubtreeDraft>>;
  onDraftChange?: (path: string, text: string, base: string) => void;
  onChange: (value: unknown) => void;
}) {
  const { t } = useTranslation("tools");
  const inputId = `${id}-${field.name}`;
  const labelId = `${inputId}-label`;
  const fieldPath = appendJsonPointer(parentPath, field.name);
  const accessibleName = `${labelPrefix} ${field.name}`;
  const included = field.required || field.value !== undefined;
  const branchModel = discriminatedObjectBranches(field.schema);
  const objectSchema = safeObjectEditorSchema(field.schema, field.value);
  const canRecurse = objectSchema !== null && depth + 1 < MAX_STRUCTURED_OBJECT_DEPTH;
  const itemSchema = arrayObjectItemSchema(field.schema);
  return <div className={`nested-object-field nested-object-field--${field.kind}`}>
    <div className="nested-object-field__heading">
      <label id={labelId} htmlFor={field.kind === "enum" || canRecurse ? undefined : inputId}>{field.name}
        {field.required && <><span className="required-marker" aria-hidden="true">*</span><span className="sr-only">{t("parameter.required")}</span></>}
      </label>
      {!field.required && !field.additional && <label className="schema-field__skip" title={t("parameter.skipTitle")}>
        <input type="checkbox" checked={!included} aria-label={t("parameter.skipAria", { name: accessibleName })}
          onChange={(event) => onChange(event.target.checked ? undefined : initialOptionalValue(field))} />
        <span>{t("parameter.skipText")}</span>
      </label>}
    </div>
    {field.description && <p className="nested-object-field__description">{field.description}</p>}
    {field.kind === "boolean" ? <BooleanSwitch id={inputId} labelId={labelId} ariaLabel={accessibleName}
      checked={Boolean(field.value)} disabled={disabled || !included} invalid={false} onChange={onChange} />
    : field.kind === "enum" ? <EnumControl id={inputId} labelId={labelId} ariaLabel={accessibleName}
      value={field.value} options={field.enumValues ?? []} required={field.required} invalid={false}
      disabled={disabled || !included} onSelect={(index) => onChange(field.enumValues?.[index])} onClear={() => onChange(undefined)} />
    : branchModel !== null && (field.value === undefined || objectValueIsSafe(field.value))
      ? <BranchObjectEditor id={inputId} fieldName={field.name}
      fieldPath={fieldPath} model={branchModel} value={isRecord(field.value) ? field.value : {}}
      disabled={disabled || !included} depth={depth + 1}
      labelPrefix={accessibleName} drafts={drafts} onDraftChange={onDraftChange} onChange={onChange} />
    : canRecurse ? <ObjectFieldEditor id={inputId} fieldName={field.name} fieldPath={fieldPath} schema={objectSchema}
      value={isRecord(field.value) ? field.value : {}} disabled={disabled || !included} depth={depth + 1}
      labelPrefix={accessibleName} drafts={drafts} onDraftChange={onDraftChange} onChange={onChange} />
    : field.kind === "json" && itemSchema !== null && Array.isArray(field.value)
      ? <ArrayObjectEditor id={inputId} fieldName={field.name} itemSchema={itemSchema} value={field.value}
        disabled={disabled || !included} onChange={onChange} />
    : field.kind === "json" ? <JsonSubtreeEditor id={inputId} fieldName={field.name} value={field.value}
      ariaLabel={t(field.schema.type === "object" ? "parameter.objectJsonLabel" : "parameter.fieldJsonLabel", { name: field.name })}
      objectOnly={field.schema.type === "object"} required={field.required} disabled={disabled || !included}
      draft={drafts[fieldPath]} onDraftChange={(text, base) => onDraftChange?.(fieldPath, text, base)} onCommit={onChange} />
    : <input id={inputId} aria-label={accessibleName} type={field.kind === "string" ? "text" : "number"}
      value={field.value === undefined ? "" : String(field.value)} disabled={disabled || !included}
      required={field.required} placeholder={field.required ? t("parameter.requiredPlaceholder") : undefined}
      step={field.kind === "integer" ? 1 : "any"} onChange={(event) => {
        if (!field.required && event.target.value === "") { onChange(undefined); return; }
        const next = valueFromInput(field, event.target.value); if (next.ok) onChange(next.value);
      }} />}
  </div>;
}

export function ObjectFieldEditor({ id, fieldName, fieldPath, schema, value, disabled = false, depth = 0,
  labelPrefix = fieldName, drafts, onDraftChange, onChange }: Props) {
  const { t } = useTranslation("tools");
  const [mode, setMode] = useState<"form" | "raw">("form");
  const [expanded, setExpanded] = useState(true);
  const generatedId = useId().replaceAll(":", "");
  const panelId = `${id}-${generatedId}-object-panel`;
  const formTabId = `${id}-${generatedId}-object-form`;
  const rawTabId = `${id}-${generatedId}-object-raw`;
  const fields = fieldsFromSchema(schema, value);
  const summary = t("parameter.objectFields", { count: Object.keys(value).length });
  const groupLabel = t("parameter.objectGroup", { name: fieldName });

  function edit(field: SchemaField, nextValue: unknown): void {
    const next = { ...value };
    if (nextValue === undefined) delete next[field.name];
    else next[field.name] = nextValue;
    onChange(next);
  }

  function selectMode(nextMode: "form" | "raw"): void {
    setMode(nextMode);
    setExpanded(true);
  }

  return <section className="nested-object-editor" role="group" aria-label={groupLabel} data-depth={depth}>
    <header className="nested-object-editor__header">
      <button id={id} type="button" className="nested-object-editor__disclosure" aria-expanded={expanded}
        aria-controls={panelId} onClick={() => setExpanded((current) => !current)}>
        <CaretRight size={18} weight="bold" aria-hidden="true" />
        <span>{fieldName}</span><small>{summary}</small>
      </button>
      <div role="tablist" aria-label={t("parameter.fieldModes", { name: fieldName })} onKeyDown={(event) => {
        const nextMode = event.key === "ArrowRight" || event.key === "End" ? "raw"
          : event.key === "ArrowLeft" || event.key === "Home" ? "form" : null;
        if (nextMode === null) return;
        event.preventDefault();
        selectMode(nextMode);
        const targetId = nextMode === "form" ? formTabId : rawTabId;
        Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'))
          .find((tab) => tab.id === targetId)?.focus();
      }}>
        <button id={formTabId} type="button" role="tab" aria-selected={mode === "form"}
          tabIndex={mode === "form" ? 0 : -1} aria-controls={panelId} onClick={() => selectMode("form")}>{t("parameter.formMode")}</button>
        <button id={rawTabId} type="button" role="tab" aria-selected={mode === "raw"}
          tabIndex={mode === "raw" ? 0 : -1} aria-controls={panelId} onClick={() => selectMode("raw")}>{t("parameter.rawMode")}</button>
      </div>
    </header>
    {expanded && <div id={panelId} className="nested-object-editor__body" role="tabpanel"
      aria-labelledby={mode === "form" ? formTabId : rawTabId}>
      {mode === "raw" ? <JsonSubtreeEditor id={`${id}-raw`} fieldName={fieldName} value={value} objectOnly disabled={disabled}
        ariaLabel={t("parameter.objectJsonLabel", { name: fieldName })} draft={drafts[fieldPath]}
        onDraftChange={(text, base) => onDraftChange?.(fieldPath, text, base)}
        onCommit={(next) => { if (isRecord(next)) onChange(next); }} />
      : <div className="nested-object-editor__fields">
        {fields.length === 0 && <p className="nested-object-editor__empty">{t("parameter.objectEmpty")}</p>}
        {fields.map((field) => <NestedField key={field.path} id={id} field={field} parentPath={fieldPath}
          labelPrefix={labelPrefix} depth={depth} disabled={disabled} drafts={drafts} onDraftChange={onDraftChange}
          onChange={(next) => edit(field, next)} />)}
      </div>}
    </div>}
  </section>;
}
