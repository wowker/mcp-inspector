import { Button } from "../actions/Button.js";

export type SplitPanePreset = "request" | "balanced" | "result";

interface Props {
  label: string;
  value: SplitPanePreset | "custom";
  options: ReadonlyArray<{ value: SplitPanePreset; label: string }>;
  onChange: (value: SplitPanePreset) => void;
}

export function SplitPanePresets({ label, value, options, onChange }: Props) {
  return <div className="ui-split-presets" role="group" aria-label={label}>
    {options.map((option) => <Button key={option.value} variant="quiet"
      aria-pressed={value === option.value} onClick={() => onChange(option.value)}>
      {option.label}
    </Button>)}
  </div>;
}
