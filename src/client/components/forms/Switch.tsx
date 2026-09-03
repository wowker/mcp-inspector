import type { ReactNode } from "react";

interface SwitchProps {
  id?: string;
  className?: string;
  checked: boolean;
  disabled?: boolean;
  invalid?: boolean;
  label?: ReactNode;
  ariaLabel?: string;
  ariaLabelledBy?: string;
  ariaDescribedBy?: string;
  onLabel: string;
  offLabel: string;
  showState?: boolean;
  onChange: (checked: boolean) => void;
}

export function Switch({ id, className, checked, disabled = false, invalid = false, label,
  ariaLabel, ariaLabelledBy, ariaDescribedBy, onLabel, offLabel, showState = true, onChange }: SwitchProps) {
  return <label className={["ui-switch", className].filter(Boolean).join(" ")}>
    <input id={id} className="ui-switch__input" type="checkbox" role="switch" checked={checked}
      disabled={disabled} aria-label={ariaLabel}
      aria-labelledby={ariaLabel === undefined && label === undefined ? ariaLabelledBy : undefined}
      aria-describedby={ariaDescribedBy} aria-invalid={invalid || undefined}
      onChange={(event) => onChange(event.target.checked)} />
    <span className="ui-switch__track" data-state={checked ? "checked" : "unchecked"} aria-hidden="true">
      <span className="ui-switch__thumb" />
    </span>
    {label !== undefined && <span className="ui-switch__label">{label}</span>}
    {showState && <span className="ui-switch__state" data-state={checked ? "checked" : "unchecked"} aria-hidden="true">
      {checked ? onLabel : offLabel}
    </span>}
  </label>;
}
