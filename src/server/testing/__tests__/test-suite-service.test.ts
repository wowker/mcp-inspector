import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createConnectionService } from "../../connections/connection-service.js";
import { createProjectService } from "../../projects/project-service.js";
import { createTestCaseService } from "../test-case-service.js";
import { TestSuiteRevisionConflictError, createTestSuiteService } from "../test-suite-service.js";

const projectId = "00000000-0000-4000-8000-000000000941";
const connectionId = "00000000-0000-4000-8000-000000000942";

describe("TestSuiteService", () => {
  const roots: string[] = [];
  afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

  function fixture() {
    const dataRoot = mkdtempSync(join(tmpdir(), "inspector-test-suites-")); roots.push(dataRoot);
    let nextId = 950;
    const createId = () => `00000000-0000-4000-8000-${String(nextId++).padStart(12, "0")}`;
    let minute = 0;
    const now = () => new Date(`2026-09-01T01:${String(minute++).padStart(2, "0")}:00.000Z`);
    const projects = createProjectService({ dataRoot, createId: () => projectId });
    projects.create("Suites");
    const connections = createConnectionService(projects, { createId: () => connectionId });
    connections.create(projectId, { name: "A", url: "https://a.example.test/mcp",
      transport: "streamable-http", authMode: "none", timeoutMs: 10_000 });
    const testCases = createTestCaseService(projects, { createId, now });
    const testCase = testCases.create(projectId, { kind: "tool", name: "List stores", description: "",
      tags: [], isEnabled: true, target: { connectionId, toolName: "list_stores" }, arguments: {},
      assertions: [], timeoutMs: 10_000 });
    return { projects, connections, testCases, testCase, service: createTestSuiteService(projects, { createId, now }) };
  }

  const mutation = (testCaseId: string, name = "Smoke suite") => ({
    name,
    description: "Critical path",
    tags: ["smoke"],
    members: [{ id: "20000000-0000-4000-8000-000000000001", testCaseId, position: 0, isEnabled: true }],
    executionPolicy: { concurrency: 2, stopOnFailure: true },
  });

  it("creates, lists, updates and soft-deletes a revisioned suite", async () => {
    const { projects, connections, testCases, testCase, service } = fixture();
    try {
      const created = service.create(projectId, mutation(testCase.id));
      expect(created).toMatchObject({ projectId, revision: 1, name: "Smoke suite" });
      expect(service.list(projectId).items).toEqual([
        expect.objectContaining({ id: created.id, memberCount: 1, executionPolicy: { concurrency: 2, stopOnFailure: true } }),
      ]);
      const other = testCases.create(projectId, { kind: "tool", name: "Other", description: "", tags: [],
        isEnabled: true, target: { connectionId, toolName: "other" }, arguments: {}, assertions: [], timeoutMs: 10_000 });
      expect(() => service.update(projectId, created.id, { revision: 1, definition: {
        ...mutation(testCase.id), members: [{ ...mutation(testCase.id).members[0]!, testCaseId: other.id }],
      } })).toThrow(/cannot be rebound/i);
      const updated = service.update(projectId, created.id, {
        revision: 1,
        definition: mutation(testCase.id, "Updated suite"),
      });
      expect(updated).toMatchObject({ revision: 2, name: "Updated suite" });
      expect(() => service.update(projectId, created.id, {
        revision: 1,
        definition: mutation(testCase.id, "Stale"),
      })).toThrow(TestSuiteRevisionConflictError);
      service.remove(projectId, created.id);
      expect(service.list(projectId).items).toEqual([]);
    } finally { await connections.close(); projects.close(); }
  });

  it("rejects members that do not resolve to an active test case in the project", async () => {
    const { projects, connections, service } = fixture();
    try {
      expect(() => service.create(projectId, mutation("30000000-0000-4000-8000-000000000001")))
        .toThrow(/member/i);
    } finally { await connections.close(); projects.close(); }
  });
});
