import { createHash, randomUUID } from "node:crypto";
import type { ConnectionService } from "../connections/connection-service.js";
import { ConnectionNotFoundError } from "../connections/connection-service.js";
import { McpNotConnectedError } from "../connections/connection-runtime.js";
import type { ProjectService } from "../projects/project-service.js";
import { ToolRepository, type RefreshedTool } from "./tool-repository.js";
import type { CatalogTool, JsonValue, ToolDefinition, ToolDetail } from "./tool-types.js";

export class ToolNotFoundError extends Error {
  constructor() { super("Tool not found"); this.name = "ToolNotFoundError"; }
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
  const definition = JSON.parse(json) as unknown;
  if (typeof definition !== "object" || definition === null || Array.isArray(definition)) {
    throw new InvalidToolCatalogError();
  }
  const candidate = definition as Record<string, JsonValue>;
  if (typeof candidate.name !== "string" || candidate.name.trim().length === 0 ||
      typeof candidate.inputSchema !== "object" || candidate.inputSchema === null ||
      Array.isArray(candidate.inputSchema) || candidate.inputSchema.type !== "object" ||
      (candidate.title !== undefined && typeof candidate.title !== "string") ||
      (candidate.description !== undefined && typeof candidate.description !== "string") ||
      (candidate.outputSchema !== undefined &&
        (typeof candidate.outputSchema !== "object" || candidate.outputSchema === null || Array.isArray(candidate.outputSchema))) ||
      (candidate.annotations !== undefined &&
        (typeof candidate.annotations !== "object" || candidate.annotations === null || Array.isArray(candidate.annotations))) ||
      (candidate.execution !== undefined &&
        (typeof candidate.execution !== "object" || candidate.execution === null || Array.isArray(candidate.execution))) ||
      (candidate._meta !== undefined &&
        (typeof candidate._meta !== "object" || candidate._meta === null || Array.isArray(candidate._meta))) ||
      (candidate.icons !== undefined && !Array.isArray(candidate.icons))) {
    throw new InvalidToolCatalogError();
  }
  return { definition: candidate as ToolDefinition, json };
}

export interface ToolService {
  refresh(projectId: string, connectionId: string): Promise<CatalogTool[]>;
  list(projectId: string, connectionId: string): CatalogTool[];
  get(projectId: string, connectionId: string, toolName: string): ToolDetail;
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

    get(projectId, connectionId, toolName) {
      if (toolName.length === 0) throw new ToolNotFoundError();
      const detail = repository(projectId, connectionId).get(projectId, connectionId, toolName);
      if (detail === null) throw new ToolNotFoundError();
      return detail;
    },
  };
}
