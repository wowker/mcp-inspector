import { useEffect, useRef, type KeyboardEvent, type ReactNode, type RefObject } from "react";

export interface DialogProps {
  children: ReactNode;
  titleId: string;
  descriptionId?: string;
  initialFocusRef?: RefObject<HTMLElement | null>;
  onClose: () => void;
  closeDisabled?: boolean;
  closeOnBackdrop?: boolean;
  className?: string;
}

function focusableElements(surface: HTMLElement | null): HTMLElement[] {
  return [...(surface?.querySelectorAll<HTMLElement>(
    "button, input, select, textarea, [tabindex]",
  ) ?? [])].filter((element) => !element.hasAttribute("disabled") && element.getAttribute("tabindex") !== "-1");
}

export function Dialog({
  children, titleId, descriptionId, initialFocusRef, onClose, closeDisabled = false,
  closeOnBackdrop = true, className,
}: DialogProps) {
  const surfaceRef = useRef<HTMLElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    initialFocusRef?.current?.focus();
    return () => returnFocusRef.current?.focus();
  }, [initialFocusRef]);

  function handleKeyDown(event: KeyboardEvent<HTMLElement>): void {
    if (event.key === "Escape" && !closeDisabled) {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== "Tab") return;
    const controls = focusableElements(surfaceRef.current);
    if (controls.length === 0) return;
    const first = controls[0];
    const last = controls.at(-1);
    if (event.shiftKey && event.target === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && event.target === last) {
      event.preventDefault();
      first?.focus();
    }
  }

  return <div className="dialog-backdrop" onMouseDown={(event) => {
    if (closeOnBackdrop && !closeDisabled && event.target === event.currentTarget) onClose();
  }}>
    <section ref={surfaceRef} className={["dialog-surface", className].filter(Boolean).join(" ")}
      role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descriptionId}
      onKeyDown={handleKeyDown}>
      {children}
    </section>
  </div>;
}
