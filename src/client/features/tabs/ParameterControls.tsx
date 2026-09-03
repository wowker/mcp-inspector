import { useTranslation } from "react-i18next";
import "../../i18n/index.js";
import { SearchableSelect } from "../../components/forms/SearchableSelect.js";

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
  const selectedIndex = options.findIndex((option) => Object.is(option, value));
  return <SearchableSelect id={id} className="schema-enum-select" ariaLabel={ariaLabel}
    ariaLabelledBy={labelId} ariaDescribedBy={describedBy} invalid={invalid} required={required}
    disabled={disabled} value={selectedIndex < 0 ? null : String(selectedIndex)}
    options={options.map((option, index) => ({ value: String(index), label: optionLabel(option) }))}
    onChange={(nextIndex) => nextIndex === null ? onClear() : onSelect(Number(nextIndex))}
    searchable={options.length > 8} clearable={!required}
    placeholder={required ? t("parameter.selectRequired") : t("parameter.select")}
    searchPlaceholder={t("parameter.searchOptions")} emptyMessage={t("parameter.noMatchingOptions")}
    clearLabel={t("parameter.select")} />;
}

export function EnumControl(props: EnumControlProps) {
  const useRadio = props.required && props.options.length > 0 && props.options.length <= 3
    && props.options.every(isPrimitive);
  return useRadio ? <RadioEnum {...props} /> : <DropdownEnum {...props} />;
}
