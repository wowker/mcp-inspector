import {
  comparisonIgnoreRuleSchema,
  comparisonRuleSetSchema,
  type ComparisonIgnoreRule,
  type ComparisonRuleSet,
} from "../../shared/run-comparison.js";
import type { ProjectStore } from "../projects/project-store.js";

interface RuleRow {
  id: string;
  project_id: string;
  expression: string;
  position: number;
  created_at: string;
  updated_at: string;
}

function fromRow(row: RuleRow): ComparisonIgnoreRule {
  return comparisonIgnoreRuleSchema.parse({
    id: row.id,
    projectId: row.project_id,
    expression: row.expression,
    position: row.position,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

export class ComparisonRuleRepository {
  constructor(private readonly store: ProjectStore) {}

  list(projectId: string): ComparisonRuleSet {
    const rows = this.store.database.prepare(`
      SELECT id, project_id, expression, position, created_at, updated_at
      FROM comparison_ignore_rules
      WHERE project_id = ?
      ORDER BY position, id
    `).all(projectId) as RuleRow[];
    return comparisonRuleSetSchema.parse({ rules: rows.map(fromRow) });
  }

  replace(projectId: string, rules: ComparisonIgnoreRule[]): ComparisonRuleSet {
    return this.store.database.transaction(() => {
      this.store.database.prepare(
        "DELETE FROM comparison_ignore_rules WHERE project_id = ?",
      ).run(projectId);
      const insert = this.store.database.prepare(`
        INSERT INTO comparison_ignore_rules
          (id, project_id, expression, position, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      for (const rule of rules) {
        insert.run(rule.id, projectId, rule.expression, rule.position, rule.createdAt, rule.updatedAt);
      }
      return this.list(projectId);
    })();
  }
}
