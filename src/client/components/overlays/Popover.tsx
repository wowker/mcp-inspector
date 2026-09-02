import { createPortal } from "react-dom";
import { useEffect, useLayoutEffect, type KeyboardEvent, type ReactNode, type RefObject, type CSSProperties } from "react";

export interface PopoverProps {
  anchorRef: RefObject<HTMLElement | null>;
  contentRef?: RefObject<HTMLDivElement | null>;
  children: ReactNode;
  id?: string;
  role?: "listbox" | "menu" | "dialog";
  ariaLabel?: string;
  ariaLabelledBy?: string;
  className?: string;
  minWidth?: number;
  onClose: (returnFocus: boolean) => void;
  onKeyDown?: (event: KeyboardEvent<HTMLDivElement>) => void;
}

interface PopoverPosition {
  top: number;
  left: number;
  width: number;
  maxHeight: number;
}

function getPosition(anchor: HTMLElement, minWidth = 0): PopoverPosition {
  const rect = anchor.getBoundingClientRect();
  const gap = 6;
  const padding = 12;
  const width = Math.min(Math.max(rect.width, minWidth), window.innerWidth - padding * 2);
  const below = window.innerHeight - rect.bottom - padding;
  const above = rect.top - padding;
  const openAbove = below < 220 && above > below;
  const maxHeight = Math.max(120, Math.min(300, (openAbove ? above : below) - gap));
  return {
    top: openAbove ? Math.max(padding, rect.top - maxHeight - gap) : rect.bottom + gap,
    left: Math.max(padding, Math.min(rect.left, window.innerWidth - width - padding)),
    width,
    maxHeight,
  };
}

/**
 * A small, anchored portal surface with one consistent collision and dismissal contract.
 * Its parent owns open state and the content's keyboard navigation.
 */
export function Popover({
  anchorRef, contentRef, children, id, role, ariaLabel, ariaLabelledBy, className, minWidth = 0, onClose, onKeyDown,
}: PopoverProps) {
  const anchor = anchorRef.current;
  const position = anchor === null ? null : getPosition(anchor, minWidth);

  useLayoutEffect(() => {
    const currentAnchor = anchorRef.current;
    const content = contentRef?.current;
    if (currentAnchor === null || content === null || content === undefined) return;
    const next = getPosition(currentAnchor, minWidth);
    Object.assign(content.style, {
      top: `${next.top}px`, left: `${next.left}px`, width: `${next.width}px`, maxHeight: `${next.maxHeight}px`,
    });
  });

  useEffect(() => {
    const reposition = () => {
      const currentAnchor = anchorRef.current;
      const content = contentRef?.current;
      if (currentAnchor === null || content === null || content === undefined) return;
      const next = getPosition(currentAnchor, minWidth);
      Object.assign(content.style, {
        top: `${next.top}px`, left: `${next.left}px`, width: `${next.width}px`, maxHeight: `${next.maxHeight}px`,
      });
    };
    const outside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!anchorRef.current?.contains(target) && !contentRef?.current?.contains(target)) onClose(false);
    };
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    document.addEventListener("pointerdown", outside);
    return () => {
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
      document.removeEventListener("pointerdown", outside);
    };
  }, [anchorRef, contentRef, minWidth, onClose]);

  const style: CSSProperties | undefined = position === null ? undefined : {
    top: position.top, left: position.left, width: position.width, maxHeight: position.maxHeight,
  };
  return createPortal(<div ref={contentRef} id={id} role={role} aria-label={ariaLabel} aria-labelledby={ariaLabelledBy} className={className} style={style}
    onKeyDown={(event) => {
      if (event.key === "Escape") { event.preventDefault(); onClose(true); return; }
      if (event.key === "Tab") onClose(false);
      onKeyDown?.(event);
    }}>
    {children}
  </div>, document.body);
}
