import { useState } from "react";
import { useTranslation } from "react-i18next";
import { parseLocale } from "../../shared/i18n/locale.js";
import { Select } from "../components/forms/Select.js";

export function LanguageSwitcher() {
  const { i18n, t } = useTranslation("app");
  const [announcement, setAnnouncement] = useState("");
  const locale = parseLocale(i18n.resolvedLanguage) ?? "zh-CN";

  async function changeLocale(value: string): Promise<void> {
    const next = parseLocale(value);
    if (next === null || next === locale) return;
    await i18n.changeLanguage(next);
    setAnnouncement(t("language.changed", { lng: next }));
  }

  return <>
    <Select className="language-switcher" aria-label={t("language.label")} value={locale}
      onChange={(event) => void changeLocale(event.currentTarget.value)}>
      <option value="zh-CN">简体中文</option>
      <option value="en-US">English</option>
    </Select>
    <span className="sr-only" role="status" aria-live="polite">{announcement}</span>
  </>;
}
