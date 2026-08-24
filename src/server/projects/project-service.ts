import { randomUUID } from "node:crypto";
import { existsSync, rmSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { z } from "zod";
import { resolveProjectDatabasePath } from "./project-paths.js";
import { ProjectRegistry, type ProjectSummary } from "./project-registry.js";
import { ProjectStore } from "./project-store.js";

export type { ProjectSummary } from "./project-registry.js";

const projectIdSchema = z.string().uuid();
export const projectNameSchema = z.string().trim().min(1).max(120);

export class ProjectNotFoundError extends Error {
  constructor() {
    super("Project not found");
    this.name = "ProjectNotFoundError";
  }
}

export class InvalidProjectStorageError extends Error {
  constructor() {
    super("Project storage metadata is invalid");
    this.name = "InvalidProjectStorageError";
  }
}

export interface ProjectService {
  create(name: string): ProjectSummary;
  list(): ProjectSummary[];
  open(projectId: string): ProjectStore;
  close(): void;
}

export function createProjectService(options: {
  dataRoot: string;
  now?: () => Date;
  createId?: () => string;
  migrationsUrl?: URL;
}): ProjectService {
  const dataRoot = resolve(options.dataRoot);
  const registry = new ProjectRegistry(dataRoot);
  const stores = new Map<string, ProjectStore>();
  const now = options.now ?? (() => new Date());
  const createId = options.createId ?? randomUUID;
  let closed = false;

  function ensureOpen(): void {
    if (closed) throw new Error("Project service is closed");
  }

  function validatedId(projectId: string): string {
    const parsed = projectIdSchema.safeParse(projectId);
    if (!parsed.success) throw new ProjectNotFoundError();
    return parsed.data;
  }

  function canonicalDatabasePath(projectId: string): string {
    return resolveProjectDatabasePath(dataRoot, projectId);
  }

  function removeCanonicalProjectArtifacts(projectId: string): void {
    const projectsRoot = resolve(dataRoot, "projects");
    const projectDirectory = dirname(canonicalDatabasePath(projectId));
    const childPath = relative(projectsRoot, projectDirectory);
    if (childPath !== projectId || childPath.startsWith("..")) {
      throw new Error("Refusing to clean invalid project storage");
    }
    rmSync(projectDirectory, { recursive: true, force: true });
  }

  return {
    create(name) {
      ensureOpen();
      const normalizedName = projectNameSchema.parse(name);
      const timestamp = now().toISOString();
      const id = createId();
      if (!projectIdSchema.safeParse(id).success) {
        throw new Error("Project ID generator returned an invalid UUID");
      }
      const project: ProjectSummary = {
        id,
        name: normalizedName,
        createdAt: timestamp,
        updatedAt: timestamp,
        lastOpenedAt: null,
      };
      const databasePath = canonicalDatabasePath(id);
      if (existsSync(dirname(databasePath))) {
        throw new Error("Project storage already exists");
      }
      registry.create(project, databasePath);
      try {
        stores.set(id, new ProjectStore({
          databasePath,
          project,
          migrationsUrl: options.migrationsUrl,
        }));
      } catch (error) {
        registry.remove(id);
        removeCanonicalProjectArtifacts(id);
        throw error;
      }
      return project;
    },

    list() {
      ensureOpen();
      return registry.list();
    },

    open(projectId) {
      ensureOpen();
      const id = validatedId(projectId);
      const record = registry.get(id);
      if (record === null) throw new ProjectNotFoundError();
      if (record.databasePath !== canonicalDatabasePath(id)) {
        throw new InvalidProjectStorageError();
      }
      let store = stores.get(id);
      if (store === undefined) {
        store = new ProjectStore({
          databasePath: record.databasePath,
          project: record,
          migrationsUrl: options.migrationsUrl,
        });
        stores.set(id, store);
      }
      registry.markOpened(id, now().toISOString());
      return store;
    },

    close() {
      if (closed) return;
      closed = true;
      for (const store of stores.values()) store.close();
      stores.clear();
      registry.close();
    },
  };
}
