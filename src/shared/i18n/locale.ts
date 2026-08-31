export const supportedLocales = ["zh-CN", "en-US"] as const;
export type SupportedLocale = (typeof supportedLocales)[number];
export const fallbackLocale: SupportedLocale = "zh-CN";

export function parseLocale(value: string | null | undefined): SupportedLocale | null {
  if (value === null || value === undefined) return null;
  const normalized = value.replace("_", "-").toLowerCase();
  if (normalized === "zh" || normalized.startsWith("zh-")) return "zh-CN";
  if (normalized === "en" || normalized.startsWith("en-")) return "en-US";
  return null;
}
