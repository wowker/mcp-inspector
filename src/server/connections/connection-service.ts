import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  InvalidProjectStorageError,
  type ProjectService,
} from "../projects/project-service.js";
import { ConnectionRepository } from "./connection-repository.js";
import type { ConnectionRecord, CreateConnectionInput, UpdateConnectionInput } from "./connection-types.js";
import {
  createConnectionRuntime,
  OAuthAuthorizationCompletedError,
  type ConnectionRuntime,
  type McpSessionFactory,
} from "./connection-runtime.js";
import { createStreamableMcpSessionFactory } from "./streamable-session.js";
import { OAuthFlowCoordinator } from "./oauth-flow.js";
import { normalizeCustomHeaders } from "../../shared/custom-headers.js";
import { createServerExport, type ServerExportBundle } from "./connection-export.js";

const connectionIdSchema = z.string().uuid();
const createConnectionSchema = z.object({
  name: z.string().trim().min(1).max(120),
  url: z.string().trim().min(1).max(8192),
  transport: z.literal("streamable-http"),
  authMode: z.enum(["none", "oauth"]),
  headers: z.record(z.string(), z.string()).optional().default({}),
  redactSensitiveInfo: z.boolean().optional().default(true),
  timeoutMs: z.number().int().min(100).max(600_000),
}).strict();
const updateConnectionSchema = createConnectionSchema
  .pick({ name: true, url: true, authMode: true, headers: true, redactSensitiveInfo: true, timeoutMs: true })
  .partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0);

export class InvalidConnectionError extends Error {
  constructor(message = "Connection configuration is invalid") {
    super(message);
    this.name = "InvalidConnectionError";
  }
}

export class ConnectionNotFoundError extends Error {
  constructor() {
    super("Connection not found");
    this.name = "ConnectionNotFoundError";
  }
}

function normalizeUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new InvalidConnectionError("Connection URL must be an absolute http or https URL");
  }
  if ((url.protocol !== "http:" && url.protocol !== "https:") || url.hostname.length === 0) {
    throw new InvalidConnectionError("Connection URL must be an absolute http or https URL");
  }
  if (url.username.length > 0 || url.password.length > 0) {
    throw new InvalidConnectionError("Connection URL must not contain credentials");
  }
  return url.toString();
}

export interface ConnectionService {
  create(projectId: string, input: CreateConnectionInput): ConnectionRecord;
  update(projectId: string, connectionId: string, input: UpdateConnectionInput): Promise<ConnectionRecord>;
  get(projectId: string, connectionId: string): ConnectionRecord;
  list(projectId: string): ConnectionRecord[];
  delete(projectId: string, connectionId: string): Promise<void>;
  connect(projectId: string, connectionId: string): Promise<ConnectionRecord>;
  disconnect(projectId: string, connectionId: string): Promise<ConnectionRecord>;
  exportData(projectId: string, connectionId: string): ServerExportBundle;
  runtime(projectId: string): ConnectionRuntime;
  close(): Promise<void>;
  completeOAuth?(params: URLSearchParams): Promise<string>;
}

export function createConnectionService(projects: ProjectService, options: {
  createId?: () => string;
  now?: () => Date;
  sessionFactory?: McpSessionFactory;
  oauthRedirectUrl?: () => string;
  openAuthorizationUrl?: (url: string) => void | Promise<void>;
} = {}): ConnectionService {
  const createId = options.createId ?? randomUUID;
  const now = options.now ?? (() => new Date());
  const oauth = new OAuthFlowCoordinator({
    redirectUrl: options.oauthRedirectUrl ?? (() => "http://127.0.0.1:3000/oauth/callback"),
    openAuthorizationUrl: options.openAuthorizationUrl ?? (() => { throw new Error("OAuth browser opener is unavailable"); }),
  });
  const sessionFactory = options.sessionFactory ?? createStreamableMcpSessionFactory({ oauth });
  const runtimes = new Map<string, ConnectionRuntime>();

  function projectStore(projectId: string) {
    const store = projects.open(projectId);
    if (store.getProject().id !== projectId) {
      throw new InvalidProjectStorageError();
    }
    return store;
  }

  function repository(projectId: string): ConnectionRepository {
    return new ConnectionRepository(projectStore(projectId));
  }

  function find(projectId: string, connectionId: string): ConnectionRecord {
    if (!connectionIdSchema.safeParse(connectionId).success) throw new ConnectionNotFoundError();
    const connection = repository(projectId).get(projectId, connectionId);
    if (connection === null) throw new ConnectionNotFoundError();
    return connection;
  }

  function present(connection: ConnectionRecord, status: ConnectionRecord["status"]): ConnectionRecord {
    return {
      ...connection,
      status,
      authorizationStatus: connection.authMode === "oauth"
        ? oauth.authorizationStatus(connection.id)
        : "not-required",
    };
  }

  function runtime(projectId: string): ConnectionRuntime {
    repository(projectId);
    let existing = runtimes.get(projectId);
    if (existing !== undefined) return existing;
    existing = createConnectionRuntime({
      resolveConnection: (connectionId) => find(projectId, connectionId),
      factory: sessionFactory,
      persistSuccess: (connectionId, metadata) => repository(projectId).recordSuccess(
        projectId,
        connectionId,
        metadata.protocolVersion,
        metadata.serverInfo,
      ),
      persistFailure: (connectionId, error) => repository(projectId).recordFailure(
        projectId,
        connectionId,
        error,
      ),
    });
    runtimes.set(projectId, existing);
    return existing;
  }

  return {
    create(projectId, input) {
      const parsed = createConnectionSchema.safeParse(input);
      if (!parsed.success) throw new InvalidConnectionError();
      const id = createId();
      if (!connectionIdSchema.safeParse(id).success) {
        throw new Error("Connection ID generator returned an invalid UUID");
      }
      const timestamp = now().toISOString();
      const headers = normalizeCustomHeaders(parsed.data.headers, parsed.data.authMode);
      if (headers === null) throw new InvalidConnectionError();
      return present(repository(projectId).create({
        ...parsed.data,
        headers,
        url: normalizeUrl(parsed.data.url),
        id,
        projectId,
        createdAt: timestamp,
        updatedAt: timestamp,
      }), "disconnected");
    },

    list(projectId) {
      const projectRuntime = runtimes.get(projectId);
      return repository(projectId).list(projectId).map((connection) =>
        present(connection, projectRuntime?.status(connection.id) ?? "disconnected"));
    },

    get(projectId, connectionId) {
      const connection = find(projectId, connectionId);
      const projectRuntime = runtimes.get(projectId);
      return present(connection, projectRuntime?.status(connectionId) ?? "disconnected");
    },

    async update(projectId, connectionId, input) {
      const existing = find(projectId, connectionId);
      const parsed = updateConnectionSchema.safeParse(input);
      if (!parsed.success) throw new InvalidConnectionError();
      const next = createConnectionSchema.safeParse({
        name: parsed.data.name ?? existing.name,
        url: parsed.data.url ?? existing.url,
        timeoutMs: parsed.data.timeoutMs ?? existing.timeoutMs,
        transport: existing.transport,
        authMode: parsed.data.authMode ?? existing.authMode,
        headers: parsed.data.headers ?? existing.headers,
        redactSensitiveInfo: parsed.data.redactSensitiveInfo ?? existing.redactSensitiveInfo,
      });
      if (!next.success) throw new InvalidConnectionError();
      const headers = normalizeCustomHeaders(next.data.headers, next.data.authMode);
      if (headers === null) throw new InvalidConnectionError();
      const normalizedUrl = normalizeUrl(next.data.url);
      await runtime(projectId).disconnect(connectionId);
      if (normalizedUrl !== existing.url || next.data.authMode !== existing.authMode) {
        oauth.clear(connectionId);
      }
      const updated = repository(projectId).update({
        id: connectionId,
        projectId,
        name: next.data.name,
        url: normalizedUrl,
        timeoutMs: next.data.timeoutMs,
        authMode: next.data.authMode,
        headers,
        redactSensitiveInfo: next.data.redactSensitiveInfo,
        updatedAt: now().toISOString(),
        resetDiagnostics: normalizedUrl !== existing.url || next.data.timeoutMs !== existing.timeoutMs ||
          next.data.authMode !== existing.authMode || JSON.stringify(headers) !== JSON.stringify(existing.headers),
      });
      if (updated === null) throw new ConnectionNotFoundError();
      return present(updated, "disconnected");
    },

    async delete(projectId, connectionId) {
      find(projectId, connectionId);
      await runtime(projectId).disconnect(connectionId);
      if (!repository(projectId).delete(projectId, connectionId)) {
        throw new ConnectionNotFoundError();
      }
      oauth.clear(connectionId);
    },

    async connect(projectId, connectionId) {
      try {
        await runtime(projectId).connect(connectionId);
        return present(find(projectId, connectionId), "connected");
      } catch (error) {
        if (error instanceof OAuthAuthorizationCompletedError) {
          return present(find(projectId, connectionId), "disconnected");
        }
        throw error;
      }
    },

    async disconnect(projectId, connectionId) {
      find(projectId, connectionId);
      await runtime(projectId).disconnect(connectionId);
      return present(find(projectId, connectionId), "disconnected");
    },

    exportData(projectId, connectionId) {
      const connection = find(projectId, connectionId);
      return createServerExport(projectStore(projectId), connection, now().toISOString());
    },

    runtime,

    completeOAuth(params) {
      return oauth.complete(params);
    },

    async close() {
      const results = await Promise.allSettled([...runtimes.values()].map((projectRuntime) =>
        projectRuntime.close()));
      runtimes.clear();
      const failed = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
      if (failed !== undefined) throw failed.reason;
    },
  };
}
