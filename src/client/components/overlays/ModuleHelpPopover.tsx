import { Info, X } from "@phosphor-icons/react";
import { useId, useLayoutEffect, useRef, useState } from "react";
import { Popover } from "./Popover.js";

export interface ModuleHelpSection {
  id: string;
  title: string;
  items: readonly string[];
}

export interface ModuleHelpPopoverProps {
  moduleName: string;
  triggerLabel: string;
  closeLabel: string;
  summary: string;
  description?: string;
  sections: readonly ModuleHelpSection[];
}

export function ModuleHelpPopover({
  moduleName, triggerLabel, closeLabel, summary, description, sections,
}: ModuleHelpPopoverProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const popoverId = useId();
  const titleId = `${popoverId}-title`;

  useLayoutEffect(() => {
    if (open) closeRef.current?.focus();
  }, [open]);

  function close(): void {
    setOpen(false);
    triggerRef.current?.focus();
  }

  return <span className="module-help">
    <button ref={triggerRef} type="button" className="module-help__trigger" data-help-icon="info"
      aria-label={triggerLabel} title={triggerLabel} aria-haspopup="dialog"
      aria-expanded={open} aria-controls={popoverId}
      onClick={() => open ? close() : setOpen(true)}>
      <Info size={17} weight="fill" aria-hidden="true" />
    </button>
    {open && <Popover anchorRef={triggerRef} contentRef={popoverRef} id={popoverId} role="dialog"
      ariaLabelledBy={titleId} className="module-help__popover" minWidth={360} onClose={() => close()}>
      <header className="module-help__header">
        <div><span>{summary}</span><h2 id={titleId}>{moduleName}</h2></div>
        <button ref={closeRef} type="button" className="module-help__close" aria-label={closeLabel} title={closeLabel}
          onClick={close}><X size={16} aria-hidden="true" /></button>
      </header>
      <div className="module-help__body">
        {description !== undefined && <p className="module-help__description">{description}</p>}
        {sections.map((section) => <section key={section.id} className="module-help__section">
          <h3>{section.title}</h3>
          <ul>{section.items.map((item) => <li key={item}>{item}</li>)}</ul>
        </section>)}
      </div>
    </Popover>}
  </span>;
}
