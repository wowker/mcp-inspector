import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createProjectService } from "../../projects/project-service.js";
import { ComparisonRuleRepository } from "../comparison-rule-repository.js";

describe("comparison rule repository", () => {
  const roots: string[] = [];
  afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

  it("replaces one project's ordered set transactionally and decodes rows strictly", () => {
    const root = mkdtempSync(join(tmpdir(), "mcp-inspector-comparison-repository-"));
    roots.push(root);
    const projects = createProjectService({ dataRoot: root });
    const project = projects.create("Comparison repository");
    const repo = new ComparisonRuleRepository(projects.open(project.id));
    const timestamp = "2026-09-01T00:00:00.000Z";
    try {
      const rules = [{
        id: "00000000-0000-4000-8000-000000001531", projectId: project.id,
        expression: '$["requestId"]', position: 0, createdAt: timestamp, updatedAt: timestamp,
      }];
      expect(repo.replace(project.id, rules)).toEqual({ rules });
      expect(() => repo.replace(project.id, [rules[0]!, { ...rules[0]!, id: "not-a-uuid", position: 1 }]))
        .toThrow();
      expect(repo.list(project.id)).toEqual({ rules });
    } finally { projects.close(); }
  });
});
