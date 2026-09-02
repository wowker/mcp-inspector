import { randomUUID } from "node:crypto";
import { jsonValueSchema, type JsonValue } from "../../shared/tool-definition.js";
import type { EnvironmentVariable } from "../../shared/script-workflow.js";
import type { ConnectionService } from "../connections/connection-service.js";
import { ConnectionNotFoundError } from "../connections/connection-service.js";
import type { ProjectService } from "../projects/project-service.js";
import { EnvironmentRepository, type EnvironmentMutation } from "./environment-repository.js";

const NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_.-]{0,127}$/;
const VALUE_MAX_BYTES = 1_048_576;

export class InvalidEnvironmentVariableError extends Error {
  constructor() { super("Environment variable is invalid"); this.name = "InvalidEnvironmentVariableError"; }
}

export class EnvironmentVariableNotFoundError extends Error {
  constructor() { super("Environment variable not found"); this.name = "EnvironmentVariableNotFoundError"; }
}

export interface StagedEnvironmentMutation {
  scope: "project" | "server";
  name: string;
  value: JsonValue;
  secret: boolean;
}

export interface EnvironmentService {
  list(projectId: string, connectionId: string | null): EnvironmentVariable[];
  set(projectId: string, connectionId: string | null, name: unknown, input: unknown): EnvironmentVariable;
  delete(projectId: string, connectionId: string | null, name: unknown): void;
  resolve(projectId: string, connectionId: string): {
    project: Record<string, JsonValue>;
    server: Record<string, JsonValue>;
    secretNames: string[];
  };
  resolveDetailed(projectId: string, connectionId: string): {
    project: Record<string, JsonValue>;
    server: Record<string, JsonValue>;
    projectSecretNames: string[];
    serverSecretNames: string[];
  };
  commit(projectId: string, connectionId: string, mutations: StagedEnvironmentMutation[]): void;
}

export function createEnvironmentService(
  projects: ProjectService,
  connections: Pick<ConnectionService, "list">,
  options: { createId?: () => string; now?: () => Date } = {},
): EnvironmentService {
  const createId = options.createId ?? randomUUID;
  const now = options.now ?? (() => new Date());

  function validateConnection(projectId: string, connectionId: string | null): void {
    if (connectionId !== null && !connections.list(projectId).some(({ id }) => id === connectionId)) {
      throw new ConnectionNotFoundError();
    }
  }

  function repository(projectId: string, connectionId: string | null): EnvironmentRepository {
    validateConnection(projectId, connectionId);
    return new EnvironmentRepository(projects.open(projectId));
  }

  function variableName(value: unknown): string {
    if (typeof value !== "string" || !NAME_PATTERN.test(value)) throw new InvalidEnvironmentVariableError();
    return value;
  }

  function variableInput(value: unknown): { value: JsonValue; secret: boolean } {
    if (typeof value !== "object" || value === null || Array.isArray(value) ||
        Object.keys(value).some((key) => key !== "value" && key !== "secret")) {
      throw new InvalidEnvironmentVariableError();
    }
    const candidate = value as { value?: unknown; secret?: unknown };
    const parsed = jsonValueSchema.safeParse(candidate.value);
    if (!parsed.success || typeof candidate.secret !== "boolean" ||
        Buffer.byteLength(JSON.stringify(parsed.data), "utf8") > VALUE_MAX_BYTES) {
      throw new InvalidEnvironmentVariableError();
    }
    return { value: parsed.data, secret: candidate.secret };
  }

  function mutation(
    connectionId: string | null,
    name: unknown,
    input: unknown,
  ): EnvironmentMutation {
    return { id: createId(), connectionId, name: variableName(name), ...variableInput(input) };
  }

  function resolvedVariables(projectId: string, connectionId: string) {
    const repo = repository(projectId, connectionId);
    return {
      projectVariables: repo.list(projectId, null),
      serverVariables: repo.list(projectId, connectionId),
    };
  }

  return {
    list(projectId, connectionId) {
      return repository(projectId, connectionId).list(projectId, connectionId)
        .map(({ storedValue: _storedValue, ...visible }) => visible);
    },

    set(projectId, connectionId, name, input) {
      const repo = repository(projectId, connectionId);
      const { storedValue: _storedValue, ...visible } = repo.set(
        projectId, mutation(connectionId, name, input), now().toISOString(),
      );
      return visible;
    },

    delete(projectId, connectionId, name) {
      const normalized = variableName(name);
      if (!repository(projectId, connectionId).delete(projectId, connectionId, normalized)) {
        throw new EnvironmentVariableNotFoundError();
      }
    },

    resolve(projectId, connectionId) {
      const { projectVariables, serverVariables } = resolvedVariables(projectId, connectionId);
      return {
        project: Object.fromEntries(projectVariables.map((item) => [item.name, item.storedValue])),
        server: Object.fromEntries(serverVariables.map((item) => [item.name, item.storedValue])),
        secretNames: [...projectVariables, ...serverVariables]
          .filter(({ secret }) => secret).map(({ name }) => name).sort(),
      };
    },

    resolveDetailed(projectId, connectionId) {
      const { projectVariables, serverVariables } = resolvedVariables(projectId, connectionId);
      return {
        project: Object.fromEntries(projectVariables.map((item) => [item.name, item.storedValue])),
        server: Object.fromEntries(serverVariables.map((item) => [item.name, item.storedValue])),
        projectSecretNames: projectVariables.filter(({ secret }) => secret)
          .map(({ name }) => name).sort(),
        serverSecretNames: serverVariables.filter(({ secret }) => secret)
          .map(({ name }) => name).sort(),
      };
    },

    commit(projectId, connectionId, staged) {
      validateConnection(projectId, connectionId);
      const mutations = staged.map((item) => mutation(
        item.scope === "server" ? connectionId : null,
        item.name,
        { value: item.value, secret: item.secret },
      ));
      new EnvironmentRepository(projects.open(projectId)).commit(
        projectId, mutations, now().toISOString(),
      );
    },
  };
}
