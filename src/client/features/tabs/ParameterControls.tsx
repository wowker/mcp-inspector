import { useRef, useState } from "react";
import { CaretDown, Check } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import "../../i18n/index.js";
import { Popover } from "../../components/overlays/Popover.js";

interface CommonControlProps {
  id: string;
  labelId: string;
  describedBy?: string;
  invalid: boolean;
  disabled?: boolean;
  ariaLabel?: string;
}

interface BooleanSwitchProps extends CommonControlProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
}

export function BooleanSwitch({ id, labelId, describedBy, invalid, disabled, ariaLabel, checked, onChange }: BooleanSwitchProps) {
  const { t } = useTranslation("tools");
  return <label className="schema-switch">
    <input id={id} className="schema-switch__input" type="checkbox" checked={checked}
      disabled={disabled} aria-label={ariaLabel} aria-labelledby={ariaLabel === undefined ? labelId : undefined} aria-describedby={describedBy} aria-invalid={invalid}
      onChange={(event) => onChange(event.target.checked)} />
    <span className="schema-switch__track" data-state={checked ? "checked" : "unchecked"} aria-hidden="true">
      <span className="schema-switch__thumb" />
    </span>
    <span className="schema-switch__state" data-state={checked ? "checked" : "unchecked"} aria-hidden="true">
      {checked ? t("parameter.booleanOn") : t("parameter.booleanOff")}
    </span>
  </label>;
}

interface EnumControlProps extends CommonControlProps {
  value: unknown;
  options: readonly unknown[];
  required: boolean;
  onSelect: (index: number) => void;
  onClear: () => void;
}

function optionLabel(value: unknown): string {
  if (typeof value === "string") return value;
  return JSON.stringify(value) ?? String(value);
}

function isPrimitive(value: unknown): boolean {
  return value === null || ["string", "number", "boolean"].includes(typeof value);
}

function RadioEnum({ id, labelId, describedBy, invalid, disabled, ariaLabel, value, options, onSelect }: EnumControlProps) {
  return <div className="schema-radio-group" role="radiogroup" aria-label={ariaLabel} aria-labelledby={ariaLabel === undefined ? labelId : undefined} aria-required="true"
    aria-describedby={describedBy} aria-invalid={invalid}>
    {options.map((option, index) => <label className="schema-radio-option" key={`${optionLabel(option)}-${index}`}>
      <input type="radio" name={id} checked={Object.is(option, value)} disabled={disabled} onChange={() => onSelect(index)} />
      <span className="schema-radio-indicator" data-state={Object.is(option, value) ? "checked" : "unchecked"} aria-hidden="true" />
      <span>{optionLabel(option)}</span>
    </label>)}
  </div>;
}

function DropdownEnum(props: EnumControlProps) {
  const { t } = useTranslation("tools");
  const { id, labelId, describedBy, invalid, disabled, ariaLabel, required, value, options, onSelect, onClear } = props;
  const [open, setOpen] = useState(false);
  const selectedIndex = options.findIndex((option) => Object.is(option, value));
  const [activeIndex, setActiveIndex] = useState(selectedIndex);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const listboxId = `${id}-listbox`;
  const valueId = `${id}-value`;

  function focusOption(index: number): void {
    const minimum = required ? 0 : -1;
    const bounded = Math.max(minimum, Math.min(options.length - 1, index));
    setActiveIndex(bounded);
    requestAnimationFrame(() => popupRef.current?.querySelector<HTMLButtonElement>(`[data-enum-index="${bounded}"]`)?.focus());
  }

  function openDropdown(direction: "first" | "last" | "selected" = "selected"): void {
    const next = direction === "first" ? (required ? 0 : -1) : direction === "last" ? options.length - 1
      : selectedIndex >= 0 ? selectedIndex : required ? 0 : -1;
    setActiveIndex(next);
    setOpen(true);
    requestAnimationFrame(() => focusOption(next));
  }

  function close(returnFocus = false): void {
    setOpen(false);
    if (returnFocus) requestAnimationFrame(() => triggerRef.current?.focus());
  }

  const selectedLabel = selectedIndex >= 0 ? optionLabel(options[selectedIndex]) : null;
  return <div className="schema-enum-select">
    <button ref={triggerRef} id={id} type="button" className="schema-enum-select__trigger" role="combobox"
      disabled={disabled}
      aria-haspopup="listbox" aria-expanded={open} aria-controls={listboxId}
      aria-label={ariaLabel} aria-labelledby={ariaLabel === undefined ? labelId : undefined} aria-describedby={describedBy} aria-invalid={invalid} aria-required={required}
      onClick={() => open ? close() : openDropdown()}
      onKeyDown={(event) => {
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault(); openDropdown(event.key === "ArrowDown" ? "first" : "last");
        } else if (event.key === "Home" || event.key === "End") {
          event.preventDefault(); openDropdown(event.key === "Home" ? "first" : "last");
        } else if (event.key === "Escape" && open) { event.preventDefault(); close(); }
      }}>
      <span id={valueId} className={`schema-enum-select__value${selectedLabel === null ? " is-placeholder" : ""}`}>
        {selectedLabel ?? (required ? t("parameter.selectRequired") : t("parameter.select"))}
      </span>
      <CaretDown size={16} weight="bold" aria-hidden="true" />
    </button>
    {open && <Popover anchorRef={triggerRef} contentRef={popupRef} id={listboxId} role="listbox" ariaLabelledBy={labelId}
      className="schema-enum-select__popover" onClose={(returnFocus) => close(returnFocus)}
      onKeyDown={(event) => {
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault(); focusOption(activeIndex + (event.key === "ArrowDown" ? 1 : -1));
        } else if (event.key === "Home" || event.key === "End") {
          event.preventDefault(); focusOption(event.key === "Home" ? 0 : options.length - 1);
        }
      }}>
      {!required && <button type="button" role="option" aria-selected={selectedIndex < 0}
        data-enum-index="-1" tabIndex={activeIndex === -1 ? 0 : -1}
        className="schema-enum-select__option schema-enum-select__option--clear" onFocus={() => setActiveIndex(-1)}
        onClick={() => { onClear(); close(true); }}>
        <span>{t("parameter.select")}</span>{selectedIndex < 0 && <Check size={15} weight="bold" aria-hidden="true" />}
      </button>}
      {options.map((option, index) => <button type="button" role="option" aria-selected={index === selectedIndex}
        data-enum-index={index} tabIndex={index === activeIndex ? 0 : -1}
        className={`schema-enum-select__option${index === selectedIndex ? " schema-enum-select__option--selected" : ""}`}
        key={`${optionLabel(option)}-${index}`}
        onFocus={() => setActiveIndex(index)} onClick={() => { onSelect(index); close(true); }}>
        <span>{optionLabel(option)}</span>{index === selectedIndex && <Check size={15} weight="bold" aria-hidden="true" />}
      </button>)}
    </Popover>}
  </div>;
}

export function EnumControl(props: EnumControlProps) {
  const useRadio = props.required && props.options.length > 0 && props.options.length <= 3
    && props.options.every(isPrimitive);
  return useRadio ? <RadioEnum {...props} /> : <DropdownEnum {...props} />;
}
