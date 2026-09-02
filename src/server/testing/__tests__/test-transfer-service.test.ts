import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createConnectionService } from "../../connections/connection-service.js";
import { createProjectService } from "../../projects/project-service.js";
import { createTestCaseService } from "../test-case-service.js";
import { createTestSuiteService } from "../test-suite-service.js";
import { InvalidTestTransferError, createTestTransferService } from "../test-transfer-service.js";

const sourceProjectId = "00000000-0000-4000-8000-000000002001";
const targetProjectId = "00000000-0000-4000-8000-000000002002";
const sourceConnectionId = "00000000-0000-4000-8000-000000002003";
const targetConnectionId = "00000000-0000-4000-8000-000000002004";

describe("TestTransferService", () => {
  const roots: string[] = [];
  afterEach(() => { roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })); });

  function fixture() {
    const dataRoot = mkdtempSync(join(tmpdir(), "inspector-test-transfer-")); roots.push(dataRoot);
    let id = 2_010;
    const createId = () => `00000000-0000-4000-8000-${String(id++).padStart(12, "0")}`;
    const projectIds = [sourceProjectId, targetProjectId];
    const projects = createProjectService({ dataRoot, createId: () => projectIds.shift()! });
    projects.create("Source"); projects.create("Target");
    const connectionIds = [sourceConnectionId, targetConnectionId];
    const connections = createConnectionService(projects, { createId: () => connectionIds.shift()! });
    connections.create(sourceProjectId, { name: "Source API", url: "https://example.test/mcp", transport: "streamable-http",
      authMode: "bearer", bearerToken: "source-secret", timeoutMs: 10_000 });
    connections.create(targetProjectId, { name: "Target API", url: "https://example.test/mcp", transport: "streamable-http",
      authMode: "bearer", bearerToken: "target-secret", timeoutMs: 10_000 });
    const cases = createTestCaseService(projects, { createId, now: () => new Date("2026-09-01T00:00:00.000Z") });
    const testCase = cases.create(sourceProjectId, { kind: "tool", name: "List stores", description: "", tags: [],
      isEnabled: true, target: { connectionId: sourceConnectionId, toolName: "list_stores" }, arguments: {},
      assertions: [], timeoutMs: 10_000 });
    const suites = createTestSuiteService(projects, { createId, now: () => new Date("2026-09-01T00:00:00.000Z") });
    suites.create(sourceProjectId, { name: "Smoke", description: "", tags: [], members: [{ id: createId(),
      testCaseId: testCase.id, position: 0, isEnabled: true }], executionPolicy: { concurrency: 1, stopOnFailure: true } });
    const transfers = createTestTransferService(projects, { createId, now: () => new Date("2026-09-01T01:00:00.000Z") });
    return { projects, connections, cases, suites, transfers };
  }

  it("exports definitions without credentials and imports them with an explicit Server binding", async () => {
    const value = fixture();
    try {
      const envelope = value.transfers.exportProject(sourceProjectId);
      expect(JSON.stringify(envelope)).not.toContain("source-secret");
      expect(envelope).toMatchObject({ data: { testCases: [{ target: { connectionId: sourceConnectionId } }], testSuites: [{ name: "Smoke" }] } });
      const result = value.transfers.importProject(targetProjectId, { envelope,
        bindings: { "server-1": targetConnectionId }, conflictPolicy: "COPY", confirm: true });
      expect(result).toMatchObject({ importedTestCases: 1, importedTestSuites: 1, skippedTestCases: 0 });
      const imported = value.cases.get(targetProjectId, result.testCaseIds[envelope.data.testCases[0]!.id]!);
      expect(imported).toMatchObject({ target: { connectionId: targetConnectionId }, name: "List stores" });
      expect(value.suites.list(targetProjectId).items).toHaveLength(1);
    } finally { await value.connections.close(); value.projects.close(); }
  });

  it("fully validates before the transaction and leaves no partial definitions", async () => {
    const value = fixture();
    try {
      const envelope = value.transfers.exportProject(sourceProjectId);
      const invalid = structuredClone(envelope);
      const first = invalid.data.testCases[0]!;
      if (first.kind !== "tool") throw new Error("Expected Tool fixture");
      invalid.data.testCases.push({ ...first, id: "00000000-0000-4000-8000-000000002099",
        target: { connectionId: "00000000-0000-4000-8000-000000002098", toolName: "missing_alias" } });
      expect(() => value.transfers.importProject(targetProjectId, { envelope: invalid,
        bindings: { "server-1": targetConnectionId }, conflictPolicy: "COPY", confirm: true }))
        .toThrow(InvalidTestTransferError);
      expect(value.cases.list(targetProjectId).items).toEqual([]);
      expect(value.suites.list(targetProjectId).items).toEqual([]);
    } finally { await value.connections.close(); value.projects.close(); }
  });

  it("rejects undeclared Server bindings", async () => {
    const value = fixture();
    try {
      const envelope = value.transfers.exportProject(sourceProjectId);
      expect(() => value.transfers.importProject(targetProjectId, { envelope,
        bindings: { "server-1": targetConnectionId, unexpected: targetConnectionId },
        conflictPolicy: "COPY", confirm: true })).toThrow(InvalidTestTransferError);
      expect(value.cases.list(targetProjectId).items).toEqual([]);
    } finally { await value.connections.close(); value.projects.close(); }
  });
});
