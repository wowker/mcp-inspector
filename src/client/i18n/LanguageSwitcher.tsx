import { Check, Translate } from "@phosphor-icons/react";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { parseLocale } from "../../shared/i18n/locale.js";
import { Select } from "../components/forms/Select.js";
import { Popover } from "../components/overlays/Popover.js";

interface LanguageSwitcherProps {
  variant?: "select" | "compact";
}

const languageOptions = [
  { value: "zh-CN", label: "简体中文" },
  { value: "en-US", label: "English" },
] as const;

export function LanguageSwitcher({ variant = "select" }: LanguageSwitcherProps) {
  const { i18n, t } = useTranslation("app");
  const [announcement, setAnnouncement] = useState("");
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const listboxId = useId();
  const locale = parseLocale(i18n.resolvedLanguage) ?? "zh-CN";

  async function changeLocale(value: string): Promise<void> {
    const next = parseLocale(value);
    if (next === null || next === locale) return;
    await i18n.changeLanguage(next);
    setAnnouncement(t("language.changed", { lng: next }));
  }

  useEffect(() => setOpen(false), [variant]);
  useLayoutEffect(() => {
    if (!open || variant !== "compact") return;
    const selected = popoverRef.current?.querySelector<HTMLButtonElement>('[role="option"][aria-selected="true"]');
    (selected ?? popoverRef.current?.querySelector<HTMLButtonElement>('[role="option"]'))?.focus();
  }, [open, variant]);

  function close(returnFocus: boolean): void {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  }

  return <div className="language-switcher-shell">
    {variant === "select" ? <Select className="language-switcher" aria-label={t("language.label")} value={locale}
      onChange={(event) => void changeLocale(event.currentTarget.value)}>
      {languageOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
    </Select> : <>
      <button ref={triggerRef} type="button" className="language-switcher-compact"
        aria-label={t("language.label")} title={t("language.label")} aria-haspopup="listbox"
        aria-expanded={open} aria-controls={listboxId} onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault(); setOpen(true);
          } else if (event.key === "Escape" && open) { event.preventDefault(); close(false); }
        }}>
        <Translate size={17} aria-hidden="true" />
      </button>
      {open && <Popover anchorRef={triggerRef} contentRef={popoverRef} id={listboxId} role="listbox"
        ariaLabel={t("language.label")} className="language-switcher-popover" minWidth={148}
        onClose={close} onKeyDown={(event) => {
          if (event.key !== "ArrowDown" && event.key !== "ArrowUp" && event.key !== "Home" && event.key !== "End") return;
          event.preventDefault();
          const options = [...popoverRef.current?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? []];
          const current = options.indexOf(document.activeElement as HTMLButtonElement);
          const next = event.key === "Home" ? 0 : event.key === "End" ? options.length - 1
            : event.key === "ArrowDown" ? (current + 1 + options.length) % options.length
              : (current - 1 + options.length) % options.length;
          options[next]?.focus();
        }}>
        {languageOptions.map((option) => <button key={option.value} type="button" role="option"
          aria-selected={locale === option.value} onClick={() => { void changeLocale(option.value); close(true); }}>
          <span>{option.label}</span>{locale === option.value && <Check size={15} weight="bold" aria-hidden="true" />}
        </button>)}
      </Popover>}
    </>}
    <span className="sr-only" role="status" aria-live="polite">{announcement}</span>
  </div>;
}
