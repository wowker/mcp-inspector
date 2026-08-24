// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { App } from "./App.js";

describe("App", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    sessionStorage.clear();
    history.replaceState(null, "", "/");
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  test("checks health with the bootstrap session and announces the version", async () => {
    history.replaceState(null, "", "/?session=test-session");
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ ok: true, version: "0.1.0" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    render(<App />);

    expect(await screen.findByRole("status")).toHaveTextContent(
      "本地服务已就绪 · v0.1.0",
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/health",
      expect.objectContaining({
        headers: { "X-DSers-Inspector-Session": "test-session" },
      }),
    );
    expect(location.search).toBe("");
  });

  test("shows an accessible alert and skips the request without a session", () => {
    render(<App />);

    expect(screen.getByRole("alert")).toHaveTextContent("Missing local session");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("announces a non-success health response as an error", async () => {
    sessionStorage.setItem("dsers-inspector-session", "test-session");
    fetchMock.mockResolvedValue(new Response(null, { status: 503 }));

    render(<App />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Health check failed (503)",
    );
  });

  test("announces a network failure as an error", async () => {
    sessionStorage.setItem("dsers-inspector-session", "test-session");
    fetchMock.mockRejectedValue(new Error("connection refused"));

    render(<App />);

    expect(await screen.findByRole("alert")).toHaveTextContent("connection refused");
  });

  test("rejects a malformed success response", async () => {
    sessionStorage.setItem("dsers-inspector-session", "test-session");
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ ok: "yes" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("Invalid health response");
    });
  });

  test("shows connection configuration management after a project opens", async () => {
    sessionStorage.setItem("dsers-inspector-session", "test-session");
    const project = {
      id: "00000000-0000-4000-8000-000000000501",
      name: "Supplier Tools",
      createdAt: "2026-08-17T00:00:00.000Z",
      updatedAt: "2026-08-17T00:00:00.000Z",
      lastOpenedAt: "2026-08-17T01:00:00.000Z",
    };
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, version: "0.1.0" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ projects: [project] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ project }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ connections: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }));

    render(<App />);

    expect(await screen.findByRole("heading", { name: "Supplier Tools" })).toBeVisible();
    expect(await screen.findByRole("heading", { name: "连接管理" })).toBeVisible();
    expect(fetchMock).toHaveBeenLastCalledWith(
      `/api/projects/${project.id}/connections`,
      expect.objectContaining({
        headers: expect.objectContaining({ "X-DSers-Inspector-Session": "test-session" }),
      }),
    );
  });
});
