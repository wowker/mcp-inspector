import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  comparisonRuleSetSchema,
  replaceComparisonRulesSchema,
  type ComparisonRuleSet,
} from "../../shared/run-comparison.js";
import { ProjectNotFoundError, type ProjectService } from "../projects/project-service.js";
import { ComparisonRuleRepository } from "./comparison-rule-repository.js";
import { InvalidComparisonPathError, normalizeSafeJsonPath } from "./structural-diff.js";

const uuid = z.string().uuid();

export class InvalidComparisonRulesError extends Error {
  constructor() { super("Comparison ignore rules are invalid"); this.name = "InvalidComparisonRulesError"; }
}

export interface ComparisonRuleService {
  list(projectId: string): ComparisonRuleSet;
  replace(projectId: string, input: unknown): ComparisonRuleSet;
}

export function normalizeComparisonExpressions(input: unknown): string[] {
  const parsed = replaceComparisonRulesSchema.safeParse(input);
  if (!parsed.success) throw new InvalidComparisonRulesError();
  let expressions: string[];
  try { expressions = parsed.data.expressions.map(normalizeSafeJsonPath); }
  catch (error) {
    if (error instanceof InvalidComparisonPathError) throw new InvalidComparisonRulesError();
    throw error;
  }
  if (new Set(expressions).size !== expressions.length) throw new InvalidComparisonRulesError();
  return expressions;
}

export function createComparisonRuleService(projects: ProjectService, options: {
  createId?: () => string;
  now?: () => Date;
} = {}): ComparisonRuleService {
  const createId = options.createId ?? randomUUID;
  const now = options.now ?? (() => new Date());

  function projectId(value: string): string {
    const parsed = uuid.safeParse(value);
    if (!parsed.success) throw new ProjectNotFoundError();
    return parsed.data;
  }

  function repository(value: string): { id: string; repo: ComparisonRuleRepository } {
    const id = projectId(value);
    return { id, repo: new ComparisonRuleRepository(projects.open(id)) };
  }

  return {
    list(rawProjectId) {
      const { id, repo } = repository(rawProjectId);
      return repo.list(id);
    },

    replace(rawProjectId, input) {
      const expressions = normalizeComparisonExpressions(input);
      const { id, repo } = repository(rawProjectId);
      const existing = new Map(repo.list(id).rules.map((rule) => [rule.expression, rule]));
      const timestamp = now().toISOString();
      const rules = expressions.map((expression, position) => {
        const prior = existing.get(expression);
        const ruleId = prior?.id ?? createId();
        if (!uuid.safeParse(ruleId).success) throw new Error("Comparison rule ID generator returned an invalid UUID");
        return {
          id: ruleId,
          projectId: id,
          expression,
          position,
          createdAt: prior?.createdAt ?? timestamp,
          updatedAt: prior !== undefined && prior.position === position ? prior.updatedAt : timestamp,
        };
      });
      return repo.replace(id, comparisonRuleSetSchema.parse({ rules }).rules);
    },
  };
}
