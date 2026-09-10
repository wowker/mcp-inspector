import {
  getTestAssetInputSchema,
  listTestAssetsInputSchema,
  type AuthoringTestAssetPage,
  type AuthoringTestAssetSummary,
  type ListTestAssetsInput,
} from "../../shared/authoring/validation.js";
import type { JsonValue } from "../../shared/tool-definition.js";
import type { ProjectService } from "../projects/project-service.js";
import type { TestCaseService } from "../testing/test-case-service.js";
import type { TestSuiteService } from "../testing/test-suite-service.js";

const sensitiveKey = /(?:^|[-_])(authorization|token|secret|password|passwd|cookie|api[-_]?key)(?:$|[-_])/iu;

interface AssetRow {
  id: string;
  project_id: string;
  kind: AuthoringTestAssetSummary["kind"];
  name: string;
  description: string;
  revision: number;
  updated_at: string;
}

export class InvalidAuthoringAssetCursorError extends Error {
  constructor() { super("Authoring test asset cursor is invalid"); this.name = "InvalidAuthoringAssetCursorError"; }
}
export class AuthoringAssetNotFoundError extends Error {
  constructor() { super("Authoring test asset not found"); this.name = "AuthoringAssetNotFoundError"; }
}
export class AuthoringAssetRevisionConflictError extends Error {
  constructor() { super("Authoring test asset revision conflict"); this.name = "AuthoringAssetRevisionConflictError"; }
}

export interface AuthoringAssetService {
  list(projectId: string, input?: Omit<ListTestAssetsInput, "projectId">): AuthoringTestAssetPage;
  get(projectId: string, kind: "TEST_CASE" | "TEST_SUITE", assetId: string, revision: number): JsonValue;
}

function sanitize(value: unknown, depth = 0): JsonValue {
  if (depth > 50) return "[TRUNCATED]";
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return typeof value === "string" ? value.replace(/Bearer\s+[^\s"']+/giu, "Bearer [REDACTED]") : value;
  }
  if (typeof value === "number") return Number.isFinite(value) ? value : "[INVALID_NUMBER]";
  if (Array.isArray(value)) return value.map((item) => sanitize(item, depth + 1));
  if (typeof value !== "object") return "[UNAVAILABLE]";
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [
    key, sensitiveKey.test(key) ? "[REDACTED]" : sanitize(item, depth + 1),
  ]));
}

export function createAuthoringAssetService(options: {
  projects: ProjectService;
  testCases: Pick<TestCaseService, "get">;
  testSuites: Pick<TestSuiteService, "get">;
}): AuthoringAssetService {
  return {
    list(projectId, rawInput = {}) {
      const parsed = listTestAssetsInputSchema.parse({ projectId, ...rawInput });
      const limit = parsed.limit ?? 50;
      const filter = { kind: parsed.kind ?? null, limit, sort: "updatedAtDesc" } as const;
      let boundary: { updatedAt: string; id: string } | undefined;
      if (parsed.cursor !== undefined) {
        try {
          const value = JSON.parse(Buffer.from(parsed.cursor, "base64url").toString("utf8")) as Record<string, unknown>;
          if (value.projectId !== projectId || JSON.stringify(value.filter) !== JSON.stringify(filter) ||
              typeof value.updatedAt !== "string" || Number.isNaN(Date.parse(value.updatedAt)) ||
              new Date(value.updatedAt).toISOString() !== value.updatedAt ||
              typeof value.id !== "string" ||
              !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value.id)) throw new Error();
          boundary = { updatedAt: value.updatedAt, id: value.id };
        } catch { throw new InvalidAuthoringAssetCursorError(); }
      }
      const database = options.projects.open(projectId).database;
      const kinds = parsed.kind === undefined ? ["TEST_CASE", "TEST_SUITE"] as const : [parsed.kind];
      const selects: string[] = [];
      const parameters: Array<string | number> = [];
      for (const kind of kinds) {
        const table = kind === "TEST_CASE" ? "test_cases" : "test_suites";
        const clauses = ["project_id = ?", "deleted_at IS NULL"];
        parameters.push(projectId);
        if (boundary !== undefined) {
          clauses.push("(updated_at < ? OR (updated_at = ? AND id < ?))");
          parameters.push(boundary.updatedAt, boundary.updatedAt, boundary.id);
        }
        selects.push(`SELECT id, project_id, '${kind}' AS kind, name, description, revision, updated_at
          FROM ${table} WHERE ${clauses.join(" AND ")}`);
      }
      parameters.push(limit + 1);
      const rows = database.prepare(`${selects.join(" UNION ALL ")}
        ORDER BY updated_at DESC, id DESC LIMIT ?`).all(...parameters) as AssetRow[];
      const visible = rows.slice(0, limit);
      const items = visible.map((row) => ({ id: row.id, projectId: row.project_id, kind: row.kind,
        name: row.name, description: row.description, revision: row.revision, updatedAt: row.updated_at }));
      const last = items.at(-1);
      return { items, nextCursor: rows.length > limit && last !== undefined
        ? Buffer.from(JSON.stringify({ projectId, filter, updatedAt: last.updatedAt, id: last.id })).toString("base64url")
        : null };
    },
    get(projectId, kind, assetId, revision) {
      const parsed = getTestAssetInputSchema.parse({ projectId, kind, assetId, revision });
      let asset;
      try {
        asset = parsed.kind === "TEST_CASE"
          ? options.testCases.get(parsed.projectId, parsed.assetId)
          : options.testSuites.get(parsed.projectId, parsed.assetId);
      } catch { throw new AuthoringAssetNotFoundError(); }
      if (asset.revision !== parsed.revision) throw new AuthoringAssetRevisionConflictError();
      return sanitize(asset);
    },
  };
}
