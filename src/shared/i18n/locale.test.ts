import { describe, expect, it } from "vitest";
import { fallbackLocale, parseLocale, supportedLocales } from "./locale.js";
import { enUSTools } from "./locales/en-US/tools.js";
import { zhCNTools } from "./locales/zh-CN/tools.js";

function leafKeys(value: object, prefix = ""): string[] {
  return Object.entries(value).flatMap(([key, child]) => {
    const path = prefix === "" ? key : `${prefix}.${key}`;
    return typeof child === "object" && child !== null ? leafKeys(child, path) : [path];
  });
}

describe("locale contract", () => {
  it("normalizes supported browser locale variants and rejects unsupported input", () => {
    expect(supportedLocales).toEqual(["zh-CN", "en-US"]);
    expect(fallbackLocale).toBe("zh-CN");
    expect(parseLocale("zh-Hans-CN")).toBe("zh-CN");
    expect(parseLocale("en_GB")).toBe("en-US");
    expect(parseLocale("fr-FR")).toBeNull();
  });

  it("keeps the Chinese and English Tool resource trees in sync", () => {
    expect(leafKeys(enUSTools).sort()).toEqual(leafKeys(zhCNTools).sort());
  });
});
