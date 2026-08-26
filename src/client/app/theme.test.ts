// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyInitialTheme, toggleTheme, type ThemeMode } from "./theme.js";

describe("application theme", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("data-color-mode");
    document.documentElement.removeAttribute("data-light-theme");
    document.documentElement.removeAttribute("data-dark-theme");
  });

  it("uses the operating system preference when no choice was saved", () => {
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: true }));

    const mode = applyInitialTheme();

    expect(mode).toBe("dark");
    expect(document.documentElement).toHaveAttribute("data-color-mode", "dark");
  });

  it("restores and applies a saved light theme", () => {
    localStorage.setItem("mcp-inspector-theme", "light");
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: true }));

    expect(applyInitialTheme()).toBe("light");
    expect(document.documentElement).toHaveAttribute("data-color-mode", "light");
  });

  it("toggles the active theme and persists the new preference", () => {
    const next: ThemeMode = toggleTheme("light");

    expect(next).toBe("dark");
    expect(localStorage.getItem("mcp-inspector-theme")).toBe("dark");
    expect(document.documentElement).toHaveAttribute("data-color-mode", "dark");
  });

  it("keeps saved connection values legible in the themed edit dialog", () => {
    const css = readFileSync(resolve(process.cwd(), "src/client/app/redesign.css"), "utf8");

    expect(css).toMatch(/\.connection-fields input,\s*\.connection-fields select\s*\{[^}]*color:\s*var\(--ui-text\)/s);
    expect(css).toMatch(/\.connection-header-row input\s*\{[^}]*color:\s*var\(--ui-text\)/s);
  });

  it("keeps the secret visibility control vertically anchored while pressed", () => {
    const css = readFileSync(resolve(process.cwd(), "src/client/app/redesign.css"), "utf8");

    expect(css).toMatch(/\.connection-secret-input button:active:not\(:disabled\)\s*\{[^}]*transform:\s*translateY\(-50%\)/s);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});
