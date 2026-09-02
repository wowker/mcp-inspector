import { useEffect, useId, useRef, useState } from "react";
import { ArrowsOutSimple, Check, CopySimple, X } from "@phosphor-icons/react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import "../../i18n/index.js";
import { summarizeJsonValue } from "./parameter-editor-model.js";

export interface JsonSubtreeDraft { text: string; base: string }

function JsonEditorDialog({ fieldName, text, onTextChange, onClose, returnFocusTo }: {
  fieldName: string; text: string; onTextChange: (text: string) => void; onClose: () => void;
  returnFocusTo: HTMLElement | null;
}) {
  const { t } = useTranslation("tools");
  const titleId = useId();
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); closeRef.current(); return; }
      if (event.key !== "Tab") return;
      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>("button:not([disabled]), textarea:not([disabled])");
      if (focusable === undefined || focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => { document.removeEventListener("keydown", handleKeyDown); returnFocusTo?.focus(); };
  }, [returnFocusTo]);
  return createPortal(<div className="json-editor-dialog__backdrop" role="presentation" onMouseDown={(event) => {
    if (event.currentTarget === event.target) onClose();
  }}>
    <section ref={dialogRef} className="json-editor-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <header><div><span>{t("parameter.jsonParameter")}</span><h2 id={titleId}>{t("parameter.editJson", { name: fieldName })}</h2></div>
        <button type="button" aria-label={t("parameter.closeJson")} onClick={onClose}><X size={18} aria-hidden="true" /></button>
      </header>
      <textarea autoFocus aria-label={t("parameter.enlargedJsonEditor", { name: fieldName })} value={text}
        onChange={(event) => onTextChange(event.target.value)} />
    </section>
  </div>, document.body);
}

export function JsonSubtreeEditor({ id, fieldName, value, describedBy, draft, ariaLabel, objectOnly = false,
  required = false, disabled = false, onDraftChange, onCommit }: {
  id: string; fieldName: string; value: unknown; describedBy?: string; draft?: JsonSubtreeDraft; ariaLabel?: string;
  objectOnly?: boolean; required?: boolean; disabled?: boolean;
  onDraftChange?: (text: string, base: string) => void; onCommit: (value: unknown) => void;
}) {
  const { t, i18n } = useTranslation("tools");
  const formatted = value === undefined ? "" : JSON.stringify(value, null, 2);
  const [localText, setLocalText] = useState(formatted);
  const [invalid, setInvalid] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const enlargeButtonRef = useRef<HTMLButtonElement>(null);
  const text = draft?.base === formatted ? draft.text : draft === undefined ? localText : formatted;
  useEffect(() => { if (draft === undefined) setLocalText(formatted); }, [draft, formatted]);
  useEffect(() => { if (disabled) setInvalid(false); }, [disabled]);
  function parse(textValue: string): { ok: true; value: unknown } | { ok: false } {
    if (textValue.trim() === "") {
      return !required && !objectOnly ? { ok: true, value: undefined } : { ok: false };
    }
    try {
      const parsed: unknown = JSON.parse(textValue);
      if (objectOnly && (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))) return { ok: false };
      return { ok: true, value: parsed };
    } catch { return { ok: false }; }
  }
  function commitIfChanged(next: unknown): void {
    const currentCanonical = value === undefined ? "" : JSON.stringify(value);
    const nextCanonical = next === undefined ? "" : JSON.stringify(next);
    if (currentCanonical !== nextCanonical) onCommit(next);
  }
  function updateText(nextText: string): void {
    onDraftChange?.(nextText, formatted);
    if (draft === undefined) setLocalText(nextText);
    const parsed = parse(nextText);
    if (parsed.ok) commitIfChanged(parsed.value);
    setInvalid(!parsed.ok);
  }
  function format(): void {
    const parsed = parse(text);
    if (!parsed.ok) { setInvalid(true); return; }
    updateText(parsed.value === undefined ? "" : JSON.stringify(parsed.value, null, 2));
  }
  return <><div className="json-subtree-toolbar">
    <span>{summarizeJsonValue(value, i18n.resolvedLanguage === "en-US" ? "en-US" : "zh-CN")}</span>
    <div>
      <button type="button" disabled={disabled} aria-label={t("parameter.formatJson", { name: fieldName })} onClick={format}>
        <Check size={15} aria-hidden="true" />{t("parameter.format")}
      </button>
      <button type="button" disabled={disabled} aria-label={t("parameter.copyJson", { name: fieldName })}
        onClick={() => void navigator.clipboard?.writeText(text)}><CopySimple size={15} aria-hidden="true" />{t("parameter.copy")}</button>
      <button ref={enlargeButtonRef} type="button" disabled={disabled} aria-label={t("parameter.enlargeJson", { name: fieldName })} onClick={() => setDialogOpen(true)}>
        <ArrowsOutSimple size={15} aria-hidden="true" />{t("parameter.enlarge")}
      </button>
    </div>
  </div><textarea id={id} value={text} required={required} disabled={disabled} placeholder={required ? t("parameter.requiredPlaceholder") : undefined}
    aria-label={ariaLabel} aria-describedby={describedBy} aria-invalid={!disabled && invalid}
    onChange={(event) => updateText(event.target.value)}
    onBlur={() => {
      const parsed = parse(text);
      if (parsed.ok) { commitIfChanged(parsed.value); setInvalid(false); }
      else setInvalid(true);
    }} />
    {!disabled && invalid && <p role="alert">{objectOnly ? t("parameter.jsonObjectRequired") : t("parameter.validJsonRequired")}</p>}
    {dialogOpen && <JsonEditorDialog fieldName={fieldName} text={text} onTextChange={updateText}
      returnFocusTo={enlargeButtonRef.current} onClose={() => setDialogOpen(false)} />}</>;
}
