import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  InvalidProjectStorageError,
  type ProjectService,
} from "../projects/project-service.js";
import { ConnectionRepository } from "./connection-repository.js";
import type { ConnectionRecord, CreateConnectionInput } from "./connection-types.js";

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
  delete(projectId: string, connectionId: string): void;
}

export function createConnectionService(projects: ProjectService, options: {
  createId?: () => string;
  now?: () => Date;
} = {}): ConnectionService {
  const createId = options.createId ?? randomUUID;
  const now = options.now ?? (() => new Date());

  function repository(projectId: string): ConnectionRepository {
    const store = projects.open(projectId);
    if (store.getProject().id !== projectId) {
      throw new InvalidProjectStorageError();
    }
    return new ConnectionRepository(store);
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
      return repository(projectId).list(projectId);
    },

    delete(projectId, connectionId) {
      if (!connectionIdSchema.safeParse(connectionId).success) {
        throw new ConnectionNotFoundError();
      }
      if (!repository(projectId).delete(projectId, connectionId)) {
        throw new ConnectionNotFoundError();
      }
    },
  };
}
