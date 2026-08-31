import { useEffect, useId, useState } from "react";
import { ArrowDown, ArrowUp, CaretRight, Plus, Trash } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import type { SchemaField } from "./schema-form.js";
import { fieldsFromSchema, valueFromInput } from "./schema-form.js";
import { BooleanSwitch, EnumControl } from "./ParameterControls.js";

interface Props {
  id: string;
  fieldName: string;
  itemSchema: Record<string, unknown>;
  value: unknown[];
  disabled?: boolean;
  onChange: (value: unknown[]) => void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function ItemField({ field, itemLabel, disabled, onChange }: {
  field: SchemaField;
  itemLabel: string;
  disabled: boolean;
  onChange: (value: unknown) => void;
}) {
  const { t } = useTranslation("tools");
  const inputId = useId();
  const labelId = `${inputId}-label`;
  const label = `${itemLabel} ${field.name}`;
  if (field.kind === "boolean") {
    return <div className="array-object-field"><label id={labelId}>{field.name}</label>
      <BooleanSwitch id={inputId} labelId={labelId} checked={Boolean(field.value)} disabled={disabled}
        invalid={false} onChange={onChange} /></div>;
  }
  if (field.kind === "enum") {
    return <div className="array-object-field"><label id={labelId}>{field.name}</label>
      <EnumControl id={inputId} labelId={labelId} value={field.value} options={field.enumValues ?? []}
        required={field.required} invalid={false} disabled={disabled}
        onSelect={(index) => onChange(field.enumValues?.[index])} onClear={() => onChange(undefined)} /></div>;
  }
  if (field.kind === "json") {
    const text = field.value === undefined ? "" : JSON.stringify(field.value, null, 2);
    return <div className="array-object-field array-object-field--json"><label htmlFor={inputId}>{field.name}</label>
      <textarea id={inputId} aria-label={label} value={text} disabled={disabled}
        placeholder={field.required ? t("parameter.requiredPlaceholder") : undefined}
        onChange={(event) => {
          if (event.target.value.trim() === "") { if (!field.required) onChange(undefined); return; }
          try { onChange(JSON.parse(event.target.value)); } catch { /* Keep the last canonical value until JSON is valid. */ }
        }} /></div>;
  }
  return <div className="array-object-field"><label htmlFor={inputId}>{field.name}
    {field.required && <span className="required-marker" aria-hidden="true">*</span>}</label>
    <input id={inputId} aria-label={label} type={field.kind === "string" ? "text" : "number"}
      value={field.value === undefined ? "" : String(field.value)} disabled={disabled}
      required={field.required} placeholder={field.required ? t("parameter.requiredPlaceholder") : undefined}
      step={field.kind === "integer" ? 1 : "any"}
      onChange={(event) => {
        if (!field.required && event.target.value === "") { onChange(undefined); return; }
        const next = valueFromInput(field, event.target.value);
        if (next.ok) onChange(next.value);
      }} />
  </div>;
}

export function ArrayObjectEditor({ id, fieldName, itemSchema, value, disabled = false, onChange }: Props) {
  const { t } = useTranslation("tools");
  const [mode, setMode] = useState<"form" | "raw">("form");
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(() => new Set(value.length > 0 ? [0] : []));
  const formatted = JSON.stringify(value, null, 2);
  const [rawText, setRawText] = useState(formatted);
  const [rawInvalid, setRawInvalid] = useState(false);
  useEffect(() => setRawText(formatted), [formatted]);

  function replace(index: number, item: Record<string, unknown>): void {
    onChange(value.map((current, currentIndex) => currentIndex === index ? item : current));
  }
  function remove(index: number): void {
    onChange(value.filter((_, currentIndex) => currentIndex !== index));
    setExpanded((current) => new Set([...current].filter((item) => item !== index).map((item) => item > index ? item - 1 : item)));
  }
  function move(index: number, offset: -1 | 1): void {
    const target = index + offset;
    if (target < 0 || target >= value.length) return;
    const next = [...value];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  }
  function add(): void {
    onChange([...value, {}]);
    setExpanded((current) => new Set([...current, value.length]));
  }
  function rawChanged(text: string): void {
    setRawText(text);
    try {
      const parsed: unknown = JSON.parse(text);
      if (!Array.isArray(parsed) || parsed.some((item) => !isRecord(item))) { setRawInvalid(true); return; }
      setRawInvalid(false);
      onChange(parsed);
    } catch { setRawInvalid(true); }
  }

  return <div className="array-object-editor">
    <div className="array-object-editor__toolbar">
      <div role="tablist" aria-label={t("parameter.fieldModes", { name: fieldName })}>
        <button type="button" role="tab" aria-selected={mode === "form"} onClick={() => setMode("form")}>Form</button>
        <button type="button" role="tab" aria-selected={mode === "raw"} onClick={() => setMode("raw")}>Raw JSON</button>
      </div>
      {mode === "form" && <button type="button" disabled={disabled} onClick={add}>
        <Plus size={15} aria-hidden="true" />{t("parameter.addArrayItem")}
      </button>}
    </div>
    {mode === "raw" ? <div className="array-object-editor__raw">
      <textarea id={id} aria-label={t("parameter.arrayRawLabel", { name: fieldName })} value={rawText}
        disabled={disabled} aria-invalid={rawInvalid} onChange={(event) => rawChanged(event.target.value)} />
      {rawInvalid && <p role="alert">{t("parameter.arrayObjectRequired")}</p>}
    </div> : <div className="array-object-editor__items">
      {value.length === 0 && <p className="array-object-editor__empty">{t("parameter.arrayEmpty")}</p>}
      {value.map((candidate, index) => {
        const item = isRecord(candidate) ? candidate : {};
        const itemLabel = t("parameter.arrayItem", { name: fieldName, index: index + 1 });
        const isExpanded = expanded.has(index);
        const panelId = `${id}-item-${index}`;
        return <section key={index} className="array-object-item" role="group" aria-label={itemLabel}>
          <header>
            <button type="button" className="array-object-item__disclosure" aria-expanded={isExpanded}
              aria-controls={panelId} onClick={() => setExpanded((current) => {
                const next = new Set(current); if (next.has(index)) next.delete(index); else next.add(index); return next;
              })}><CaretRight size={18} weight="bold" aria-hidden="true" /><span>{t("parameter.arrayItemTitle", { index: index + 1 })}</span>
              <small>{t("parameter.arrayItemFields", { count: Object.keys(item).length })}</small></button>
            <div className="array-object-item__actions">
              <button type="button" disabled={disabled || index === 0} aria-label={t("parameter.moveArrayItemUp", { index: index + 1 })}
                onClick={() => move(index, -1)}><ArrowUp size={16} aria-hidden="true" /></button>
              <button type="button" disabled={disabled || index === value.length - 1} aria-label={t("parameter.moveArrayItemDown", { index: index + 1 })}
                onClick={() => move(index, 1)}><ArrowDown size={16} aria-hidden="true" /></button>
              <button type="button" disabled={disabled} aria-label={t("parameter.deleteArrayItem", { index: index + 1 })}
                onClick={() => remove(index)}><Trash size={16} aria-hidden="true" /></button>
            </div>
          </header>
          {isExpanded && <div id={panelId} className="array-object-item__body">
            {fieldsFromSchema(itemSchema, item).map((field) => <ItemField key={field.name} field={field}
              itemLabel={itemLabel} disabled={disabled} onChange={(nextValue) => {
                const next = { ...item };
                if (nextValue === undefined) delete next[field.name]; else next[field.name] = nextValue;
                replace(index, next);
              }} />)}
          </div>}
        </section>;
      })}
    </div>}
  </div>;
}
