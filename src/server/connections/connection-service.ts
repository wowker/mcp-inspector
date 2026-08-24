import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  InvalidProjectStorageError,
  type ProjectService,
} from "../projects/project-service.js";
import { ConnectionRepository } from "./connection-repository.js";
import type { ConnectionRecord, CreateConnectionInput } from "./connection-types.js";
import {
  createConnectionRuntime,
  type ConnectionRuntime,
  type McpSessionFactory,
} from "./connection-runtime.js";
import { createStreamableMcpSessionFactory } from "./streamable-session.js";

const connectionIdSchema = z.string().uuid();
const createConnectionSchema = z.object({
  name: z.string().trim().min(1).max(120),
  url: z.string().trim().min(1).max(8192),
  transport: z.literal("streamable-http"),
  authMode: z.literal("none"),
  timeoutMs: z.number().int().min(100).max(600_000),
}).strict();

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
  list(projectId: string): ConnectionRecord[];
  delete(projectId: string, connectionId: string): Promise<void>;
  connect(projectId: string, connectionId: string): Promise<ConnectionRecord>;
  disconnect(projectId: string, connectionId: string): Promise<ConnectionRecord>;
  runtime(projectId: string): ConnectionRuntime;
}

export function createConnectionService(projects: ProjectService, options: {
  createId?: () => string;
  now?: () => Date;
  sessionFactory?: McpSessionFactory;
} = {}): ConnectionService {
  const createId = options.createId ?? randomUUID;
  const now = options.now ?? (() => new Date());
  const sessionFactory = options.sessionFactory ?? createStreamableMcpSessionFactory();
  const runtimes = new Map<string, ConnectionRuntime>();

  function repository(projectId: string): ConnectionRepository {
    const store = projects.open(projectId);
    if (store.getProject().id !== projectId) {
      throw new InvalidProjectStorageError();
    }
    return new ConnectionRepository(store);
  }

  function find(projectId: string, connectionId: string): ConnectionRecord {
    if (!connectionIdSchema.safeParse(connectionId).success) throw new ConnectionNotFoundError();
    const connection = repository(projectId).get(projectId, connectionId);
    if (connection === null) throw new ConnectionNotFoundError();
    return connection;
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
      return repository(projectId).create({
        ...parsed.data,
        url: normalizeUrl(parsed.data.url),
        id,
        projectId,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
    },

    list(projectId) {
      const projectRuntime = runtimes.get(projectId);
      return repository(projectId).list(projectId).map((connection) => ({
        ...connection,
        status: projectRuntime?.status(connection.id) ?? "disconnected",
      }));
    },

    async delete(projectId, connectionId) {
      find(projectId, connectionId);
      await runtime(projectId).disconnect(connectionId);
      if (!repository(projectId).delete(projectId, connectionId)) {
        throw new ConnectionNotFoundError();
      }
    },

    async connect(projectId, connectionId) {
      await runtime(projectId).connect(connectionId);
      return { ...find(projectId, connectionId), status: "connected" };
    },

    async disconnect(projectId, connectionId) {
      find(projectId, connectionId);
      await runtime(projectId).disconnect(connectionId);
      return { ...find(projectId, connectionId), status: "disconnected" };
    },

    runtime,
  };
}
