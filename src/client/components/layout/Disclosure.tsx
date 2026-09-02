import { useId, useState, type ReactNode } from "react";
import { CaretRight } from "@phosphor-icons/react";

export interface DisclosureProps {
  label: string;
  summary?: ReactNode;
  children: ReactNode;
  defaultExpanded?: boolean;
  expanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
  className?: string;
  contentClassName?: string;
}

export function Disclosure({ label, summary, children, defaultExpanded = false, expanded: controlledExpanded,
  onExpandedChange, className, contentClassName }: DisclosureProps) {
  const generatedId = useId().replaceAll(":", "");
  const [localExpanded, setLocalExpanded] = useState(defaultExpanded);
  const expanded = controlledExpanded ?? localExpanded;
  const contentId = `ui-disclosure-${generatedId}`;
  function toggle(): void {
    const next = !expanded;
    if (controlledExpanded === undefined) setLocalExpanded(next);
    onExpandedChange?.(next);
  }
  return <section className={["ui-disclosure", className].filter(Boolean).join(" ")}>
    <button type="button" className="ui-disclosure__trigger" aria-expanded={expanded}
      aria-controls={contentId} onClick={toggle}>
      <CaretRight size={18} weight="bold" aria-hidden="true" />
      <span className="ui-disclosure__label">{label}</span>
      {summary !== undefined && <span className="ui-disclosure__summary">{summary}</span>}
    </button>
    {expanded && <div id={contentId} className={["ui-disclosure__content", contentClassName]
      .filter(Boolean).join(" ")}>{children}</div>}
  </section>;
}
