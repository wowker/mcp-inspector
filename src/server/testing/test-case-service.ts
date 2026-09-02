import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  testCaseDefinitionSchema,
  testCaseMutationSchema,
  updateTestCaseRequestSchema,
  type TestCaseDefinition,
  type TestCaseMutation,
  type TestCasePage,
  type ToolTarget,
  type UpdateTestCaseRequest,
} from "../../shared/testing/test-case.js";
import { ProjectNotFoundError, type ProjectService } from "../projects/project-service.js";
import {
  TestCaseRepository,
  type TestCaseCursorPosition,
  type TestCaseListFilters,
} from "./test-case-repository.js";

const uuid = z.uuid();
const listInputSchema = z.object({
  kind: z.enum(["tool", "scenario"]).optional(),
  connectionId: uuid.optional(),
  tag: z.string().trim().min(1).max(80).optional(),
  query: z.string().trim().min(1).max(200).optional(),
  cursor: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(100).default(50),
}).strict();

export type TestCaseListInput = z.input<typeof listInputSchema>;

export class InvalidTestCaseError extends Error {
  constructor(message = "Test case definition is invalid") { super(message); this.name = "InvalidTestCaseError"; }
}
export class TestCaseNotFoundError extends Error {
  constructor() { super("Test case not found"); this.name = "TestCaseNotFoundError"; }
}
export class TestCaseRevisionConflictError extends Error {
  constructor() { super("Test case revision conflict"); this.name = "TestCaseRevisionConflictError"; }
}
export class TestTargetNotAvailableError extends Error {
  constructor() { super("Test case target is not available in this project"); this.name = "TestTargetNotAvailableError"; }
}

export interface TestCaseService {
  create(projectId: string, definition: unknown): TestCaseDefinition;
  list(projectId: string, input?: TestCaseListInput): TestCasePage;
  get(projectId: string, testCaseId: string): TestCaseDefinition;
  update(projectId: string, testCaseId: string, request: unknown): TestCaseDefinition;
  remove(projectId: string, testCaseId: string): void;
}

interface CursorEnvelope extends TestCaseListFilters, TestCaseCursorPosition {
  projectId: string;
}

function validatedProjectId(value: string): string {
  const parsed = uuid.safeParse(value);
  if (!parsed.success) throw new ProjectNotFoundError();
  return parsed.data;
}

function validatedTestCaseId(value: string): string {
  const parsed = uuid.safeParse(value);
  if (!parsed.success) throw new TestCaseNotFoundError();
  return parsed.data;
}

function targetsOf(definition: TestCaseMutation | TestCaseDefinition): ToolTarget[] {
  if (definition.kind === "tool") return [definition.target];
  return [...definition.steps, ...definition.cleanupSteps].map(({ target }) => target);
}

function parseMutation(value: unknown): TestCaseMutation {
  const parsed = testCaseMutationSchema.safeParse(value);
  if (!parsed.success) throw new InvalidTestCaseError(parsed.error.issues[0]?.message);
  return parsed.data;
}

function parseUpdate(value: unknown): UpdateTestCaseRequest {
  const parsed = updateTestCaseRequestSchema.safeParse(value);
  if (!parsed.success) throw new InvalidTestCaseError(parsed.error.issues[0]?.message);
  return parsed.data;
}

function normalizedFilters(input: TestCaseListInput | undefined) {
  const parsed = listInputSchema.safeParse(input ?? {});
  if (!parsed.success) throw new InvalidTestCaseError("Test case list filters are invalid");
  const { cursor: _cursor, limit: _limit, ...filters } = parsed.data;
  return { parsed: parsed.data, filters };
}

function decodeCursor(value: string | undefined, projectId: string, filters: TestCaseListFilters): TestCaseCursorPosition | null {
  if (value === undefined) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as CursorEnvelope;
    const expected = JSON.stringify({ projectId, ...filters });
    const actual = JSON.stringify({
      projectId: parsed.projectId,
      ...(parsed.kind === undefined ? {} : { kind: parsed.kind }),
      ...(parsed.connectionId === undefined ? {} : { connectionId: parsed.connectionId }),
      ...(parsed.tag === undefined ? {} : { tag: parsed.tag }),
      ...(parsed.query === undefined ? {} : { query: parsed.query }),
    });
    if (expected !== actual || !z.string().datetime({ offset: true }).safeParse(parsed.updatedAt).success ||
        !uuid.safeParse(parsed.id).success) throw new Error();
    return { updatedAt: parsed.updatedAt, id: parsed.id };
  } catch {
    throw new InvalidTestCaseError("Test case cursor is invalid for these filters");
  }
}

function encodeCursor(projectId: string, filters: TestCaseListFilters, position: TestCaseCursorPosition): string {
  return Buffer.from(JSON.stringify({ projectId, ...filters, ...position }), "utf8").toString("base64url");
}

export function createTestCaseService(projects: ProjectService, options: {
  createId?: () => string;
  now?: () => Date;
} = {}): TestCaseService {
  const createId = options.createId ?? randomUUID;
  const now = options.now ?? (() => new Date());
  const repository = (projectId: string) => new TestCaseRepository(projects.open(projectId));

  function generatedId(label: string): string {
    const value = createId();
    if (!uuid.safeParse(value).success) throw new Error(`${label} ID generator returned an invalid UUID`);
    return value;
  }

  function ensureTargets(repo: TestCaseRepository, projectId: string, targets: ToolTarget[]): void {
    for (const { connectionId } of targets) {
      if (!repo.hasConnection(projectId, connectionId)) throw new TestTargetNotAvailableError();
    }
  }

  return {
    create(rawProjectId, value) {
      const projectId = validatedProjectId(rawProjectId);
      const mutation = parseMutation(value);
      const timestamp = now().toISOString();
      const definition = testCaseDefinitionSchema.safeParse({
        ...mutation,
        id: generatedId("Test case"),
        projectId,
        revision: 1,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      if (!definition.success) throw new InvalidTestCaseError(definition.error.issues[0]?.message);
      const repo = repository(projectId);
      const targets = targetsOf(definition.data);
      ensureTargets(repo, projectId, targets);
      return repo.insert(definition.data, generatedId("Test case revision"), targets);
    },

    list(rawProjectId, input) {
      const projectId = validatedProjectId(rawProjectId);
      const { parsed, filters } = normalizedFilters(input);
      const page = repository(projectId).list(
        projectId, filters, parsed.limit, decodeCursor(parsed.cursor, projectId, filters),
      );
      return {
        items: page.items,
        nextCursor: page.next === null ? null : encodeCursor(projectId, filters, page.next),
      };
    },

    get(rawProjectId, rawTestCaseId) {
      const projectId = validatedProjectId(rawProjectId);
      const definition = repository(projectId).get(projectId, validatedTestCaseId(rawTestCaseId));
      if (definition === null) throw new TestCaseNotFoundError();
      return definition;
    },

    update(rawProjectId, rawTestCaseId, value) {
      const projectId = validatedProjectId(rawProjectId);
      const testCaseId = validatedTestCaseId(rawTestCaseId);
      const request = parseUpdate(value);
      const repo = repository(projectId);
      const existing = repo.get(projectId, testCaseId);
      if (existing === null) throw new TestCaseNotFoundError();
      if (existing.kind !== request.definition.kind) {
        throw new InvalidTestCaseError("Test case kind cannot be changed");
      }
      const definition = testCaseDefinitionSchema.safeParse({
        ...request.definition,
        id: existing.id,
        projectId,
        revision: existing.revision + 1,
        createdAt: existing.createdAt,
        updatedAt: now().toISOString(),
      });
      if (!definition.success) throw new InvalidTestCaseError(definition.error.issues[0]?.message);
      const targets = targetsOf(definition.data);
      ensureTargets(repo, projectId, targets);
      const result = repo.update(
        definition.data, request.revision, generatedId("Test case revision"), targets,
      );
      if (result === "missing") throw new TestCaseNotFoundError();
      if (result === "conflict") throw new TestCaseRevisionConflictError();
      return definition.data;
    },

    remove(rawProjectId, rawTestCaseId) {
      const projectId = validatedProjectId(rawProjectId);
      if (!repository(projectId).remove(projectId, validatedTestCaseId(rawTestCaseId), now().toISOString())) {
        throw new TestCaseNotFoundError();
      }
    },
  };
}
