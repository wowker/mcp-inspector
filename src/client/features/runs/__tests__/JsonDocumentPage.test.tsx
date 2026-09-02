// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { i18n } from "../../../i18n/index.js";
import { JsonDocumentPage } from "../JsonDocumentPage.js";

describe("JsonDocumentPage", () => {
  beforeEach(async () => { await i18n.changeLanguage("zh-CN"); });
  afterEach(() => cleanup());

  it("receives one same-origin document and renders fully expanded formatted JSON", async () => {
    const opener = { postMessage: vi.fn() } as unknown as Window;
    Object.defineProperty(window, "opener", { configurable: true, writable: true, value: opener });
    history.replaceState(null, "", "/json-viewer?channel=viewer-1");
    render(<JsonDocumentPage />);

    expect(opener.postMessage).toHaveBeenCalledWith({ type: "json-viewer-ready", channelId: "viewer-1" }, window.location.origin);
    window.dispatchEvent(new MessageEvent("message", {
      origin: window.location.origin,
      source: opener,
      data: { type: "json-viewer-document", channelId: "viewer-1", label: "结构化响应", value: { nested: { answer: 5 } } },
    }));

    expect(await screen.findByRole("heading", { name: "结构化响应" })).toBeVisible();
    expect(screen.getByLabelText("结构化响应 JSON")).toHaveTextContent("nested");
    expect(screen.getByLabelText("结构化响应 JSON")).toHaveTextContent("answer");
    expect(screen.getAllByRole("button", { name: "收起 JSON" }).length).toBeGreaterThan(1);
  });

  it("renders standalone JSON document controls in English", async () => {
    Object.defineProperty(window, "opener", { configurable: true, writable: true, value: null });
    history.replaceState(null, "", "/json-viewer");
    await i18n.changeLanguage("en-US");
    render(<JsonDocumentPage />);

    expect(screen.getByRole("heading", { name: "Request result" })).toBeVisible();
    expect(screen.getByRole("alert")).toHaveTextContent("Unable to read JSON");
  });
});
