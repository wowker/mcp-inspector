import { useCallback, useEffect, useRef, useState } from "react";
import { Gear, X } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import { IconButton } from "../../components/actions/IconButton.js";
import { SplitPanePresets, type SplitPanePreset } from "../../components/layout/SplitPanePresets.js";
import { Popover } from "../../components/overlays/Popover.js";

interface Props {
  value: SplitPanePreset | "custom";
  onChange: (value: SplitPanePreset) => void;
}

export function DebugSettingsPopover({ value, onChange }: Props) {
  const { t } = useTranslation("tools");
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const close = useCallback((returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) queueMicrotask(() => anchorRef.current?.querySelector("button")?.focus());
  }, []);
  useEffect(() => {
    if (open) queueMicrotask(() => {
      const content = contentRef.current;
      (content?.querySelector<HTMLElement>("[aria-pressed='true']") ?? content?.querySelector<HTMLElement>("button"))?.focus();
    });
  }, [open]);

  return <div ref={anchorRef} className="workspace-settings">
    <IconButton size="compact" label={t("workspace.settings.trigger")}
      icon={<Gear size={17} aria-hidden="true" />} aria-expanded={open} aria-haspopup="dialog"
      onClick={() => setOpen((current) => !current)} />
    {open && <Popover anchorRef={anchorRef} contentRef={contentRef} role="dialog"
      ariaLabel={t("workspace.settings.title")} className="debug-settings-popover" minWidth={280} onClose={close}>
      <header>
        <div><span>{t("workspace.settings.eyebrow")}</span><h2>{t("workspace.settings.title")}</h2></div>
        <IconButton size="compact" label={t("workspace.settings.close")}
          icon={<X size={16} aria-hidden="true" />} onClick={() => close(true)} />
      </header>
      <section aria-labelledby="debug-layout-settings-title">
        <h3 id="debug-layout-settings-title">{t("workspace.layoutPresets.label")}</h3>
        <p>{t("workspace.settings.layoutHint")}</p>
        <SplitPanePresets label={t("workspace.layoutPresets.label")} value={value}
          options={(["request", "balanced", "result"] as const).map((preset) => ({
            value: preset, label: t(`workspace.layoutPresets.${preset}`),
          }))}
          onChange={(preset) => { onChange(preset); close(true); }} />
      </section>
    </Popover>}
  </div>;
}
