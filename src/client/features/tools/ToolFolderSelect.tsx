import { useId, useRef, useState } from "react";
import { CaretDown, Check, FolderSimple, FolderSimplePlus } from "@phosphor-icons/react";
import type { ToolFolderSummary } from "../../api/api-client.js";
import { Popover } from "../../components/overlays/Popover.js";

interface ToolFolderSelectProps {
  ariaLabel: string;
  disabled: boolean;
  folderId: string | null;
  folders: readonly ToolFolderSummary[];
  title: string;
  unfiledLabel: string;
  onChange: (folderId: string | null) => void;
}

export function ToolFolderSelect({
  ariaLabel, disabled, folderId, folders, title, unfiledLabel, onChange,
}: ToolFolderSelectProps) {
  const id = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const options = [{ id: null, name: unfiledLabel }, ...folders.map((folder) => ({ id: folder.id, name: folder.name }))];
  const selectedIndex = Math.max(0, options.findIndex((option) => option.id === folderId));
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(selectedIndex);

  function focusOption(index: number): void {
    const bounded = Math.max(0, Math.min(options.length - 1, index));
    setActiveIndex(bounded);
    requestAnimationFrame(() => popupRef.current
      ?.querySelector<HTMLButtonElement>(`[data-folder-index="${bounded}"]`)?.focus());
  }

  function openSelect(index = selectedIndex): void {
    const bounded = Math.max(0, Math.min(options.length - 1, index));
    setActiveIndex(bounded);
    setOpen(true);
    requestAnimationFrame(() => popupRef.current
      ?.querySelector<HTMLButtonElement>(`[data-folder-index="${bounded}"]`)?.focus());
  }

  function close(returnFocus: boolean): void {
    setOpen(false);
    if (returnFocus) requestAnimationFrame(() => triggerRef.current?.focus());
  }

  return <div className="tool-folder-select">
    <button ref={triggerRef} type="button" className="tool-move-control" role="combobox"
      aria-label={ariaLabel} aria-haspopup="listbox" aria-expanded={open} aria-controls={`${id}-listbox`}
      disabled={disabled} title={title}
      onClick={() => open ? close(false) : openSelect()}
      onKeyDown={(event) => {
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault(); openSelect(event.key === "ArrowDown" ? 0 : options.length - 1);
        } else if (event.key === "Home" || event.key === "End") {
          event.preventDefault(); openSelect(event.key === "Home" ? 0 : options.length - 1);
        } else if (event.key === "Escape" && open) {
          event.preventDefault(); close(false);
        }
      }}>
      <FolderSimplePlus size={16} weight="bold" aria-hidden="true" />
      <CaretDown className="tool-folder-select__caret" size={9} weight="bold" aria-hidden="true" />
    </button>
    {open && <Popover anchorRef={triggerRef} contentRef={popupRef} id={`${id}-listbox`} role="listbox"
      ariaLabel={ariaLabel} className="tool-folder-select__popover" minWidth={196}
      onClose={(returnFocus) => close(returnFocus)}
      onKeyDown={(event) => {
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault(); focusOption(activeIndex + (event.key === "ArrowDown" ? 1 : -1));
        } else if (event.key === "Home" || event.key === "End") {
          event.preventDefault(); focusOption(event.key === "Home" ? 0 : options.length - 1);
        }
      }}>
      {options.map((option, index) => <button key={option.id ?? "unfiled"} type="button" role="option"
        aria-selected={index === selectedIndex} data-folder-index={index} tabIndex={index === activeIndex ? 0 : -1}
        className={`tool-folder-select__option${index === selectedIndex ? " tool-folder-select__option--selected" : ""}`}
        onFocus={() => setActiveIndex(index)} onClick={() => { onChange(option.id); close(true); }}>
        <FolderSimple size={16} weight={option.id === null ? "regular" : "fill"} aria-hidden="true" />
        <span>{option.name}</span>
        {index === selectedIndex && <Check size={15} weight="bold" aria-hidden="true" />}
      </button>)}
    </Popover>}
  </div>;
}
