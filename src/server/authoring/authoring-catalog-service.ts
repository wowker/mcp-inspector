import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import {
  authoringListInputSchema,
  type AuthoringConnectionSummary,
  type AuthoringListInput,
  type AuthoringPage,
  type AuthoringProjectSummary,
  type AuthoringToolDetail,
  type AuthoringToolSummary,
} from "../../shared/authoring/catalog.js";
import { authoringPolicyAllowsTool } from "../../shared/authoring/policy.js";
import type { JsonObject, JsonValue, ToolDefinition } from "../../shared/tool-definition.js";
import type { ConnectionService } from "../connections/connection-service.js";
import type { ProjectService } from "../projects/project-service.js";
import type { ToolService } from "../tools/tool-service.js";
import type { CatalogTool } from "../tools/tool-types.js";
import type { AuthoringPolicyService } from "./authoring-policy-service.js";

export class InvalidAuthoringCursorError extends Error {
  constructor() {
    super("Authoring cursor is invalid or does not match this query");
    this.name = "InvalidAuthoringCursorError";
  }
}

export class AuthoringCatalogAccessDeniedError extends Error {
  constructor() {
    super("Authoring catalog access is denied");
    this.name = "AuthoringCatalogAccessDeniedError";
  }
}

interface CursorPayload {
  version: 1;
  kind: "projects" | "connections" | "tools";
  scope: string;
  query: string;
  offset: number;
}

function truncate(value: string | undefined, maximum: number): string | null {
  if (value === undefined) return null;
  return value.length <= maximum ? value : `${value.slice(0, maximum - 1)}…`;
}

function toolSummary(tool: CatalogTool): AuthoringToolSummary {
  return {
    name: tool.name,
    title: truncate(tool.currentSnapshot.definition.title, 300),
    description: truncate(tool.currentSnapshot.definition.description, 1000),
    schemaHash: tool.currentSnapshot.contentHash,
    stale: tool.status !== "current",
    snapshotAt: tool.currentSnapshot.createdAt,
    untrusted: true,
  };
}

function extensions(definition: ToolDefinition): Record<string, JsonValue> {
  const known = new Set(["name", "title", "description", "inputSchema", "outputSchema", "annotations", "execution", "icons", "_meta"]);
  return Object.fromEntries(Object.entries(definition).filter(([key]) => !known.has(key)));
}

export interface AuthoringCatalogService {
  listProjects(input: AuthoringListInput): AuthoringPage<AuthoringProjectSummary>;
  listConnections(projectId: string, input: AuthoringListInput): AuthoringPage<AuthoringConnectionSummary>;
  listTools(projectId: string, connectionId: string, input: AuthoringListInput): AuthoringPage<AuthoringToolSummary>;
  describeTool(projectId: string, connectionId: string, toolName: string): AuthoringToolDetail;
}

export function createAuthoringCatalogService(options: {
  projects: ProjectService;
  connections: ConnectionService;
  tools: ToolService;
  policies: AuthoringPolicyService;
  cursorSecret?: Buffer;
}): AuthoringCatalogService {
  const cursorSecret = options.cursorSecret ?? randomBytes(32);

  function signature(value: string): Buffer {
    return createHmac("sha256", cursorSecret).update(value).digest();
  }

  function encodeCursor(payload: CursorPayload): string {
    const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
    return `${encoded}.${signature(encoded).toString("base64url")}`;
  }

  function offset(input: ReturnType<typeof authoringListInputSchema.parse>, kind: CursorPayload["kind"], scope: string): number {
    if (input.cursor === undefined) return 0;
    const [encoded, provided, extra] = input.cursor.split(".");
    if (encoded === undefined || provided === undefined || extra !== undefined) throw new InvalidAuthoringCursorError();
    let providedSignature: Buffer;
    let payload: unknown;
    try {
      providedSignature = Buffer.from(provided, "base64url");
      payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    } catch {
      throw new InvalidAuthoringCursorError();
    }
    const expected = signature(encoded);
    if (providedSignature.length !== expected.length || !timingSafeEqual(providedSignature, expected)) {
      throw new InvalidAuthoringCursorError();
    }
    const candidate = payload as Partial<CursorPayload>;
    if (candidate.version !== 1 || candidate.kind !== kind || candidate.scope !== scope ||
        candidate.query !== input.query.toLowerCase() || !Number.isSafeInteger(candidate.offset) || candidate.offset! < 1) {
      throw new InvalidAuthoringCursorError();
    }
    return candidate.offset!;
  }

  function page<T>(items: T[], input: AuthoringListInput, kind: CursorPayload["kind"], scope: string): AuthoringPage<T> {
    const parsed = authoringListInputSchema.parse(input);
    const normalizedQuery = parsed.query.toLowerCase();
    const start = offset(parsed, kind, scope);
    const selected = items.slice(start, start + parsed.limit);
    const nextOffset = start + selected.length;
    return {
      items: selected,
      nextCursor: nextOffset < items.length
        ? encodeCursor({ version: 1, kind, scope, query: normalizedQuery, offset: nextOffset })
        : null,
    };
  }

  function searchable(value: string, query: string): boolean {
    return value.toLowerCase().includes(query.toLowerCase());
  }

  function accessibleTools(projectId: string, connectionId: string): CatalogTool[] {
    const policy = options.policies.get(projectId, connectionId);
    if (policy.mode === "DISABLED") throw new AuthoringCatalogAccessDeniedError();
    return options.tools.list(projectId, connectionId)
      .filter((tool) => tool.status !== "removed" && authoringPolicyAllowsTool(policy, tool.name));
  }

  return {
    listProjects(input) {
      const parsed = authoringListInputSchema.parse(input);
      const items = options.projects.list()
        .filter((project) => searchable(`${project.name}\n${project.id}`, parsed.query))
        .map((project) => ({ id: project.id, name: truncate(project.name, 120)!, updatedAt: project.updatedAt }));
      return page(items, parsed, "projects", "installation");
    },
    listConnections(projectId, input) {
      const parsed = authoringListInputSchema.parse(input);
      const items = options.connections.list(projectId).flatMap((connection): AuthoringConnectionSummary[] => {
        const policy = options.policies.get(projectId, connection.id);
        if (policy.mode === "DISABLED" || !searchable(`${connection.name}\n${connection.id}`, parsed.query)) return [];
        const catalog = options.tools.list(projectId, connection.id);
        return [{
          id: connection.id,
          projectId,
          name: truncate(connection.name, 120)!,
          status: connection.status,
          authorizationStatus: connection.authorizationStatus ?? "not-required",
          protocolVersion: truncate(connection.lastProtocolVersion ?? undefined, 100),
          policy: {
            mode: policy.mode,
            revision: policy.revision,
            requireCleanupForDraftMutations: policy.requireCleanupForDraftMutations,
            maxCallsPerMinute: policy.maxCallsPerMinute,
            maxConcurrentCalls: policy.maxConcurrentCalls,
            maxCallDurationMs: policy.maxCallDurationMs,
          },
          toolSnapshot: {
            total: catalog.filter((tool) => tool.status !== "removed" && authoringPolicyAllowsTool(policy, tool.name)).length,
            stale: catalog.filter((tool) => tool.status === "changed" && authoringPolicyAllowsTool(policy, tool.name)).length,
          },
        }];
      });
      return page(items, parsed, "connections", projectId);
    },
    listTools(projectId, connectionId, input) {
      const parsed = authoringListInputSchema.parse(input);
      const items = accessibleTools(projectId, connectionId)
        .filter((tool) => searchable(`${tool.name}\n${tool.currentSnapshot.definition.title ?? ""}\n${tool.currentSnapshot.definition.description ?? ""}`, parsed.query))
        .map(toolSummary);
      return page(items, parsed, "tools", `${projectId}:${connectionId}`);
    },
    describeTool(projectId, connectionId, toolName) {
      const permitted = accessibleTools(projectId, connectionId).find((tool) => tool.name === toolName);
      if (permitted === undefined) throw new AuthoringCatalogAccessDeniedError();
      const definition = options.tools.get(projectId, connectionId, toolName).tool.currentSnapshot.definition;
      return {
        ...toolSummary(permitted),
        description: truncate(definition.description, 4000),
        inputSchema: definition.inputSchema as JsonObject,
        outputSchema: definition.outputSchema as JsonObject | undefined,
        annotations: definition.annotations as JsonObject | undefined,
        execution: definition.execution as JsonObject | undefined,
        extensions: extensions(definition),
      };
    },
  };
}
