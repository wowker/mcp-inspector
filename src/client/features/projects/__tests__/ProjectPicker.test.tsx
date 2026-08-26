// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { InspectorApiClient, ProjectSummary } from "../../../api/api-client.js";
import { ProjectPicker } from "../ProjectPicker.js";

const project = (overrides: Partial<ProjectSummary> = {}): ProjectSummary => ({
  id: "00000000-0000-4000-8000-000000000001",
  name: "Supplier Tools",
  createdAt: "2026-08-17T00:00:00.000Z",
  updatedAt: "2026-08-17T00:00:00.000Z",
  lastOpenedAt: null,
  ...overrides,
});

function api(overrides: Partial<InspectorApiClient> = {}): InspectorApiClient {
  return {
    listProjects: vi.fn().mockResolvedValue([]),
    createProject: vi.fn(),
    openProject: vi.fn(),
    listConnections: vi.fn().mockResolvedValue([]),
    createConnection: vi.fn(),
    updateConnection: vi.fn(),
    exportConnection: vi.fn(),
    deleteConnection: vi.fn(),
    connectConnection: vi.fn(),
    disconnectConnection: vi.fn(),
    listTools: vi.fn(),
    refreshTools: vi.fn(),
    getTool: vi.fn(),
    deleteTool: vi.fn(),
    listToolFolders: vi.fn().mockResolvedValue([]),
    createToolFolder: vi.fn(),
    renameToolFolder: vi.fn(),
    deleteToolFolder: vi.fn(),
    moveToolToFolder: vi.fn(),
    listTabs: vi.fn().mockResolvedValue([]),
    openTab: vi.fn(), replaceTabTool: vi.fn(), updateTab: vi.fn(), duplicateTab: vi.fn(),
    reorderTabs: vi.fn(), closeTab: vi.fn(), closeOtherTabs: vi.fn(), closeTabsRight: vi.fn(),
    startRun: vi.fn(), getRunSummary: vi.fn(), getRun: vi.fn(), listRuns: vi.fn(), openRunEventStream: vi.fn(),
    listSavedItems: vi.fn(), getSavedItem: vi.fn(), createSavedItem: vi.fn(), deleteSavedItem: vi.fn(),
    ...overrides,
  };
}

afterEach(cleanup);

describe("ProjectPicker", () => {
  it("auto-opens the most recently opened project", async () => {
    const older = project({ id: "00000000-0000-4000-8000-000000000002", lastOpenedAt: "2026-08-17T01:00:00.000Z" });
    const recent = project({ id: "00000000-0000-4000-8000-000000000003", lastOpenedAt: "2026-08-17T02:00:00.000Z" });
    const client = api({
      listProjects: vi.fn().mockResolvedValue([older, recent]),
      openProject: vi.fn().mockResolvedValue(recent),
    });
    const onProjectOpened = vi.fn();

    render(<ProjectPicker api={client} onProjectOpened={onProjectOpened} />);

    expect(await screen.findByRole("status")).toHaveTextContent("正在打开 Supplier Tools");
    expect(client.openProject).toHaveBeenCalledWith(recent.id);
    expect(onProjectOpened).toHaveBeenCalledWith(recent);
  });

  it("creates and opens a project from an accessible form", async () => {
    const created = project();
    const client = api({
      createProject: vi.fn().mockResolvedValue(created),
      openProject: vi.fn().mockResolvedValue({ ...created, lastOpenedAt: "2026-08-17T03:00:00.000Z" }),
    });
    const onProjectOpened = vi.fn();
    const user = userEvent.setup();
    render(<ProjectPicker api={client} onProjectOpened={onProjectOpened} />);

    await screen.findByRole("heading", { name: "选择项目" });
    await user.type(screen.getByLabelText("项目名称"), "Supplier Tools");
    await user.click(screen.getByRole("button", { name: "创建并打开" }));

    expect(client.createProject).toHaveBeenCalledWith("Supplier Tools");
    expect(client.openProject).toHaveBeenCalledWith(created.id);
    expect(onProjectOpened).toHaveBeenCalled();
  });

  it("opens an existing project and exposes loading errors as alerts", async () => {
    const existing = project();
    const client = api({
      listProjects: vi.fn().mockResolvedValue([existing]),
      openProject: vi.fn().mockResolvedValue(existing),
    });
    const user = userEvent.setup();
    render(<ProjectPicker api={client} onProjectOpened={vi.fn()} />);

    await user.click(await screen.findByRole("button", { name: "打开 Supplier Tools" }));
    expect(client.openProject).toHaveBeenCalledWith(existing.id);

    cleanup();
    render(<ProjectPicker api={api({ listProjects: vi.fn().mockRejectedValue(new Error("database unavailable")) })} onProjectOpened={vi.fn()} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("database unavailable");
  });

  it("shows an alert when automatic opening fails", async () => {
    const recent = project({ lastOpenedAt: "2026-08-17T02:00:00.000Z" });
    const client = api({
      listProjects: vi.fn().mockResolvedValue([recent]),
      openProject: vi.fn().mockRejectedValue(new Error("project is locked")),
    });

    render(<ProjectPicker api={client} onProjectOpened={vi.fn()} />);

    expect(await screen.findByRole("alert")).toHaveTextContent("project is locked");
    expect(screen.getByRole("button", { name: "打开 Supplier Tools" })).toBeEnabled();
  });

  it("keeps a newly created project visible when opening fails and allows retry", async () => {
    const created = project();
    const openProject = vi.fn()
      .mockRejectedValueOnce(new Error("project is locked"))
      .mockResolvedValueOnce(created);
    const client = api({
      createProject: vi.fn().mockResolvedValue(created),
      openProject,
    });
    const onProjectOpened = vi.fn();
    const user = userEvent.setup();
    render(<ProjectPicker api={client} onProjectOpened={onProjectOpened} />);

    await screen.findByRole("heading", { name: "选择项目" });
    await user.type(screen.getByLabelText("项目名称"), "Supplier Tools");
    await user.click(screen.getByRole("button", { name: "创建并打开" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("project is locked");
    await user.click(screen.getByRole("button", { name: "打开 Supplier Tools" }));
    expect(openProject).toHaveBeenCalledTimes(2);
    expect(onProjectOpened).toHaveBeenCalledWith(created);
  });

  it("can retry the initial project list after an error", async () => {
    const listProjects = vi.fn()
      .mockRejectedValueOnce(new Error("database unavailable"))
      .mockResolvedValueOnce([]);
    const user = userEvent.setup();
    render(<ProjectPicker api={api({ listProjects })} onProjectOpened={vi.fn()} />);

    expect(await screen.findByRole("alert")).toHaveTextContent("database unavailable");
    await user.click(screen.getByRole("button", { name: "重试" }));
    expect(await screen.findByRole("heading", { name: "选择项目" })).toBeVisible();
    expect(listProjects).toHaveBeenCalledTimes(2);
  });
});
