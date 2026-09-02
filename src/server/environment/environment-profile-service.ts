import { randomUUID } from "node:crypto";
import {
  ENVIRONMENT_PROFILE_MAX_DEPTH,
  environmentProfileMutationSchema,
  type EnvironmentProfilePreview,
  environmentProfileUpdateSchema,
  environmentProfileVariableMutationSchema,
  type EnvironmentProfile,
  type EnvironmentProfileVariable,
} from "../../shared/environment-profile.js";
import type { JsonValue } from "../../shared/tool-definition.js";
import type { ConnectionService } from "../connections/connection-service.js";
import { ConnectionNotFoundError } from "../connections/connection-service.js";
import type { ConnectionRecord } from "../connections/connection-types.js";
import type { ProjectService } from "../projects/project-service.js";
import {
  EnvironmentProfileRepository,
  type StoredProfileVariable,
} from "./environment-profile-repository.js";
import type { EnvironmentService } from "./environment-service.js";

const NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_.-]{0,127}$/;
const VALUE_MAX_BYTES = 1_048_576;

export class InvalidEnvironmentProfileError extends Error {
  constructor(message = "Environment profile is invalid") {
    super(message); this.name = "InvalidEnvironmentProfileError";
  }
}

export class EnvironmentProfileNotFoundError extends Error {
  constructor() { super("Environment profile not found"); this.name = "EnvironmentProfileNotFoundError"; }
}

export class EnvironmentProfileRevisionConflictError extends Error {
  constructor() { super("Environment profile revision conflict"); this.name = "EnvironmentProfileRevisionConflictError"; }
}

export class EnvironmentProfileInUseError extends Error {
  constructor() { super("Environment profile is in use"); this.name = "EnvironmentProfileInUseError"; }
}

export class EnvironmentProfileConnectionActiveError extends Error {
  constructor() {
    super("Disconnect the connection before changing its environment profile");
    this.name = "EnvironmentProfileConnectionActiveError";
  }
}

interface VariableSource {
  kind: "base" | "profile";
  profileId: string | null;
  secret: boolean;
}

export interface ResolvedEnvironmentProfile {
  project: Record<string, JsonValue>;
  server: Record<string, JsonValue>;
  secretNames: string[];
  chain: string[];
  projectSources: Record<string, VariableSource>;
  serverSources: Record<string, VariableSource>;
}

export interface EnvironmentProfileService {
  list(projectId: string): EnvironmentProfile[];
  get(projectId: string, profileId: string): EnvironmentProfile;
  create(projectId: string, input: unknown): EnvironmentProfile;
  update(projectId: string, profileId: string, input: unknown): EnvironmentProfile;
  delete(projectId: string, profileId: string): void;
  listVariables(projectId: string, profileId: string, connectionId: string | null): EnvironmentProfileVariable[];
  setVariable(projectId: string, profileId: string, connectionId: string | null, name: unknown, input: unknown): EnvironmentProfileVariable;
  deleteVariable(projectId: string, profileId: string, connectionId: string | null, name: unknown): void;
  resolve(projectId: string, connectionId: string, profileId: string): ResolvedEnvironmentProfile;
  getActiveProfileId(projectId: string, connectionId: string): string | null;
  setActiveProfileId(projectId: string, connectionId: string, profileId: string | null): void;
  resolveActive(projectId: string, connectionId: string): {
    project: Record<string, JsonValue>;
    server: Record<string, JsonValue>;
    secretNames: string[];
  };
  preview(projectId: string, connectionId: string, profileId: string | null): EnvironmentProfilePreview;
}

export function createProfileAwareEnvironmentService(
  base: EnvironmentService,
  profiles: Pick<EnvironmentProfileService, "resolveActive">,
): EnvironmentService {
  return {
    ...base,
    resolve(projectId, connectionId) {
      return profiles.resolveActive(projectId, connectionId);
    },
  };
}

export function createEnvironmentProfileService(
  projects: ProjectService,
  connections: Pick<ConnectionService, "list">,
  environment: Pick<EnvironmentService, "resolveDetailed">,
  options: { createId?: () => string; now?: () => Date } = {},
): EnvironmentProfileService {
  const createId = options.createId ?? randomUUID;
  const now = options.now ?? (() => new Date());

  function repository(projectId: string): EnvironmentProfileRepository {
    return new EnvironmentProfileRepository(projects.open(projectId));
  }

  function connection(projectId: string, connectionId: string | null): ConnectionRecord | null {
    if (connectionId === null) return null;
    const result = connections.list(projectId).find(({ id }) => id === connectionId);
    if (result === undefined) throw new ConnectionNotFoundError();
    return result;
  }

  function profile(repo: EnvironmentProfileRepository, projectId: string, profileId: string): EnvironmentProfile {
    const result = repo.get(projectId, profileId);
    if (result === undefined) throw new EnvironmentProfileNotFoundError();
    return result;
  }

  function chainFor(
    repo: EnvironmentProfileRepository,
    projectId: string,
    profileId: string,
    rejectedId?: string,
  ): EnvironmentProfile[] {
    const reversed: EnvironmentProfile[] = [];
    const visited = new Set<string>();
    let currentId: string | null = profileId;
    while (currentId !== null) {
      if (currentId === rejectedId || visited.has(currentId)) {
        throw new InvalidEnvironmentProfileError("Environment profile inheritance cycle");
      }
      if (reversed.length >= ENVIRONMENT_PROFILE_MAX_DEPTH) {
        throw new InvalidEnvironmentProfileError("Environment profile inheritance is too deep");
      }
      visited.add(currentId);
      const current = profile(repo, projectId, currentId);
      reversed.push(current);
      currentId = current.parentProfileId;
    }
    return reversed.reverse();
  }

  function publicVariable(variable: StoredProfileVariable): EnvironmentProfileVariable {
    const { storedValue: _storedValue, ...visible } = variable;
    return visible;
  }

  function variableName(value: unknown): string {
    if (typeof value !== "string" || !NAME_PATTERN.test(value)) {
      throw new InvalidEnvironmentProfileError();
    }
    return value;
  }

  function variableInput(value: unknown) {
    const parsed = environmentProfileVariableMutationSchema.safeParse(value);
    if (!parsed.success) throw new InvalidEnvironmentProfileError();
    if (parsed.data.mode === "value" &&
        Buffer.byteLength(JSON.stringify(parsed.data.value), "utf8") > VALUE_MAX_BYTES) {
      throw new InvalidEnvironmentProfileError();
    }
    return parsed.data;
  }

  function assertParent(
    repo: EnvironmentProfileRepository,
    projectId: string,
    parentProfileId: string | null,
    rejectedId?: string,
  ): void {
    if (parentProfileId !== null) chainFor(repo, projectId, parentProfileId, rejectedId);
  }

  function applyVariables(
    values: Record<string, JsonValue>,
    sources: Record<string, VariableSource>,
    variables: StoredProfileVariable[],
    profileId: string,
  ): void {
    for (const variable of variables) {
      if (variable.mode === "unset") {
        delete values[variable.name];
        delete sources[variable.name];
      } else {
        values[variable.name] = variable.storedValue!;
        sources[variable.name] = {
          kind: "profile", profileId, secret: variable.secret,
        };
      }
    }
  }

  return {
    list(projectId) {
      return repository(projectId).list(projectId);
    },

    get(projectId, profileId) {
      return profile(repository(projectId), projectId, profileId);
    },

    create(projectId, input) {
      const parsed = environmentProfileMutationSchema.safeParse(input);
      if (!parsed.success) throw new InvalidEnvironmentProfileError();
      const repo = repository(projectId);
      assertParent(repo, projectId, parsed.data.parentProfileId);
      try {
        return repo.create(projectId, createId(), parsed.data, now().toISOString());
      } catch (error) {
        if (error instanceof Error && /unique/i.test(error.message)) {
          throw new InvalidEnvironmentProfileError("Environment profile name already exists");
        }
        throw error;
      }
    },

    update(projectId, profileId, input) {
      const parsed = environmentProfileUpdateSchema.safeParse(input);
      if (!parsed.success) throw new InvalidEnvironmentProfileError();
      const repo = repository(projectId);
      profile(repo, projectId, profileId);
      assertParent(repo, projectId, parsed.data.parentProfileId, profileId);
      const { revision, ...mutation } = parsed.data;
      try {
        const updated = repo.update(
          projectId, profileId, revision, mutation, now().toISOString(),
        );
        if (updated === undefined) throw new EnvironmentProfileRevisionConflictError();
        return updated;
      } catch (error) {
        if (error instanceof EnvironmentProfileRevisionConflictError) throw error;
        if (error instanceof Error && /unique/i.test(error.message)) {
          throw new InvalidEnvironmentProfileError("Environment profile name already exists");
        }
        throw error;
      }
    },

    delete(projectId, profileId) {
      const repo = repository(projectId);
      profile(repo, projectId, profileId);
      if (repo.list(projectId).some(({ parentProfileId }) => parentProfileId === profileId)) {
        throw new EnvironmentProfileInUseError();
      }
      if (repo.isProfileActive(projectId, profileId)) throw new EnvironmentProfileInUseError();
      if (!repo.delete(projectId, profileId)) throw new EnvironmentProfileNotFoundError();
    },

    listVariables(projectId, profileId, connectionId) {
      connection(projectId, connectionId);
      const repo = repository(projectId);
      profile(repo, projectId, profileId);
      return repo.listVariables(projectId, profileId, connectionId).map(publicVariable);
    },

    setVariable(projectId, profileId, connectionId, name, input) {
      connection(projectId, connectionId);
      const repo = repository(projectId);
      profile(repo, projectId, profileId);
      return publicVariable(repo.setVariable(
        projectId, profileId, connectionId, variableName(name), createId(),
        variableInput(input), now().toISOString(),
      ));
    },

    deleteVariable(projectId, profileId, connectionId, name) {
      connection(projectId, connectionId);
      const repo = repository(projectId);
      profile(repo, projectId, profileId);
      if (!repo.deleteVariable(projectId, profileId, connectionId, variableName(name))) {
        throw new EnvironmentProfileNotFoundError();
      }
    },

    resolve(projectId, connectionId, profileId) {
      connection(projectId, connectionId);
      const repo = repository(projectId);
      const chain = chainFor(repo, projectId, profileId);
      const base = environment.resolveDetailed(projectId, connectionId);
      const project = { ...base.project };
      const server = { ...base.server };
      const projectSecrets = new Set(base.projectSecretNames);
      const serverSecrets = new Set(base.serverSecretNames);
      const projectSources = Object.fromEntries(Object.keys(project).map((name) => [
        name, { kind: "base" as const, profileId: null, secret: projectSecrets.has(name) },
      ]));
      const serverSources = Object.fromEntries(Object.keys(server).map((name) => [
        name, { kind: "base" as const, profileId: null, secret: serverSecrets.has(name) },
      ]));
      for (const current of chain) {
        applyVariables(
          project, projectSources,
          repo.listVariables(projectId, current.id, null), current.id,
        );
        applyVariables(
          server, serverSources,
          repo.listVariables(projectId, current.id, connectionId), current.id,
        );
      }
      const names = new Set([...Object.keys(project), ...Object.keys(server)]);
      const secretNames = [...names].filter((name) =>
        serverSources[name]?.secret ?? projectSources[name]?.secret ?? false).sort();
      return {
        project, server, secretNames,
        chain: chain.map(({ id }) => id),
        projectSources, serverSources,
      };
    },

    getActiveProfileId(projectId, connectionId) {
      connection(projectId, connectionId);
      return repository(projectId).getActiveProfileId(projectId, connectionId);
    },

    setActiveProfileId(projectId, connectionId, profileId) {
      const target = connection(projectId, connectionId)!;
      if (target.status === "connected" || target.status === "connecting") {
        throw new EnvironmentProfileConnectionActiveError();
      }
      const repo = repository(projectId);
      if (profileId !== null) profile(repo, projectId, profileId);
      repo.setActiveProfileId(projectId, connectionId, profileId, now().toISOString());
    },

    resolveActive(projectId, connectionId) {
      const activeProfileId = this.getActiveProfileId(projectId, connectionId);
      if (activeProfileId === null) {
        const base = environment.resolveDetailed(projectId, connectionId);
        const serverNames = new Set(Object.keys(base.server));
        const projectSecrets = new Set(base.projectSecretNames);
        const serverSecrets = new Set(base.serverSecretNames);
        return {
          project: base.project,
          server: base.server,
          secretNames: [...new Set([
            ...Object.keys(base.project),
            ...Object.keys(base.server),
          ])].filter((name) => serverNames.has(name)
            ? serverSecrets.has(name)
            : projectSecrets.has(name)).sort(),
        };
      }
      const resolved = this.resolve(projectId, connectionId, activeProfileId);
      return {
        project: resolved.project,
        server: resolved.server,
        secretNames: resolved.secretNames,
      };
    },

    preview(projectId, connectionId, profileId) {
      const target = connection(projectId, connectionId)!;
      const detailed = profileId === null
        ? (() => {
          const base = environment.resolveDetailed(projectId, connectionId);
          return {
            project: base.project,
            server: base.server,
            projectSources: Object.fromEntries(Object.keys(base.project).map((name) => [name, {
              kind: "base" as const, profileId: null, secret: base.projectSecretNames.includes(name),
            }])),
            serverSources: Object.fromEntries(Object.keys(base.server).map((name) => [name, {
              kind: "base" as const, profileId: null, secret: base.serverSecretNames.includes(name),
            }])),
            chain: [] as string[],
          };
        })()
        : this.resolve(projectId, connectionId, profileId);
      const chain = detailed.chain.map((id) => profile(repository(projectId), projectId, id));
      const variables = ([
        ...Object.entries(detailed.project).map(([name, value]) => ({
          name, value, scope: "project" as const, source: detailed.projectSources[name]!,
        })),
        ...Object.entries(detailed.server).map(([name, value]) => ({
          name, value, scope: "server" as const, source: detailed.serverSources[name]!,
        })),
      ]).map(({ name, value, scope, source }) => ({
        name,
        scope,
        secret: source.secret,
        source: source.kind,
        sourceProfileId: source.profileId,
        ...(source.secret ? {} : { value }),
      })).sort((left, right) => left.scope.localeCompare(right.scope) || left.name.localeCompare(right.name));
      const effectiveNames = new Set([
        ...Object.keys(detailed.project), ...Object.keys(detailed.server),
      ]);
      const referencePattern = /\{\{([A-Za-z_][A-Za-z0-9_.-]{0,127})\}\}/g;
      const templates = [
        ...(target.bearerToken === null ? [] : [["Bearer Token", target.bearerToken] as const]),
        ...Object.entries(target.headers).map(([name, value]) => [`Header: ${name}`, value] as const),
      ];
      const references = templates.map(([location, template]) => {
        const referenced = [...template.matchAll(referencePattern)].map((match) => match[1]!);
        const names = [...new Set(referenced)].sort();
        return { location, variables: names, missing: names.filter((name) => !effectiveNames.has(name)) };
      }).filter(({ variables: names }) => names.length > 0);
      return { profileId, chain, variables, references };
    },
  };
}
