import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { ConnectionService } from "../connections/connection-service.js";
import type { ProjectService } from "../projects/project-service.js";
import type { ToolService } from "../tools/tool-service.js";
import { createToolService } from "../tools/tool-service.js";
import { formatRawArguments } from "../../shared/json.js";
import { TabRepository, type DebugTab, type TabViewState } from "./tab-repository.js";

const uuid = z.string().uuid();
const viewState = z.object({ editorScrollTop: z.number().finite().min(0), resultScrollTop: z.number().finite().min(0),
  splitRatio: z.number().finite().min(0.2).max(0.8) }).strict();
export class TabNotFoundError extends Error { constructor() { super("Tab not found"); this.name = "TabNotFoundError"; } }
export class InvalidTabError extends Error { constructor(message = "Tab payload is invalid") { super(message); this.name = "InvalidTabError"; } }

function isJsonValue(value: unknown, ancestors = new Set<object>()): boolean {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "object" || ancestors.has(value)) return false;
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return Object.keys(value).length === value.length && value.every((item) => isJsonValue(item, ancestors));
    }
    if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) return false;
    return Object.getOwnPropertySymbols(value).length === 0 &&
      Object.values(value as Record<string, unknown>).every((item) => isJsonValue(item, ancestors));
  } finally { ancestors.delete(value); }
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) && isJsonValue(value);
}

export interface OpenTabInput { projectId: string; connectionId: string; toolName: string }
export interface UpdateTabInput {
  connectionId?: string; toolName?: string; title?: string; pinned?: boolean; inputMode?: "form" | "raw";
  arguments?: Record<string, unknown>; rawText?: string; viewState?: TabViewState; lastRunId?: string | null;
}
export interface TabService {
  list(projectId: string): DebugTab[]; get(projectId: string, id: string): DebugTab;
  open(input: OpenTabInput): DebugTab; replaceTool(projectId: string, id: string, connectionId: string, toolName: string): DebugTab;
  update(id: string, projectId: string, patch: UpdateTabInput): DebugTab; duplicate(projectId: string, id: string): DebugTab;
  reorder(projectId: string, ids: string[]): DebugTab[]; close(projectId: string, id: string): void;
  closeOthers(projectId: string, id: string): void; closeRight(projectId: string, id: string): void;
}

export function createTabService(projects: ProjectService, connections: ConnectionService,
  options: { tools?: ToolService; createId?: () => string; now?: () => Date } = {}): TabService {
  const tools = options.tools ?? createToolService(projects, connections);
  const createId = options.createId ?? randomUUID;
  const now = options.now ?? (() => new Date());
  const repo = (projectId: string) => new TabRepository(projects.open(projectId));
  const timestamp = () => now().toISOString();
  function validId(value: string): void { if (!uuid.safeParse(value).success) throw new TabNotFoundError(); }
  function existing(projectId: string, id: string): DebugTab {
    validId(id); const tab = repo(projectId).get(projectId, id); if (tab === null) throw new TabNotFoundError(); return tab;
  }
  function validateTool(projectId: string, connectionId: string, toolName: string): void {
    if (toolName.trim().length === 0 || toolName.length > 512) throw new InvalidTabError();
    const detail = tools.get(projectId, connectionId, toolName);
    if (detail.tool.status === "removed") throw new InvalidTabError("Removed Tool cannot be opened");
  }
  function titleFor(projectId: string, toolName: string, excludeId?: string): string {
    const used = new Set(repo(projectId).list(projectId).filter((tab) => tab.toolName === toolName && tab.id !== excludeId).map(({ title }) => title));
    if (!used.has(toolName)) return toolName;
    for (let suffix = 2; suffix < 100_000; suffix += 1) {
      const title = `${toolName} (${suffix})`; if (!used.has(title)) return title;
    }
    throw new Error("Unable to allocate Tab title");
  }
  function fresh(projectId: string, connectionId: string, toolName: string): DebugTab {
    const id = createId(); if (!uuid.safeParse(id).success) throw new Error("Tab ID generator returned an invalid UUID");
    return { id, projectId, connectionId, toolName, title: titleFor(projectId, toolName),
      position: repo(projectId).list(projectId).length, pinned: false, inputMode: "form", arguments: {}, rawText: "{}",
      viewState: { editorScrollTop: 0, resultScrollTop: 0, splitRatio: 0.5 }, lastRunId: null };
  }
  return {
    list(projectId) { return repo(projectId).list(projectId); },
    get(projectId, id) { return existing(projectId, id); },
    open(input) { validateTool(input.projectId, input.connectionId, input.toolName);
      return repo(input.projectId).insert(fresh(input.projectId, input.connectionId, input.toolName), timestamp()); },
    replaceTool(projectId, id, connectionId, toolName) {
      validateTool(projectId, connectionId, toolName); const tab = existing(projectId, id);
      return repo(projectId).replace({ ...tab, connectionId, toolName, title: titleFor(projectId, toolName, id),
        inputMode: "form", arguments: {}, rawText: "{}", lastRunId: null }, timestamp());
    },
    update(id, projectId, patch) {
      const tab = existing(projectId, id);
      if (patch.connectionId !== undefined || patch.toolName !== undefined) throw new InvalidTabError();
      if (patch.title !== undefined && (patch.title.trim().length === 0 || patch.title.length > 180)) throw new InvalidTabError();
      if (patch.inputMode !== undefined && patch.inputMode !== "form" && patch.inputMode !== "raw") throw new InvalidTabError();
      if (patch.arguments !== undefined && !isJsonObject(patch.arguments)) throw new InvalidTabError();
      if (patch.rawText !== undefined && (typeof patch.rawText !== "string" || patch.rawText.length > 2_000_000)) throw new InvalidTabError();
      if (patch.viewState !== undefined && !viewState.safeParse(patch.viewState).success) throw new InvalidTabError();
      if (patch.lastRunId !== undefined && patch.lastRunId !== null && !uuid.safeParse(patch.lastRunId).success) throw new InvalidTabError();
      const next = { ...tab, ...patch };
      if (patch.arguments !== undefined && patch.rawText === undefined && next.inputMode === "form") next.rawText = formatRawArguments(patch.arguments);
      return repo(projectId).replace(next, timestamp());
    },
    duplicate(projectId, id) {
      const source = existing(projectId, id); const copy = fresh(projectId, source.connectionId, source.toolName);
      return repo(projectId).insert({ ...copy, pinned: false, inputMode: source.inputMode,
        arguments: source.arguments, rawText: source.rawText, viewState: source.viewState }, timestamp());
    },
    reorder(projectId, ids) {
      const tabs = repo(projectId).list(projectId); const expected = new Set(tabs.map(({ id }) => id));
      if (ids.length !== tabs.length || new Set(ids).size !== ids.length || ids.some((id) => !expected.has(id))) throw new InvalidTabError();
      repo(projectId).reorder(projectId, ids, timestamp()); return repo(projectId).list(projectId);
    },
    close(projectId, id) { const tab = existing(projectId, id); if (!tab.pinned) repo(projectId).deleteIds(projectId, [id]); },
    closeOthers(projectId, id) { existing(projectId, id); repo(projectId).deleteIds(projectId,
      repo(projectId).list(projectId).filter((tab) => tab.id !== id && !tab.pinned).map(({ id: tabId }) => tabId)); },
    closeRight(projectId, id) { const target = existing(projectId, id); repo(projectId).deleteIds(projectId,
      repo(projectId).list(projectId).filter((tab) => tab.position > target.position && !tab.pinned).map(({ id: tabId }) => tabId)); },
  };
}
