import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { fallbackLocale, parseLocale, type SupportedLocale } from "../../shared/i18n/locale.js";
import { enUSTools } from "../../shared/i18n/locales/en-US/tools.js";
import { zhCNTools } from "../../shared/i18n/locales/zh-CN/tools.js";

const localeStorageKey = "mcp-inspector.locale";

function savedLocale(): SupportedLocale | null {
  try { return parseLocale(window.localStorage.getItem(localeStorageKey)); }
  catch { return null; }
}

function saveLocale(locale: SupportedLocale): void {
  try { window.localStorage.setItem(localeStorageKey, locale); }
  catch { /* Storage can be unavailable in locked-down browser contexts. */ }
}

function initialLocale(): SupportedLocale {
  if (typeof window === "undefined") return fallbackLocale;
  if (typeof process !== "undefined" && process.env.NODE_ENV === "test") return fallbackLocale;
  const saved = savedLocale();
  if (saved !== null) return saved;
  for (const candidate of window.navigator.languages ?? [window.navigator.language]) {
    const parsed = parseLocale(candidate);
    if (parsed !== null) return parsed;
  }
  return fallbackLocale;
}

if (!i18n.isInitialized) {
  void i18n.use(initReactI18next).init({
    lng: initialLocale(),
    fallbackLng: fallbackLocale,
    supportedLngs: ["zh-CN", "en-US"],
    defaultNS: "tools",
    interpolation: { escapeValue: false },
    resources: {
      "zh-CN": { tools: zhCNTools },
      "en-US": { tools: enUSTools },
    },
  });
}

if (typeof document !== "undefined") document.documentElement.lang = i18n.resolvedLanguage ?? fallbackLocale;
i18n.on("languageChanged", (locale) => {
  const parsed = parseLocale(locale) ?? fallbackLocale;
  if (typeof document !== "undefined") document.documentElement.lang = parsed;
  if (typeof window !== "undefined") saveLocale(parsed);
});

export { i18n };
