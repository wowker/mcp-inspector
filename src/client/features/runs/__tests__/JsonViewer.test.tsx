// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { i18n } from "../../../i18n/index.js";
import { analyzeJsonDocument, createBoundedJsonPreview, JsonViewer } from "../JsonViewer.js";

describe("JsonViewer", () => {
  beforeEach(async () => { await i18n.changeLanguage("zh-CN"); });
  afterEach(() => cleanup());

  it("keeps very wide documents collapsed until the user asks to render their rows", () => {
    const value = Object.fromEntries(Array.from({ length: 101 }, (_, index) => [`key-${index}`, index]));
    render(<JsonViewer value={value} label="大型 JSON" />);

    expect(screen.queryByText(/^key-0/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "展开 JSON" }));
    expect(screen.getByText(/^key-0/)).toBeVisible();
  });

  it("localizes JSON tree controls", async () => {
    await i18n.changeLanguage("en-US");
    render(<JsonViewer value={{ nested: { value: 1 } }} />);
    expect(screen.getAllByRole("button", { name: "Collapse JSON" }).length).toBeGreaterThan(0);
  });

  it("renders a bounded preview instead of mounting a 10 MB JSON value", () => {
    const tenMegabytes = "x".repeat(10 * 1024 * 1024);
    const startedAt = performance.now();
    render(<JsonViewer value={{ payload: tenMegabytes, retained: true }} defaultExpanded="all" />);

    expect(performance.now() - startedAt).toBeLessThan(250);
    expect(screen.getByRole("status")).toHaveTextContent("大型 JSON 已采用安全预览");
    expect(screen.getByText(/其余内容已省略/u)).toBeVisible();
    expect(document.body.textContent?.length).toBeLessThan(10_000);
  });

  it("bounds wide previews and detects large documents without serializing them", () => {
    const value = Object.fromEntries(Array.from({ length: 10_000 }, (_, index) => [`key-${index}`, index]));
    expect(analyzeJsonDocument(value).large).toBe(true);
    expect(Object.keys(createBoundedJsonPreview(value, "truncated"))).toHaveLength(51);
  });
});
