import { randomUUID } from "node:crypto";
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
  const registry = new ProjectRegistry(options.dataRoot);
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
      const databasePath = resolveProjectDatabasePath(options.dataRoot, id);
      registry.create(project, databasePath);
      try {
        stores.set(id, new ProjectStore({
          databasePath,
          project,
          migrationsUrl: options.migrationsUrl,
        }));
      } catch (error) {
        registry.remove(id);
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
