import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createProjectService } from "../../projects/project-service.js";
import { InvalidComparisonRulesError, createComparisonRuleService } from "../comparison-rule-service.js";

describe("comparison rule service", () => {
  const roots: string[] = [];
  afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

  it("normalizes and atomically replaces the complete ordered project set", () => {
    const root = mkdtempSync(join(tmpdir(), "mcp-inspector-comparison-service-"));
    roots.push(root);
    const projects = createProjectService({ dataRoot: root });
    const project = projects.create("Comparison rules");
    const ids = [
      "00000000-0000-4000-8000-000000001511",
      "00000000-0000-4000-8000-000000001512",
      "00000000-0000-4000-8000-000000001513",
    ];
    const service = createComparisonRuleService(projects, {
      createId: () => ids.shift()!, now: () => new Date("2026-09-01T01:00:00.000Z"),
    });
    try {
      const first = service.replace(project.id, { expressions: ["$.requestId", "$.rows[*].timestamp"] });
      expect(first.rules.map(({ expression, position }) => ({ expression, position }))).toEqual([
        { expression: '$["requestId"]', position: 0 },
        { expression: '$["rows"][*]["timestamp"]', position: 1 },
      ]);
      const second = service.replace(project.id, { expressions: ["$.rows[*].timestamp", "$.new"] });
      expect(second.rules[0]!.id).toBe(first.rules[1]!.id);
      expect(second.rules[0]!.createdAt).toBe(first.rules[1]!.createdAt);
      expect(second.rules.map(({ expression }) => expression)).toEqual([
        '$["rows"][*]["timestamp"]', '$["new"]',
      ]);
      expect(service.list(project.id)).toEqual(second);

      expect(() => service.replace(project.id, { expressions: ["$.new", '$["new"]'] }))
        .toThrow(InvalidComparisonRulesError);
      expect(() => service.replace(project.id, { expressions: ["$..secret"] }))
        .toThrow(InvalidComparisonRulesError);
      expect(service.list(project.id)).toEqual(second);
    } finally { projects.close(); }
  });
});
