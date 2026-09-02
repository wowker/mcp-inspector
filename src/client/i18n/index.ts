import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { fallbackLocale, parseLocale, type SupportedLocale } from "../../shared/i18n/locale.js";
import { enUSTools } from "../../shared/i18n/locales/en-US/tools.js";
import { zhCNTools } from "../../shared/i18n/locales/zh-CN/tools.js";
import { enUSApp } from "../../shared/i18n/locales/en-US/app.js";
import { zhCNApp } from "../../shared/i18n/locales/zh-CN/app.js";
import { enUSServers } from "../../shared/i18n/locales/en-US/servers.js";
import { zhCNServers } from "../../shared/i18n/locales/zh-CN/servers.js";
import { enUSRuns } from "../../shared/i18n/locales/en-US/runs.js";
import { zhCNRuns } from "../../shared/i18n/locales/zh-CN/runs.js";
import { enUSEnvironment } from "../../shared/i18n/locales/en-US/environment.js";
import { zhCNEnvironment } from "../../shared/i18n/locales/zh-CN/environment.js";
import { enUSSavedItems } from "../../shared/i18n/locales/en-US/savedItems.js";
import { zhCNSavedItems } from "../../shared/i18n/locales/zh-CN/savedItems.js";
import { enUSScripts } from "../../shared/i18n/locales/en-US/scripts.js";
import { zhCNScripts } from "../../shared/i18n/locales/zh-CN/scripts.js";
import { enUSProjects } from "../../shared/i18n/locales/en-US/projects.js";
import { zhCNProjects } from "../../shared/i18n/locales/zh-CN/projects.js";
import { enUSTesting } from "../../shared/i18n/locales/en-US/testing.js";
import { zhCNTesting } from "../../shared/i18n/locales/zh-CN/testing.js";

const localeStorageKey = "mcp-inspector.locale";

function savedLocale(): SupportedLocale | null {
  try { return parseLocale(window.localStorage.getItem(localeStorageKey)); }
  catch { return null; }
}

function saveLocale(locale: SupportedLocale): void {
  try { window.localStorage.setItem(localeStorageKey, locale); }
  catch { /* Storage can be unavailable in locked-down browser contexts. */ }
  try { document.cookie = `mcp_inspector_locale=${encodeURIComponent(locale)}; Path=/; SameSite=Lax`; }
  catch { /* Cookie persistence is best-effort in restricted browser contexts. */ }
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
      "zh-CN": { tools: zhCNTools, app: zhCNApp, servers: zhCNServers, runs: zhCNRuns, environment: zhCNEnvironment, savedItems: zhCNSavedItems, scripts: zhCNScripts, projects: zhCNProjects, testing: zhCNTesting },
      "en-US": { tools: enUSTools, app: enUSApp, servers: enUSServers, runs: enUSRuns, environment: enUSEnvironment, savedItems: enUSSavedItems, scripts: enUSScripts, projects: enUSProjects, testing: enUSTesting },
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
