import type {
  AutomationDraft,
  AutomationDraftDefinition,
  AutomationDraftMutationResult,
  AutomationDraftPage,
  ListDraftsInput,
} from "../../shared/authoring/draft.js";
import type { ProjectStore } from "../projects/project-store.js";

interface DraftRow {
  id: string;
  project_id: string;
  revision: number;
  state: AutomationDraft["state"];
  goal: string;
  definition_json: string;
  definition_digest: string;
  created_at: string;
  updated_at: string;
}

interface IdempotencyRow {
  operation: string;
  request_hash: string;
  resource_id: string | null;
  result_json: string | null;
}

export class InvalidAuthoringDraftCursorError extends Error {
  constructor() { super("Authoring Draft cursor is invalid"); this.name = "InvalidAuthoringDraftCursorError"; }
}

export class AuthoringDraftIdempotencyConflictError extends Error {
  constructor() { super("Authoring Draft idempotency conflict"); this.name = "AuthoringDraftIdempotencyConflictError"; }
}

export class AuthoringDraftRepositoryConflictError extends Error {
  constructor() { super("Authoring Draft revision conflict"); this.name = "AuthoringDraftRepositoryConflictError"; }
}

const columns = "id, project_id, revision, state, goal, definition_json, definition_digest, created_at, updated_at";

function fromRow(row: DraftRow): AutomationDraft {
  let definition: unknown;
  try { definition = JSON.parse(row.definition_json) as unknown; }
  catch { throw new Error("Stored Authoring Draft definition is corrupt"); }
  return {
    version: 1,
    id: row.id,
    projectId: row.project_id,
    revision: row.revision,
    state: row.state,
    goal: row.goal,
    definitionDigest: row.definition_digest,
    definition: definition as AutomationDraftDefinition,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class AuthoringDraftRepository {
  constructor(private readonly store: ProjectStore) {}

  get(projectId: string, draftId: string): AutomationDraft | null {
    const row = this.store.database.prepare(`SELECT ${columns} FROM authoring_drafts
      WHERE project_id = ? AND id = ?`).get(projectId, draftId) as DraftRow | undefined;
    return row === undefined ? null : fromRow(row);
  }

  replay(projectId: string, idempotencyKey: string, operation: string,
    requestHash: string): AutomationDraftMutationResult | null {
    return this.idempotentDraft(projectId, idempotencyKey, operation, requestHash);
  }

  list(projectId: string, input: Omit<ListDraftsInput, "projectId"> = {}): AutomationDraftPage {
    const limit = input.limit ?? 50;
    const filter = { state: input.state ?? null, limit, sort: "updatedAtDesc" } as const;
    let boundary: { updatedAt: string; id: string } | undefined;
    if (input.cursor !== undefined) {
      try {
        const parsed = JSON.parse(Buffer.from(input.cursor, "base64url").toString("utf8")) as unknown;
        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error();
        const value = parsed as Record<string, unknown>;
        if (value.projectId !== projectId || JSON.stringify(value.filter) !== JSON.stringify(filter) ||
            typeof value.updatedAt !== "string" || Number.isNaN(Date.parse(value.updatedAt)) ||
            new Date(value.updatedAt).toISOString() !== value.updatedAt ||
            typeof value.id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value.id)) throw new Error();
        boundary = { updatedAt: value.updatedAt, id: value.id };
      } catch { throw new InvalidAuthoringDraftCursorError(); }
    }
    const clauses = ["project_id = ?"];
    const parameters: Array<string | number> = [projectId];
    if (input.state !== undefined) { clauses.push("state = ?"); parameters.push(input.state); }
    if (boundary !== undefined) {
      clauses.push("(updated_at < ? OR (updated_at = ? AND id < ?))");
      parameters.push(boundary.updatedAt, boundary.updatedAt, boundary.id);
    }
    const rows = this.store.database.prepare(`SELECT ${columns} FROM authoring_drafts
      WHERE ${clauses.join(" AND ")} ORDER BY updated_at DESC, id DESC LIMIT ?`)
      .all(...parameters, limit + 1) as DraftRow[];
    const visible = rows.slice(0, limit).map(fromRow);
    const last = visible.at(-1);
    return {
      items: visible.map((draft) => ({
        id: draft.id, projectId: draft.projectId, revision: draft.revision, state: draft.state,
        goal: draft.goal, testCaseCount: draft.definition.testCases.length,
        suiteCount: draft.definition.suites.length, createdAt: draft.createdAt, updatedAt: draft.updatedAt,
      })),
      nextCursor: rows.length > limit && last !== undefined
        ? Buffer.from(JSON.stringify({ projectId, filter, updatedAt: last.updatedAt, id: last.id })).toString("base64url")
        : null,
    };
  }

  create(input: {
    id: string;
    revisionId: string;
    projectId: string;
    goal: string;
    definition: AutomationDraftDefinition;
    definitionDigest: string;
    idempotencyKey: string;
    operation: string;
    requestHash: string;
    createdAt: string;
  }): AutomationDraftMutationResult {
    return this.store.database.transaction(() => {
      const replay = this.idempotentDraft(input.projectId, input.idempotencyKey, input.operation, input.requestHash);
      if (replay !== null) return replay;
      const definitionJson = JSON.stringify(input.definition);
      this.store.database.prepare(`INSERT INTO authoring_drafts
        (id, project_id, revision, state, goal, definition_json, definition_digest, created_at, updated_at)
        VALUES (?, ?, 1, 'ACTIVE', ?, ?, ?, ?, ?)`)
        .run(input.id, input.projectId, input.goal, definitionJson, input.definitionDigest, input.createdAt, input.createdAt);
      this.store.database.prepare(`INSERT INTO authoring_draft_revisions
        (id, project_id, draft_id, revision, definition_json, definition_digest, created_at)
        VALUES (?, ?, ?, 1, ?, ?, ?)`)
        .run(input.revisionId, input.projectId, input.id, definitionJson, input.definitionDigest, input.createdAt);
      this.completeIdempotency(input.projectId, input.idempotencyKey, input.operation, input.requestHash,
        input.id, { draftId: input.id, revision: 1, definitionDigest: input.definitionDigest }, input.createdAt);
      return { draftId: input.id, revision: 1, definitionDigest: input.definitionDigest };
    }).immediate();
  }

  replace(input: {
    revisionId: string;
    projectId: string;
    draftId: string;
    expectedRevision: number;
    goal: string;
    definition: AutomationDraftDefinition;
    definitionDigest: string;
    idempotencyKey: string;
    operation: string;
    requestHash: string;
    updatedAt: string;
  }): AutomationDraftMutationResult {
    return this.store.database.transaction(() => {
      const replay = this.idempotentDraft(input.projectId, input.idempotencyKey, input.operation, input.requestHash);
      if (replay !== null) return replay;
      const definitionJson = JSON.stringify(input.definition);
      const nextRevision = input.expectedRevision + 1;
      const changed = this.store.database.prepare(`UPDATE authoring_drafts
        SET revision = ?, goal = ?, definition_json = ?, definition_digest = ?, updated_at = ?
        WHERE project_id = ? AND id = ? AND revision = ? AND state = 'ACTIVE'`)
        .run(nextRevision, input.goal, definitionJson, input.definitionDigest, input.updatedAt,
          input.projectId, input.draftId, input.expectedRevision);
      if (changed.changes !== 1) throw new AuthoringDraftRepositoryConflictError();
      this.store.database.prepare(`INSERT INTO authoring_draft_revisions
        (id, project_id, draft_id, revision, definition_json, definition_digest, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .run(input.revisionId, input.projectId, input.draftId, nextRevision,
          definitionJson, input.definitionDigest, input.updatedAt);
      this.completeIdempotency(input.projectId, input.idempotencyKey, input.operation, input.requestHash,
        input.draftId, { draftId: input.draftId, revision: nextRevision,
          definitionDigest: input.definitionDigest }, input.updatedAt);
      return { draftId: input.draftId, revision: nextRevision, definitionDigest: input.definitionDigest };
    }).immediate();
  }

  private idempotentDraft(projectId: string, key: string, operation: string,
    requestHash: string): AutomationDraftMutationResult | null {
    const record = this.store.database.prepare(`SELECT operation, request_hash, resource_id, result_json
      FROM authoring_idempotency_records WHERE project_id = ? AND idempotency_key = ?`)
      .get(projectId, key) as IdempotencyRow | undefined;
    if (record === undefined) return null;
    if (record.operation !== operation || record.request_hash !== requestHash ||
        record.resource_id === null || record.result_json === null) {
      throw new AuthoringDraftIdempotencyConflictError();
    }
    try {
      const result = JSON.parse(record.result_json) as Record<string, unknown>;
      if (result.draftId !== record.resource_id || typeof result.revision !== "number" ||
          typeof result.definitionDigest !== "string") throw new Error();
      return result as unknown as AutomationDraftMutationResult;
    } catch { throw new Error("Idempotent Authoring Draft result is unavailable"); }
  }

  private completeIdempotency(projectId: string, key: string, operation: string, requestHash: string,
    resourceId: string, result: unknown, timestamp: string): void {
    this.store.database.prepare(`INSERT INTO authoring_idempotency_records
      (project_id, idempotency_key, operation, request_hash, resource_id, result_json, created_at, completed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(projectId, key, operation, requestHash, resourceId, JSON.stringify(result), timestamp, timestamp);
  }
}
