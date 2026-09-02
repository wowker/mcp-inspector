import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  automatedTestsExportEnvelopeSchema,
  importAutomatedTestsRequestSchema,
  importAutomatedTestsResultSchema,
  type AutomatedTestsExportEnvelope,
  type ImportAutomatedTestsResult,
} from "../../shared/testing/test-transfer.js";
import {
  testCaseDefinitionSchema,
  type TestCaseDefinition,
  type ToolTarget,
} from "../../shared/testing/test-case.js";
import { testSuiteDefinitionSchema, type TestSuiteDefinition } from "../../shared/testing/test-suite.js";
import type { ProjectService } from "../projects/project-service.js";
import { TestCaseRepository } from "./test-case-repository.js";
import { TestSuiteRepository } from "./test-suite-repository.js";

export class InvalidTestTransferError extends Error {
  constructor(message = "Automated test transfer payload is invalid") { super(message); this.name = "InvalidTestTransferError"; }
}

export interface TestTransferService {
  exportProject(projectId: string): AutomatedTestsExportEnvelope;
  importProject(projectId: string, request: unknown): ImportAutomatedTestsResult;
}

function targetsOf(definition: TestCaseDefinition): ToolTarget[] {
  return definition.kind === "tool" ? [definition.target]
    : [...definition.steps, ...definition.cleanupSteps].map(({ target }) => target);
}

export function createTestTransferService(projects: ProjectService, options: {
  createId?: () => string;
  now?: () => Date;
} = {}): TestTransferService {
  const createId = options.createId ?? randomUUID;
  const now = options.now ?? (() => new Date());
  const generatedId = (label: string) => {
    const value = createId();
    if (!z.uuid().safeParse(value).success) throw new Error(`${label} ID generator returned an invalid UUID`);
    return value;
  };

  return {
    exportProject(projectId) {
      if (!z.uuid().safeParse(projectId).success) throw new InvalidTestTransferError();
      const store = projects.open(projectId);
      const project = store.getProject();
      const casesRepo = new TestCaseRepository(store);
      const suitesRepo = new TestSuiteRepository(store);
      const testCases = (store.database.prepare(`SELECT id FROM test_cases
        WHERE project_id = ? AND deleted_at IS NULL ORDER BY created_at, id`).all(projectId) as Array<{ id: string }>)
        .map(({ id }) => casesRepo.get(projectId, id)).filter((value): value is TestCaseDefinition => value !== null);
      const testSuites = (store.database.prepare(`SELECT id FROM test_suites
        WHERE project_id = ? AND deleted_at IS NULL ORDER BY created_at, id`).all(projectId) as Array<{ id: string }>)
        .map(({ id }) => suitesRepo.get(projectId, id)).filter((value): value is TestSuiteDefinition => value !== null);
      const connectionIds = [...new Set(testCases.flatMap(targetsOf).map(({ connectionId }) => connectionId))].sort();
      const connectionRows = connectionIds.map((connectionId) => store.database.prepare(`SELECT name FROM connections
        WHERE project_id = ? AND id = ?`).get(projectId, connectionId) as { name: string } | undefined);
      if (connectionRows.some((row) => row === undefined)) throw new Error("Stored test target connection is missing");
      return automatedTestsExportEnvelopeSchema.parse({
        format: "mcp-inspector-automated-tests", version: 1, exportedAt: now().toISOString(),
        sourceProject: { id: projectId, name: project.name },
        connections: connectionIds.map((sourceConnectionId, index) => ({
          alias: `server-${index + 1}`, sourceConnectionId, name: connectionRows[index]!.name,
        })),
        data: { testCases, testSuites },
      });
    },

    importProject(projectId, value) {
      if (!z.uuid().safeParse(projectId).success) throw new InvalidTestTransferError();
      const parsed = importAutomatedTestsRequestSchema.safeParse(value);
      if (!parsed.success) throw new InvalidTestTransferError(parsed.error.issues[0]?.message);
      const { envelope, bindings, conflictPolicy } = parsed.data;
      const store = projects.open(projectId);
      const timestamp = now().toISOString();
      const sourceToAlias = new Map(envelope.connections.map((connection) => [connection.sourceConnectionId, connection.alias]));
      const declaredAliases = new Set(envelope.connections.map(({ alias }) => alias));
      if (Object.keys(bindings).some((alias) => !declaredAliases.has(alias))) {
        throw new InvalidTestTransferError("Server bindings contain an unknown alias");
      }
      const connectionMap = new Map<string, string>();
      for (const connection of envelope.connections) {
        const targetId = bindings[connection.alias];
        if (targetId === undefined || store.database.prepare(`SELECT 1 FROM connections
          WHERE project_id = ? AND id = ?`).get(projectId, targetId) === undefined) {
          throw new InvalidTestTransferError(`Server binding '${connection.alias}' is missing or invalid`);
        }
        connectionMap.set(connection.sourceConnectionId, targetId);
      }
      const remapTarget = (target: ToolTarget): ToolTarget => {
        if (!sourceToAlias.has(target.connectionId)) throw new InvalidTestTransferError("Export is missing a Server alias");
        const connectionId = connectionMap.get(target.connectionId);
        if (connectionId === undefined) throw new InvalidTestTransferError("Server binding is missing");
        return { ...target, connectionId };
      };
      const rowState = (table: "test_cases" | "test_suites", id: string) => store.database.prepare(
        `SELECT deleted_at FROM ${table} WHERE project_id = ? AND id = ?`,
      ).get(projectId, id) as { deleted_at: string | null } | undefined;
      const testCaseIds: Record<string, string> = {};
      const skippedCaseIds = new Set<string>();
      for (const source of envelope.data.testCases) {
        const state = rowState("test_cases", source.id);
        if (state !== undefined && state.deleted_at === null && conflictPolicy === "SKIP") {
          testCaseIds[source.id] = source.id; skippedCaseIds.add(source.id);
        } else if (state !== undefined && conflictPolicy === "COPY") testCaseIds[source.id] = generatedId("Imported test case");
        else if (state !== undefined && state.deleted_at !== null) {
          if (conflictPolicy !== "COPY") throw new InvalidTestTransferError("A deleted test case has the same identity; use COPY");
          testCaseIds[source.id] = generatedId("Imported test case");
        } else testCaseIds[source.id] = source.id;
      }
      const sourceCaseIds = new Set(envelope.data.testCases.map(({ id }) => id));
      for (const suite of envelope.data.testSuites) for (const member of suite.members) {
        if (!sourceCaseIds.has(member.testCaseId)) throw new InvalidTestTransferError("Suite member is missing from the export");
      }
      const testSuiteIds: Record<string, string> = {};
      const skippedSuiteIds = new Set<string>();
      for (const source of envelope.data.testSuites) {
        const state = rowState("test_suites", source.id);
        if (state !== undefined && state.deleted_at === null && conflictPolicy === "SKIP") {
          testSuiteIds[source.id] = source.id; skippedSuiteIds.add(source.id);
        } else if (state !== undefined && conflictPolicy === "COPY") testSuiteIds[source.id] = generatedId("Imported test suite");
        else if (state !== undefined && state.deleted_at !== null) {
          if (conflictPolicy !== "COPY") throw new InvalidTestTransferError("A deleted test suite has the same identity; use COPY");
          testSuiteIds[source.id] = generatedId("Imported test suite");
        } else testSuiteIds[source.id] = source.id;
      }

      const casesRepo = new TestCaseRepository(store);
      const suitesRepo = new TestSuiteRepository(store);
      const preparedCases = envelope.data.testCases.filter(({ id }) => !skippedCaseIds.has(id)).map((source) => {
        const existing = casesRepo.get(projectId, source.id);
        if (existing !== null && conflictPolicy === "OVERWRITE" && existing.kind !== source.kind) {
          throw new InvalidTestTransferError("Test case kind cannot be overwritten");
        }
        const common = { ...source, id: testCaseIds[source.id]!, projectId,
          revision: existing !== null && conflictPolicy === "OVERWRITE" ? existing.revision + 1 : 1,
          createdAt: existing !== null && conflictPolicy === "OVERWRITE" ? existing.createdAt : timestamp,
          updatedAt: timestamp };
        return testCaseDefinitionSchema.parse(source.kind === "tool"
          ? { ...common, target: remapTarget(source.target) }
          : { ...common,
            steps: source.steps.map((step) => ({ ...step, target: remapTarget(step.target) })),
            cleanupSteps: source.cleanupSteps.map((step) => ({ ...step, target: remapTarget(step.target) })) });
      });
      const preparedSuites = envelope.data.testSuites.filter(({ id }) => !skippedSuiteIds.has(id)).map((source) => {
        const existing = suitesRepo.get(projectId, source.id);
        const existingByCase = new Map(existing?.members.map((member) => [member.testCaseId, member.id]) ?? []);
        return testSuiteDefinitionSchema.parse({ ...source, id: testSuiteIds[source.id]!, projectId,
          revision: existing !== null && conflictPolicy === "OVERWRITE" ? existing.revision + 1 : 1,
          createdAt: existing !== null && conflictPolicy === "OVERWRITE" ? existing.createdAt : timestamp,
          updatedAt: timestamp,
          members: source.members.map((member) => {
            const testCaseId = testCaseIds[member.testCaseId]!;
            return { ...member, id: existingByCase.get(testCaseId) ?? generatedId("Imported suite member"), testCaseId };
          }),
        });
      });

      store.database.transaction(() => {
        for (const definition of preparedCases) {
          const existing = casesRepo.get(projectId, definition.id);
          const targets = targetsOf(definition);
          if (existing === null) casesRepo.insert(definition, generatedId("Imported test case revision"), targets);
          else if (conflictPolicy === "OVERWRITE") {
            const result = casesRepo.update(definition, existing.revision, generatedId("Imported test case revision"), targets);
            if (result !== "updated") throw new InvalidTestTransferError("Test case changed during import");
          }
        }
        for (const definition of preparedSuites) {
          const existing = suitesRepo.get(projectId, definition.id);
          if (existing === null) suitesRepo.insert(definition);
          else if (conflictPolicy === "OVERWRITE" && suitesRepo.update(definition, existing.revision) !== "updated") {
            throw new InvalidTestTransferError("Test suite changed during import");
          }
        }
      })();
      return importAutomatedTestsResultSchema.parse({
        importedTestCases: preparedCases.length, importedTestSuites: preparedSuites.length,
        skippedTestCases: skippedCaseIds.size, skippedTestSuites: skippedSuiteIds.size,
        testCaseIds, testSuiteIds,
      });
    },
  };
}
