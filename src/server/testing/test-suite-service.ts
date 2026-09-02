import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  testSuiteDefinitionSchema,
  testSuiteMutationSchema,
  updateTestSuiteRequestSchema,
  type TestSuiteDefinition,
  type TestSuiteMutation,
  type TestSuitePage,
  type UpdateTestSuiteRequest,
} from "../../shared/testing/test-suite.js";
import { ProjectNotFoundError, type ProjectService } from "../projects/project-service.js";
import { TestSuiteRepository } from "./test-suite-repository.js";

const uuid = z.uuid();

export class InvalidTestSuiteError extends Error {
  constructor(message = "Test suite definition is invalid") { super(message); this.name = "InvalidTestSuiteError"; }
}
export class TestSuiteNotFoundError extends Error {
  constructor() { super("Test suite not found"); this.name = "TestSuiteNotFoundError"; }
}
export class TestSuiteRevisionConflictError extends Error {
  constructor() { super("Test suite revision conflict"); this.name = "TestSuiteRevisionConflictError"; }
}
export class TestSuiteMemberNotFoundError extends Error {
  constructor() { super("Test suite member test case is not available in this project"); this.name = "TestSuiteMemberNotFoundError"; }
}

export interface TestSuiteService {
  create(projectId: string, definition: unknown): TestSuiteDefinition;
  list(projectId: string): TestSuitePage;
  get(projectId: string, suiteId: string): TestSuiteDefinition;
  update(projectId: string, suiteId: string, request: unknown): TestSuiteDefinition;
  remove(projectId: string, suiteId: string): void;
}

function validProjectId(value: string): string {
  const parsed = uuid.safeParse(value);
  if (!parsed.success) throw new ProjectNotFoundError();
  return parsed.data;
}

function validSuiteId(value: string): string {
  const parsed = uuid.safeParse(value);
  if (!parsed.success) throw new TestSuiteNotFoundError();
  return parsed.data;
}

function mutationOf(value: unknown): TestSuiteMutation {
  const parsed = testSuiteMutationSchema.safeParse(value);
  if (!parsed.success) throw new InvalidTestSuiteError(parsed.error.issues[0]?.message);
  return parsed.data;
}

function updateOf(value: unknown): UpdateTestSuiteRequest {
  const parsed = updateTestSuiteRequestSchema.safeParse(value);
  if (!parsed.success) throw new InvalidTestSuiteError(parsed.error.issues[0]?.message);
  return parsed.data;
}

export function createTestSuiteService(projects: ProjectService, options: {
  createId?: () => string;
  now?: () => Date;
} = {}): TestSuiteService {
  const createId = options.createId ?? randomUUID;
  const now = options.now ?? (() => new Date());
  const repository = (projectId: string) => new TestSuiteRepository(projects.open(projectId));

  function generatedId(): string {
    const value = createId();
    if (!uuid.safeParse(value).success) throw new Error("Test suite ID generator returned an invalid UUID");
    return value;
  }

  function ensureMembers(repo: TestSuiteRepository, projectId: string, definition: TestSuiteMutation): void {
    for (const member of definition.members) {
      if (!repo.hasActiveTestCase(projectId, member.testCaseId)) throw new TestSuiteMemberNotFoundError();
    }
  }

  return {
    create(rawProjectId, value) {
      const projectId = validProjectId(rawProjectId);
      const mutation = mutationOf(value);
      const repo = repository(projectId);
      ensureMembers(repo, projectId, mutation);
      const timestamp = now().toISOString();
      const definition = testSuiteDefinitionSchema.parse({
        ...mutation, id: generatedId(), projectId, revision: 1, createdAt: timestamp, updatedAt: timestamp,
      });
      return repo.insert(definition);
    },

    list(rawProjectId) {
      const projectId = validProjectId(rawProjectId);
      return { items: repository(projectId).list(projectId), nextCursor: null };
    },

    get(rawProjectId, rawSuiteId) {
      const projectId = validProjectId(rawProjectId);
      const definition = repository(projectId).get(projectId, validSuiteId(rawSuiteId));
      if (definition === null) throw new TestSuiteNotFoundError();
      return definition;
    },

    update(rawProjectId, rawSuiteId, value) {
      const projectId = validProjectId(rawProjectId);
      const suiteId = validSuiteId(rawSuiteId);
      const request = updateOf(value);
      const repo = repository(projectId);
      const existing = repo.get(projectId, suiteId);
      if (existing === null) throw new TestSuiteNotFoundError();
      ensureMembers(repo, projectId, request.definition);
      const existingMembers = new Map(existing.members.map((member) => [member.id, member.testCaseId]));
      if (request.definition.members.some((member) => {
        const priorTestCaseId = existingMembers.get(member.id);
        return priorTestCaseId !== undefined && priorTestCaseId !== member.testCaseId;
      })) throw new InvalidTestSuiteError("A stable suite member ID cannot be rebound to another test case");
      const definition = testSuiteDefinitionSchema.parse({
        ...request.definition,
        id: existing.id,
        projectId,
        revision: existing.revision + 1,
        createdAt: existing.createdAt,
        updatedAt: now().toISOString(),
      });
      const result = repo.update(definition, request.revision);
      if (result === "missing") throw new TestSuiteNotFoundError();
      if (result === "conflict") throw new TestSuiteRevisionConflictError();
      const persisted = repo.get(projectId, suiteId);
      if (persisted === null) throw new TestSuiteNotFoundError();
      return persisted;
    },

    remove(rawProjectId, rawSuiteId) {
      const projectId = validProjectId(rawProjectId);
      if (!repository(projectId).remove(projectId, validSuiteId(rawSuiteId), now().toISOString())) {
        throw new TestSuiteNotFoundError();
      }
    },
  };
}
