import { useEffect, useRef } from "react";
import type { DebugTabSummary } from "../../api/api-client.js";

interface Props {
  tabs: DebugTabSummary[]; activeId: string | null; onSelect: (id: string) => void;
  onClose: (id: string) => void; onDuplicate: (id: string) => void; onPin: (id: string, pinned: boolean) => void;
  onCloseOthers: (id: string) => void; onCloseRight: (id: string) => void;
  onMove: (id: string, offset: -1 | 1) => void;
  dirtyIds?: ReadonlySet<string>; runningIds?: ReadonlySet<string>;
}

export function TabStrip({ tabs, activeId, onSelect, onClose, onDuplicate, onPin, onCloseOthers, onCloseRight, onMove,
  dirtyIds = new Set(), runningIds = new Set() }: Props) {
  const strip = useRef<HTMLDivElement>(null);
  const previousActive = useRef<string | null>(activeId);
  useEffect(() => {
    if (previousActive.current !== null && previousActive.current !== activeId) {
      const candidate = document.getElementById(`tab-${activeId ?? ""}`);
      if (candidate instanceof HTMLButtonElement && strip.current?.contains(candidate)) candidate.focus();
    }
    previousActive.current = activeId;
  }, [activeId]);
  return <div ref={strip} className="debug-tabs" role="tablist" aria-label="Tool 调试 Tabs" onKeyDown={(event) => {
    if (!(event.target instanceof HTMLElement) || event.target.getAttribute("role") !== "tab") return;
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const index = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1
      : event.key === "ArrowRight" ? (current + 1) % buttons.length : (current - 1 + buttons.length) % buttons.length;
    const next = buttons[index]; if (next !== undefined) { event.preventDefault(); next.focus(); next.click(); }
  }}>
    {tabs.map((tab) => <div className="debug-tab" key={tab.id}>
      <button id={`tab-${tab.id}`} aria-controls={`tabpanel-${tab.id}`} type="button" role="tab" aria-selected={tab.id === activeId} tabIndex={tab.id === activeId ? 0 : -1}
        onClick={() => onSelect(tab.id)}>{tab.pinned ? "固定 " : ""}{tab.title}
        {dirtyIds.has(tab.id) && <span aria-label="未保存"> *</span>}
        {runningIds.has(tab.id) && <span aria-label="运行中"> ⟳</span>}</button>
      <details className="tab-menu"><summary aria-label={`${tab.title} 操作`}>⋯</summary><div>
        <button type="button" onClick={() => onDuplicate(tab.id)}>复制 Tab</button>
        <button type="button" onClick={() => onPin(tab.id, !tab.pinned)}>{tab.pinned ? "取消固定" : "固定"}</button>
        <button type="button" disabled={tab.position === 0} onClick={() => onMove(tab.id, -1)}>左移</button>
        <button type="button" disabled={tab.position === tabs.length - 1} onClick={() => onMove(tab.id, 1)}>右移</button>
        <button type="button" onClick={() => onCloseOthers(tab.id)}>关闭其他</button>
        <button type="button" onClick={() => onCloseRight(tab.id)}>关闭右侧</button>
      </div></details>
      <button type="button" aria-label={`关闭 ${tab.title}`} disabled={tab.pinned} onClick={() => onClose(tab.id)}>×</button>
    </div>)}
  </div>;
}
