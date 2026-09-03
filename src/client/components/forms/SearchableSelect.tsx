import { CaretDown, Check, X } from "@phosphor-icons/react";
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Popover } from "../overlays/Popover.js";

export interface SearchableSelectOption<T extends string> {
  value: T;
  label: string;
  description?: string;
  keywords?: readonly string[];
  disabled?: boolean;
}

export interface SearchableSelectProps<T extends string> {
  id?: string;
  className?: string;
  ariaLabel?: string;
  ariaLabelledBy?: string;
  ariaDescribedBy?: string;
  invalid?: boolean;
  required?: boolean;
  value: T | null;
  options: readonly SearchableSelectOption<T>[];
  onChange: (value: T | null) => void;
  searchable?: boolean;
  clearable?: boolean;
  disabled?: boolean;
  loading?: boolean;
  placeholder: string;
  searchPlaceholder: string;
  emptyMessage: string;
  loadingMessage?: string;
  clearLabel?: string;
  maxVisibleOptions?: number;
  title?: string;
  triggerContent?: ReactNode;
}

function normalized(value: string): string {
  return value.trim().toLocaleLowerCase();
}

function matchRank(option: SearchableSelectOption<string>, query: string): number | null {
  if (query === "") return 0;
  const label = normalized(option.label);
  if (label === query) return 0;
  if (label.startsWith(query)) return 1;
  if (label.includes(query)) return 2;
  return option.keywords?.some((keyword) => normalized(keyword).includes(query)) ? 3 : null;
}

function uniqueOptions<T extends string>(options: readonly SearchableSelectOption<T>[]): SearchableSelectOption<T>[] {
  const seen = new Set<T>();
  return options.filter((option) => {
    if (seen.has(option.value)) return false;
    seen.add(option.value);
    return true;
  });
}

export function filterSearchableOptions<T extends string>(
  options: readonly SearchableSelectOption<T>[], query: string, maxVisibleOptions = 200,
): SearchableSelectOption<T>[] {
  const needle = normalized(query);
  return uniqueOptions(options).map((option, index) => ({ option, index, rank: matchRank(option, needle) }))
    .filter((entry): entry is typeof entry & { rank: number } => entry.rank !== null)
    .sort((left, right) => left.rank - right.rank || left.index - right.index)
    .slice(0, Math.max(1, maxVisibleOptions))
    .map(({ option }) => option);
}

export function SearchableSelect<T extends string>({
  id, className, ariaLabel, ariaLabelledBy, ariaDescribedBy, invalid, required, value, options, onChange,
  searchable = true, clearable = false, disabled = false, loading = false, placeholder, searchPlaceholder,
  emptyMessage, loadingMessage = emptyMessage, clearLabel = placeholder, maxVisibleOptions = 200, title, triggerContent,
}: SearchableSelectProps<T>) {
  const generatedId = useId();
  const controlId = id ?? `${generatedId}-trigger`;
  const listboxId = `${generatedId}-listbox`;
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(-1);
  const composing = useRef(false);
  const deduplicated = useMemo(() => uniqueOptions(options), [options]);
  const optionIdentity = JSON.stringify(deduplicated.map((option) => [
    option.value, option.label, option.description, option.keywords, option.disabled,
  ]));
  const visibleOptions = useMemo(() => filterSearchableOptions(deduplicated, query, maxVisibleOptions),
    [deduplicated, maxVisibleOptions, query]);
  const selected = deduplicated.find((option) => option.value === value);

  useEffect(() => {
    setQuery("");
    setActiveIndex(-1);
  }, [optionIdentity, value]);

  useLayoutEffect(() => {
    if (!open) return;
    if (searchable) searchRef.current?.focus();
    else popupRef.current?.querySelector<HTMLButtonElement>('[role="option"]:not([disabled])')?.focus();
  }, [open, searchable]);

  function close(returnFocus: boolean): void {
    setOpen(false);
    setQuery("");
    setActiveIndex(-1);
    if (returnFocus) triggerRef.current?.focus();
  }

  function openSelect(edge?: "first" | "last"): void {
    if (disabled) return;
    setOpen(true);
    const selectedIndex = visibleOptions.findIndex((option) => option.value === value && !option.disabled);
    const enabled = visibleOptions.map((option, index) => ({ option, index })).filter(({ option }) => !option.disabled);
    setActiveIndex(edge === "first" ? enabled[0]?.index ?? -1
      : edge === "last" ? enabled.at(-1)?.index ?? -1 : selectedIndex);
  }

  function moveActive(direction: 1 | -1 | "first" | "last"): void {
    const enabledIndexes = visibleOptions.map((option, index) => option.disabled ? -1 : index).filter((index) => index >= 0);
    if (enabledIndexes.length === 0) { setActiveIndex(-1); return; }
    if (direction === "first") { setActiveIndex(enabledIndexes[0]!); return; }
    if (direction === "last") { setActiveIndex(enabledIndexes.at(-1)!); return; }
    const current = enabledIndexes.indexOf(activeIndex);
    const next = current < 0 ? (direction === 1 ? 0 : enabledIndexes.length - 1)
      : Math.max(0, Math.min(enabledIndexes.length - 1, current + direction));
    setActiveIndex(enabledIndexes[next]!);
  }

  function selectActive(): void {
    const option = visibleOptions[activeIndex];
    if (option === undefined || option.disabled) return;
    onChange(option.value);
    close(true);
  }

  function handleNavigation(event: KeyboardEvent): void {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault(); moveActive(event.key === "ArrowDown" ? 1 : -1);
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault(); moveActive(event.key === "Home" ? "first" : "last");
    } else if (event.key === "Enter" && !composing.current) {
      event.preventDefault(); selectActive();
    }
  }

  const activeOptionId = activeIndex < 0 ? undefined : `${generatedId}-option-${activeIndex}`;
  return <div className={["searchable-select", className].filter(Boolean).join(" ")}>
    <div className="searchable-select__control">
      <button ref={triggerRef} id={controlId} type="button" className="searchable-select__trigger" role="combobox"
        disabled={disabled} title={title} aria-label={ariaLabel} aria-labelledby={ariaLabel === undefined ? ariaLabelledBy : undefined}
        aria-describedby={ariaDescribedBy} aria-invalid={invalid} aria-required={required}
        aria-haspopup="listbox" aria-expanded={open} aria-controls={listboxId}
        onClick={() => open ? close(false) : openSelect()}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault(); openSelect(event.key === "ArrowDown" ? "first" : "last");
          } else if (event.key === "Escape" && open) { event.preventDefault(); close(false); }
        }}>
        {triggerContent ?? <span className={selected === undefined ? "is-placeholder" : undefined}>{selected?.label ?? placeholder}</span>}
        <CaretDown size={16} weight="bold" aria-hidden="true" />
      </button>
      {clearable && selected !== undefined && !disabled && <button type="button" className="searchable-select__clear"
        aria-label={clearLabel} title={clearLabel} onClick={() => { onChange(null); close(false); }}>
        <X size={14} weight="bold" aria-hidden="true" />
      </button>}
    </div>
    {open && <Popover anchorRef={triggerRef} contentRef={popupRef}
      className="searchable-select__popover" minWidth={220} onClose={close} onKeyDown={handleNavigation}>
      {searchable && <div className="searchable-select__search-shell"><input ref={searchRef} type="search"
        value={query} aria-label={searchPlaceholder} placeholder={searchPlaceholder} aria-controls={listboxId}
        aria-activedescendant={activeOptionId} onCompositionStart={() => { composing.current = true; }}
        onCompositionEnd={() => { composing.current = false; }}
        onChange={(event) => { setQuery(event.target.value); setActiveIndex(-1); }} onKeyDown={handleNavigation} /></div>}
      <div id={listboxId} role="listbox" aria-label={ariaLabel}
        aria-labelledby={ariaLabel === undefined ? ariaLabelledBy : undefined} className="searchable-select__options">
        {!loading && visibleOptions.map((option, index) => <button id={`${generatedId}-option-${index}`} key={option.value}
              type="button" role="option" aria-selected={option.value === value} aria-disabled={option.disabled || undefined}
              disabled={option.disabled} tabIndex={-1} className="searchable-select__option"
              data-active={index === activeIndex || undefined} onPointerMove={() => { if (!option.disabled) setActiveIndex(index); }}
              onClick={() => { onChange(option.value); close(true); }}>
              <span><strong>{option.label}</strong>{option.description !== undefined && <small>{option.description}</small>}</span>
              {option.value === value && <Check size={15} weight="bold" aria-hidden="true" />}
            </button>)}
      </div>
      {loading ? <p role="status" className="searchable-select__status">{loadingMessage}</p>
        : visibleOptions.length === 0 && <p role="status" className="searchable-select__status">{emptyMessage}</p>}
    </Popover>}
  </div>;
}
