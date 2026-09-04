import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  pressureTestDefinitionSchema,
  pressureTestMutationSchema,
  updatePressureTestRequestSchema,
  type PressureTestDefinition,
  type PressureTestMutation,
  type PressureTestPage,
  type UpdatePressureTestRequest,
} from "../../shared/testing/pressure-test.js";
import { ProjectNotFoundError, type ProjectService } from "../projects/project-service.js";
import { PressureTestRepository, type PressureTestCursor } from "./pressure-test-repository.js";

const uuid = z.uuid();
const listOptionsSchema = z.object({
  limit: z.number().int().min(1).max(100).default(50),
  cursor: z.string().min(1).optional(),
}).strict();

export class InvalidPressureTestError extends Error {
  constructor(message = "Pressure test definition is invalid") { super(message); this.name = "InvalidPressureTestError"; }
}
export class PressureTestNotFoundError extends Error {
  constructor() { super("Pressure test not found"); this.name = "PressureTestNotFoundError"; }
}
export class PressureTestRevisionConflictError extends Error {
  constructor() { super("Pressure test revision conflict"); this.name = "PressureTestRevisionConflictError"; }
}
export class PressureTestTargetNotFoundError extends Error {
  constructor() { super("Pressure test target is not available in this project"); this.name = "PressureTestTargetNotFoundError"; }
}

export interface PressureTestService {
  create(projectId: string, definition: unknown): PressureTestDefinition;
  list(projectId: string, options?: { limit?: number; cursor?: string }): PressureTestPage;
  get(projectId: string, pressureTestId: string): PressureTestDefinition;
  update(projectId: string, pressureTestId: string, request: unknown): PressureTestDefinition;
  remove(projectId: string, pressureTestId: string): void;
}

function validProjectId(value: string): string {
  const parsed = uuid.safeParse(value);
  if (!parsed.success) throw new ProjectNotFoundError();
  return parsed.data;
}

function validPressureTestId(value: string): string {
  const parsed = uuid.safeParse(value);
  if (!parsed.success) throw new PressureTestNotFoundError();
  return parsed.data;
}

function mutationOf(value: unknown): PressureTestMutation {
  const parsed = pressureTestMutationSchema.safeParse(value);
  if (!parsed.success) throw new InvalidPressureTestError(parsed.error.issues[0]?.message);
  return parsed.data;
}

function updateOf(value: unknown): UpdatePressureTestRequest {
  const parsed = updatePressureTestRequestSchema.safeParse(value);
  if (!parsed.success) throw new InvalidPressureTestError(parsed.error.issues[0]?.message);
  return parsed.data;
}

function encodeCursor(cursor: PressureTestCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function decodeCursor(value: string | undefined): PressureTestCursor | undefined {
  if (value === undefined) return undefined;
  try {
    const decoded: unknown = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    return z.object({ updatedAt: z.string().datetime({ offset: true }), id: uuid }).strict().parse(decoded);
  } catch { throw new InvalidPressureTestError("Pressure test cursor is invalid"); }
}

export function createPressureTestService(projects: ProjectService, options: {
  createId?: () => string;
  now?: () => Date;
} = {}): PressureTestService {
  const createId = options.createId ?? randomUUID;
  const now = options.now ?? (() => new Date());
  const repository = (projectId: string) => new PressureTestRepository(projects.open(projectId));

  function generatedId(): string {
    const value = createId();
    if (!uuid.safeParse(value).success) throw new Error("Pressure test ID generator returned an invalid UUID");
    return value;
  }

  function ensureTarget(repo: PressureTestRepository, projectId: string, definition: PressureTestMutation): void {
    if (!repo.hasActiveTestCase(projectId, definition.target.testCaseId)) throw new PressureTestTargetNotFoundError();
  }

  return {
    create(rawProjectId, value) {
      const projectId = validProjectId(rawProjectId);
      const mutation = mutationOf(value);
      const repo = repository(projectId);
      ensureTarget(repo, projectId, mutation);
      const timestamp = now().toISOString();
      return repo.insert(pressureTestDefinitionSchema.parse({
        ...mutation, id: generatedId(), projectId, revision: 1, createdAt: timestamp, updatedAt: timestamp,
      }));
    },

    list(rawProjectId, rawOptions = {}) {
      const projectId = validProjectId(rawProjectId);
      const parsed = listOptionsSchema.safeParse(rawOptions);
      if (!parsed.success) throw new InvalidPressureTestError(parsed.error.issues[0]?.message);
      const cursor = decodeCursor(parsed.data.cursor);
      const page = repository(projectId).list(projectId, parsed.data.limit, cursor);
      const last = page.items.at(-1);
      return {
        items: page.items,
        nextCursor: page.hasMore && last !== undefined
          ? encodeCursor({ updatedAt: last.updatedAt, id: last.id }) : null,
      };
    },

    get(rawProjectId, rawPressureTestId) {
      const projectId = validProjectId(rawProjectId);
      const definition = repository(projectId).get(projectId, validPressureTestId(rawPressureTestId));
      if (definition === null) throw new PressureTestNotFoundError();
      return definition;
    },

    update(rawProjectId, rawPressureTestId, value) {
      const projectId = validProjectId(rawProjectId);
      const pressureTestId = validPressureTestId(rawPressureTestId);
      const request = updateOf(value);
      const repo = repository(projectId);
      const existing = repo.get(projectId, pressureTestId);
      if (existing === null) throw new PressureTestNotFoundError();
      ensureTarget(repo, projectId, request.definition);
      const definition = pressureTestDefinitionSchema.parse({
        ...request.definition,
        id: existing.id,
        projectId,
        revision: existing.revision + 1,
        createdAt: existing.createdAt,
        updatedAt: now().toISOString(),
      });
      const result = repo.update(definition, request.revision);
      if (result === "missing") throw new PressureTestNotFoundError();
      if (result === "conflict") throw new PressureTestRevisionConflictError();
      return definition;
    },

    remove(rawProjectId, rawPressureTestId) {
      const projectId = validProjectId(rawProjectId);
      if (!repository(projectId).remove(projectId, validPressureTestId(rawPressureTestId), now().toISOString())) {
        throw new PressureTestNotFoundError();
      }
    },
  };
}
