import { describe, expect, it } from "vitest";
import { fallbackLocale, parseLocale, supportedLocales } from "./locale.js";
import { enUSTools } from "./locales/en-US/tools.js";
import { zhCNTools } from "./locales/zh-CN/tools.js";
import { enUSApp } from "./locales/en-US/app.js";
import { zhCNApp } from "./locales/zh-CN/app.js";
import { enUSServers } from "./locales/en-US/servers.js";
import { zhCNServers } from "./locales/zh-CN/servers.js";
import { enUSRuns } from "./locales/en-US/runs.js";
import { zhCNRuns } from "./locales/zh-CN/runs.js";
import { enUSEnvironment } from "./locales/en-US/environment.js";
import { zhCNEnvironment } from "./locales/zh-CN/environment.js";
import { enUSSavedItems } from "./locales/en-US/savedItems.js";
import { zhCNSavedItems } from "./locales/zh-CN/savedItems.js";
import { enUSScripts } from "./locales/en-US/scripts.js";
import { zhCNScripts } from "./locales/zh-CN/scripts.js";
import { enUSProjects } from "./locales/en-US/projects.js";
import { zhCNProjects } from "./locales/zh-CN/projects.js";
import { enUSTesting } from "./locales/en-US/testing.js";
import { zhCNTesting } from "./locales/zh-CN/testing.js";

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
    expect(leafKeys(enUSApp).sort()).toEqual(leafKeys(zhCNApp).sort());
    expect(leafKeys(enUSServers).sort()).toEqual(leafKeys(zhCNServers).sort());
    expect(leafKeys(enUSRuns).sort()).toEqual(leafKeys(zhCNRuns).sort());
    expect(leafKeys(enUSEnvironment).sort()).toEqual(leafKeys(zhCNEnvironment).sort());
    expect(leafKeys(enUSSavedItems).sort()).toEqual(leafKeys(zhCNSavedItems).sort());
    expect(leafKeys(enUSScripts).sort()).toEqual(leafKeys(zhCNScripts).sort());
    expect(leafKeys(enUSProjects).sort()).toEqual(leafKeys(zhCNProjects).sort());
    expect(leafKeys(enUSTesting).sort()).toEqual(leafKeys(zhCNTesting).sort());
  });
});
