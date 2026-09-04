import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createConnectionService } from "../../connections/connection-service.js";
import { createProjectService } from "../../projects/project-service.js";
import { createPressureTestService, PressureTestRevisionConflictError } from "../pressure-test-service.js";
import { createTestCaseService } from "../test-case-service.js";

const projectId = "00000000-0000-4000-8000-000000005101";
const connectionId = "00000000-0000-4000-8000-000000005102";

describe("PressureTestService", () => {
  const roots: string[] = [];
  afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

  function fixture() {
    const dataRoot = mkdtempSync(join(tmpdir(), "inspector-pressure-tests-")); roots.push(dataRoot);
    let nextId = 5_200;
    const createId = () => `00000000-0000-4000-8000-${String(nextId++).padStart(12, "0")}`;
    let minute = 0;
    const now = () => new Date(`2026-09-01T02:${String(minute++).padStart(2, "0")}:00.000Z`);
    const projects = createProjectService({ dataRoot, createId: () => projectId });
    projects.create("Pressure tests");
    const connections = createConnectionService(projects, { createId: () => connectionId });
    connections.create(projectId, { name: "A", url: "https://a.example.test/mcp",
      transport: "streamable-http", authMode: "none", timeoutMs: 10_000 });
    const testCases = createTestCaseService(projects, { createId, now });
    const testCase = testCases.create(projectId, { kind: "tool", name: "List stores", description: "",
      tags: [], isEnabled: true, target: { connectionId, toolName: "list_stores" }, arguments: {},
      assertions: [], timeoutMs: 10_000 });
    return { projects, connections, testCases, testCase,
      service: createPressureTestService(projects, { createId, now }) };
  }

  const mutation = (testCaseId: string, name = "Store pressure") => ({
    name,
    description: "Steady load",
    target: { testCaseId },
    inputs: {},
    load: { virtualUsers: 2, rampUpMs: 1_000, durationMs: 10_000, thinkTimeMs: 100, maxIterations: 50 },
    thresholds: { maxErrorRate: 0.01, maxP95DurationMs: 800, minRequestsPerSecond: 1, stopOnErrorRate: true },
  });

  it("creates, paginates, updates and soft-deletes a revisioned definition", async () => {
    const { projects, connections, testCase, service } = fixture();
    try {
      const first = service.create(projectId, mutation(testCase.id, "First"));
      const second = service.create(projectId, mutation(testCase.id, "Second"));
      expect(first).toMatchObject({ projectId, revision: 1, name: "First" });

      const pageOne = service.list(projectId, { limit: 1 });
      expect(pageOne.items.map(({ id }) => id)).toEqual([second.id]);
      expect(pageOne.nextCursor).not.toBeNull();
      const pageTwo = service.list(projectId, { limit: 1, cursor: pageOne.nextCursor ?? undefined });
      expect(pageTwo.items.map(({ id }) => id)).toEqual([first.id]);
      expect(pageTwo.nextCursor).toBeNull();

      const updated = service.update(projectId, first.id, {
        revision: 1,
        definition: mutation(testCase.id, "Updated"),
      });
      expect(updated).toMatchObject({ revision: 2, name: "Updated" });
      expect(() => service.update(projectId, first.id, {
        revision: 1,
        definition: mutation(testCase.id, "Stale"),
      })).toThrow(PressureTestRevisionConflictError);

      service.remove(projectId, first.id);
      expect(() => service.get(projectId, first.id)).toThrow(/not found/i);
    } finally { await connections.close(); projects.close(); }
  });

  it("rejects a target that is not an active test case in the project", async () => {
    const { projects, connections, service } = fixture();
    try {
      expect(() => service.create(projectId, mutation("00000000-0000-4000-8000-000000005999")))
        .toThrow(/target/i);
    } finally { await connections.close(); projects.close(); }
  });
});
