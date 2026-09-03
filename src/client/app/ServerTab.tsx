import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { DotsThree, X } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import type { ConnectionSummary } from "../api/api-client.js";
import { IconButton } from "../components/actions/IconButton.js";
import { Popover } from "../components/overlays/Popover.js";

interface Props {
  connection: ConnectionSummary;
  selected: boolean;
  tabIndex: number;
  onSelect: () => void;
  onClose: () => void | Promise<void>;
  onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
}

export function ServerTab({ connection, selected, tabIndex, onSelect, onClose, onKeyDown }: Props) {
  const { t } = useTranslation("app");
  const [menuOpen, setMenuOpen] = useState(false);
  const triggerRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuLabel = t("workbench.serverTabs.actions", { name: connection.name });
  const closeMenu = useCallback((returnFocus: boolean) => {
    setMenuOpen(false);
    if (returnFocus) queueMicrotask(() => triggerRef.current?.querySelector("button")?.focus());
  }, []);
  useEffect(() => {
    if (menuOpen) queueMicrotask(() => menuRef.current?.querySelector<HTMLElement>("[role='menuitem']")?.focus());
  }, [menuOpen]);

  return <div className="server-tab" data-selected={selected || undefined}>
    <button id={`server-tab-${connection.id}`} type="button" role="tab" aria-controls="server-tool-panel"
      aria-selected={selected} tabIndex={tabIndex} onClick={onSelect} onKeyDown={onKeyDown}>
      <i aria-hidden="true" />
      <span title={connection.name}>{connection.name}</span>
    </button>
    <div ref={triggerRef} className="server-tab__menu-anchor">
      <IconButton size="compact" className="server-tab__menu-trigger" label={menuLabel}
        icon={<DotsThree size={18} weight="bold" aria-hidden="true" />} aria-expanded={menuOpen}
        aria-haspopup="menu" onClick={() => setMenuOpen((current) => !current)} />
    </div>
    {menuOpen && <Popover anchorRef={triggerRef} contentRef={menuRef} role="menu" ariaLabel={menuLabel}
      className="server-tab-menu" minWidth={180} onClose={closeMenu}>
      <button type="button" role="menuitem" onClick={() => { closeMenu(false); void onClose(); }}>
        <X size={16} aria-hidden="true" />{t("workbench.serverTabs.close")}
      </button>
    </Popover>}
  </div>;
}
