import { useEffect, useRef, type MouseEvent } from "react";
import { DotsThree, PushPin, X } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import type { DebugTabSummary } from "../../api/api-client.js";

interface Props {
  tabs: DebugTabSummary[]; activeId: string | null; onSelect: (id: string) => void;
  onCopyName: (toolName: string) => void;
  onClose: (id: string) => void; onDuplicate: (id: string) => void; onPin: (id: string, pinned: boolean) => void;
  onCloseOthers: (id: string) => void; onCloseRight: (id: string) => void;
  onMove: (id: string, offset: -1 | 1) => void;
  dirtyIds?: ReadonlySet<string>; runningIds?: ReadonlySet<string>;
}

export function TabStrip({ tabs, activeId, onSelect, onCopyName, onClose, onDuplicate, onPin, onCloseOthers, onCloseRight, onMove,
  dirtyIds = new Set(), runningIds = new Set() }: Props) {
  const { t } = useTranslation("tools");
  const strip = useRef<HTMLDivElement>(null);
  const previousActive = useRef<string | null>(activeId);
  useEffect(() => {
    if (previousActive.current !== null && previousActive.current !== activeId) {
      const candidate = document.getElementById(`tab-${activeId ?? ""}`);
      if (candidate instanceof HTMLButtonElement && strip.current?.contains(candidate)) candidate.focus();
    }
    previousActive.current = activeId;
  }, [activeId]);
  useEffect(() => {
    function closeMenusExcept(target: EventTarget | null): void {
      strip.current?.querySelectorAll<HTMLDetailsElement>("details.tab-menu[open]").forEach((details) => {
        if (!(target instanceof Node) || !details.contains(target)) details.open = false;
      });
    }
    function dismissOnPointerDown(event: PointerEvent): void { closeMenusExcept(event.target); }
    function dismissOnEscape(event: KeyboardEvent): void {
      if (event.key !== "Escape") return;
      const details = strip.current?.querySelector<HTMLDetailsElement>("details.tab-menu[open]");
      if (details === null || details === undefined) return;
      details.open = false;
      details.querySelector<HTMLElement>("summary")?.focus();
      event.preventDefault();
    }
    document.addEventListener("pointerdown", dismissOnPointerDown);
    document.addEventListener("keydown", dismissOnEscape);
    return () => {
      document.removeEventListener("pointerdown", dismissOnPointerDown);
      document.removeEventListener("keydown", dismissOnEscape);
    };
  }, []);
  function finishMenuAction(event: MouseEvent<HTMLButtonElement>, action: () => void): void {
    const details = event.currentTarget.closest("details"); action();
    details?.removeAttribute("open"); details?.querySelector("summary")?.focus();
  }
  function positionMenu(details: HTMLDetailsElement): void {
    const trigger = details.querySelector("summary");
    if (trigger === null) return;
    const rect = trigger.getBoundingClientRect();
    const width = 164;
    const left = Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8));
    details.style.setProperty("--tab-menu-top", `${rect.bottom + 4}px`);
    details.style.setProperty("--tab-menu-left", `${left}px`);
  }
  return <div ref={strip} className="debug-tabs" onKeyDown={(event) => {
    if (!(event.target instanceof HTMLElement) || event.target.getAttribute("role") !== "tab") return;
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const index = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1
      : event.key === "ArrowRight" ? (current + 1) % buttons.length : (current - 1 + buttons.length) % buttons.length;
    const next = buttons[index]; if (next !== undefined) { event.preventDefault(); next.focus(); next.click(); }
  }}>
    <div className="sr-only" role="tablist" aria-label={t("workspace.tabs.label")}
      aria-owns={tabs.map((tab) => `tab-${tab.id}`).join(" ")} />
    {tabs.map((tab) => <div className="debug-tab" key={tab.id}>
      <button id={`tab-${tab.id}`} aria-label={tab.pinned ? t("workspace.tabs.pinnedAria", { title: tab.title }) : undefined} aria-controls={`tabpanel-${tab.id}`} type="button" role="tab" aria-selected={tab.id === activeId} tabIndex={tab.id === activeId ? 0 : -1}
        onClick={() => onSelect(tab.id)}>{tab.title}
        {tab.pinned && <span className="tab-pin-indicator" title={t("workspace.tabs.pinned")}><PushPin size={13} weight="fill" aria-hidden="true" /></span>}
        {dirtyIds.has(tab.id) && <span aria-label={t("workspace.tabs.unsaved")}> *</span>}
        {runningIds.has(tab.id) && <span aria-label={t("workspace.tabs.running")}> ⟳</span>}</button>
      <details className="tab-menu" onToggle={(event) => { if (event.currentTarget.open) positionMenu(event.currentTarget); }}><summary aria-label={t("workspace.tabs.actions", { title: tab.title })} onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault(); const details = event.currentTarget.parentElement;
        if (details instanceof HTMLDetailsElement) { details.open = !details.open; if (details.open) positionMenu(details); }
      }}><DotsThree size={18} weight="bold" aria-hidden="true" /></summary><div aria-label={t("workspace.tabs.menu", { title: tab.title })}>
        <button type="button" onClick={(event) => finishMenuAction(event, () => onCopyName(tab.toolName))}>{t("workspace.tabs.copyName")}</button>
        <button type="button" onClick={(event) => finishMenuAction(event, () => onDuplicate(tab.id))}>{t("workspace.tabs.duplicate")}</button>
        <button type="button" onClick={(event) => finishMenuAction(event, () => onPin(tab.id, !tab.pinned))}>{t(tab.pinned ? "workspace.tabs.unpin" : "workspace.tabs.pin")}</button>
        <button type="button" disabled={tab.position === 0} onClick={(event) => finishMenuAction(event, () => onMove(tab.id, -1))}>{t("workspace.tabs.moveLeft")}</button>
        <button type="button" disabled={tab.position === tabs.length - 1} onClick={(event) => finishMenuAction(event, () => onMove(tab.id, 1))}>{t("workspace.tabs.moveRight")}</button>
        <button type="button" onClick={(event) => finishMenuAction(event, () => onCloseOthers(tab.id))}>{t("workspace.tabs.closeOthers")}</button>
        <button type="button" onClick={(event) => finishMenuAction(event, () => onCloseRight(tab.id))}>{t("workspace.tabs.closeRight")}</button>
      </div></details>
      <button type="button" aria-label={t("workspace.tabs.close", { title: tab.title })} disabled={tab.pinned} onClick={() => onClose(tab.id)}><X size={15} aria-hidden="true" /></button>
    </div>)}
  </div>;
}
