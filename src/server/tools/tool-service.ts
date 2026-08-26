import { createHash, randomUUID } from "node:crypto";
import type { ConnectionService } from "../connections/connection-service.js";
import { ConnectionNotFoundError } from "../connections/connection-service.js";
import { McpNotConnectedError } from "../connections/connection-runtime.js";
import type { ProjectService } from "../projects/project-service.js";
import { parseToolDefinition } from "../../shared/tool-definition.js";
import { ToolRepository, type RefreshedTool } from "./tool-repository.js";
import type { CatalogTool, JsonValue, ToolDefinition, ToolDetail, ToolFolder } from "./tool-types.js";

export class ToolNotFoundError extends Error {
  constructor() { super("Tool not found"); this.name = "ToolNotFoundError"; }
}

export class ToolNotRemovedError extends Error {
  constructor() { super("Only removed Tools can be deleted"); this.name = "ToolNotRemovedError"; }
}

export class InvalidToolFolderError extends Error {
  constructor() { super("Tool folder name is invalid"); this.name = "InvalidToolFolderError"; }
}

export class ToolFolderConflictError extends Error {
  constructor() { super("Tool folder already exists"); this.name = "ToolFolderConflictError"; }
}

export class ToolFolderNotFoundError extends Error {
  constructor() { super("Tool folder not found"); this.name = "ToolFolderNotFoundError"; }
}

export class InvalidToolCatalogError extends Error {
  constructor(message = "MCP Tool catalog is invalid") {
    super(message); this.name = "InvalidToolCatalogError";
  }
}

export class ToolRefreshError extends Error {
  constructor() { super("Unable to refresh MCP Tool catalog"); this.name = "ToolRefreshError"; }
}

function normalizeJson(value: unknown, ancestors: Set<object>): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "object" || ArrayBuffer.isView(value)) {
    throw new InvalidToolCatalogError("Value is not valid JSON");
  }
  if (ancestors.has(value)) throw new InvalidToolCatalogError("Cyclic value is not valid JSON");
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.hasOwn(value, index)) throw new InvalidToolCatalogError("Value is not valid JSON");
      }
      return value.map((item) => normalizeJson(item, ancestors));
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new InvalidToolCatalogError("Value is not valid JSON");
    }
    if (Object.getOwnPropertySymbols(value).length > 0) {
      throw new InvalidToolCatalogError("Value is not valid JSON");
    }
    const result = Object.create(null) as Record<string, JsonValue>;
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      result[key] = normalizeJson((value as Record<string, unknown>)[key], ancestors);
    }
    return result;
  } finally {
    ancestors.delete(value);
  }
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(normalizeJson(value, new Set()));
}

function validateDefinition(value: unknown): { definition: ToolDefinition; json: string } {
  const json = canonicalJson(value);
  try {
    return { definition: parseToolDefinition(JSON.parse(json) as unknown), json };
  } catch {
    throw new InvalidToolCatalogError();
  }
}

export interface ToolService {
  refresh(projectId: string, connectionId: string): Promise<CatalogTool[]>;
  list(projectId: string, connectionId: string): CatalogTool[];
  get(projectId: string, connectionId: string, toolName: string): ToolDetail;
  deleteRemoved(projectId: string, connectionId: string, toolName: string): void;
  listFolders(projectId: string, connectionId: string): ToolFolder[];
  createFolder(projectId: string, connectionId: string, name: unknown): ToolFolder;
  renameFolder(projectId: string, connectionId: string, folderId: string, name: unknown): ToolFolder;
  deleteFolder(projectId: string, connectionId: string, folderId: string): void;
  moveToFolder(projectId: string, connectionId: string, toolName: string, folderId: unknown): CatalogTool;
}

export function createToolService(
  projects: ProjectService,
  connections: ConnectionService,
  options: { createId?: () => string; now?: () => Date } = {},
): ToolService {
  const createId = options.createId ?? randomUUID;
  const now = options.now ?? (() => new Date());

  function repository(projectId: string, connectionId: string): ToolRepository {
    const exists = connections.list(projectId).some(({ id }) => id === connectionId);
    if (!exists) throw new ConnectionNotFoundError();
    return new ToolRepository(projects.open(projectId));
  }

  function folderName(value: unknown): string {
    if (typeof value !== "string") throw new InvalidToolFolderError();
    const name = value.trim();
    if (name.length === 0 || name.length > 80 || /[\u0000-\u001f\u007f]/u.test(name)) {
      throw new InvalidToolFolderError();
    }
    return name;
  }

  return {
    async refresh(projectId, connectionId) {
      const repo = repository(projectId, connectionId);
      const session = connections.runtime(projectId).get(connectionId);
      if (session === undefined) throw new McpNotConnectedError();
      const definitions: unknown[] = [];
      const requestedCursors = new Set<string>();
      let cursor: string | undefined;
      try {
        for (let pageNumber = 1; pageNumber <= 1_000; pageNumber += 1) {
          const page: unknown = await session.listTools(cursor === undefined ? undefined : { cursor });
          if (typeof page !== "object" || page === null || !Array.isArray((page as { tools?: unknown }).tools)) {
            throw new InvalidToolCatalogError();
          }
          definitions.push(...(page as { tools: unknown[] }).tools);
          const nextCursor = (page as { nextCursor?: unknown }).nextCursor;
          if (nextCursor === undefined) break;
          if (typeof nextCursor !== "string" || requestedCursors.has(nextCursor)) {
            throw new InvalidToolCatalogError("MCP Tool cursor repeated");
          }
          if (pageNumber === 1_000) {
            throw new InvalidToolCatalogError("MCP Tool pagination exceeded 1,000 pages");
          }
          requestedCursors.add(nextCursor);
          cursor = nextCursor;
        }
      } catch (error) {
        if (error instanceof InvalidToolCatalogError) throw error;
        throw new ToolRefreshError();
      }

      const names = new Set<string>();
      const incoming: RefreshedTool[] = definitions.map((value) => {
        const { definition, json } = validateDefinition(value);
        if (names.has(definition.name)) {
          throw new InvalidToolCatalogError("MCP Tool catalog contains duplicate names");
        }
        names.add(definition.name);
        return {
          id: createId(),
          name: definition.name,
          contentHash: createHash("sha256").update(json, "utf8").digest("hex"),
          definitionJson: json,
        };
      });

      try {
        repo.replaceCatalog(projectId, connectionId, incoming, now().toISOString());
      } catch {
        throw new ToolRefreshError();
      }
      return repo.list(projectId, connectionId);
    },

    list(projectId, connectionId) {
      return repository(projectId, connectionId).list(projectId, connectionId);
    },

    listFolders(projectId, connectionId) {
      return repository(projectId, connectionId).listFolders(projectId, connectionId);
    },

    createFolder(projectId, connectionId, value) {
      const name = folderName(value);
      const created = repository(projectId, connectionId).createFolder(
        projectId, connectionId, createId(), name, now().toISOString(),
      );
      if (created === null) throw new ToolFolderConflictError();
      return created;
    },

    renameFolder(projectId, connectionId, folderId, value) {
      if (folderId.length === 0) throw new ToolFolderNotFoundError();
      const result = repository(projectId, connectionId).renameFolder(
        projectId, connectionId, folderId, folderName(value), now().toISOString(),
      );
      if (result === "missing") throw new ToolFolderNotFoundError();
      if (result === "conflict") throw new ToolFolderConflictError();
      return result;
    },

    deleteFolder(projectId, connectionId, folderId) {
      if (folderId.length === 0 || !repository(projectId, connectionId).deleteFolder(
        projectId, connectionId, folderId,
      )) throw new ToolFolderNotFoundError();
    },

    moveToFolder(projectId, connectionId, toolName, value) {
      if (toolName.length === 0) throw new ToolNotFoundError();
      if (!(value === null || (typeof value === "string" && value.length > 0))) {
        throw new ToolFolderNotFoundError();
      }
      const result = repository(projectId, connectionId).moveToFolder(
        projectId, connectionId, toolName, value,
      );
      if (result === "tool-missing") throw new ToolNotFoundError();
      if (result === "folder-missing") throw new ToolFolderNotFoundError();
      return result;
    },

    get(projectId, connectionId, toolName) {
      if (toolName.length === 0) throw new ToolNotFoundError();
      const detail = repository(projectId, connectionId).get(projectId, connectionId, toolName);
      if (detail === null) throw new ToolNotFoundError();
      return detail;
    },

    deleteRemoved(projectId, connectionId, toolName) {
      if (toolName.length === 0) throw new ToolNotFoundError();
      const result = repository(projectId, connectionId).deleteRemoved(projectId, connectionId, toolName);
      if (result === "missing") throw new ToolNotFoundError();
      if (result === "active") throw new ToolNotRemovedError();
    },
  };
}
