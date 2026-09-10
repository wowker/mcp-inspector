import {
  draftValidationResultSchema,
  type DraftValidationResult,
} from "../../shared/authoring/validation.js";
import type { ProjectStore } from "../projects/project-store.js";

export class AuthoringDraftValidationRepository {
  constructor(private readonly store: ProjectStore) {}

  insert(result: DraftValidationResult): DraftValidationResult {
    this.store.database.prepare(`INSERT INTO authoring_draft_validations
      (id, project_id, draft_id, draft_revision, definition_digest, tool_schema_hashes_json,
       validation_digest, status, issues_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(draft_id, draft_revision, validation_digest) DO NOTHING`)
      .run(result.id, result.projectId, result.draftId, result.draftRevision, result.definitionDigest,
        JSON.stringify(result.toolSchemaHashes), result.validationDigest, result.status,
        JSON.stringify(result.issues), result.createdAt);
    const row = this.store.database.prepare(`SELECT id, project_id, draft_id, draft_revision,
      definition_digest, tool_schema_hashes_json, validation_digest, status, issues_json, created_at
      FROM authoring_draft_validations
      WHERE project_id = ? AND draft_id = ? AND draft_revision = ? AND validation_digest = ?`)
      .get(result.projectId, result.draftId, result.draftRevision, result.validationDigest) as Record<string, unknown> | undefined;
    if (row === undefined) throw new Error("Stored Authoring Draft validation is unavailable");
    return draftValidationResultSchema.parse({
      id: row.id, projectId: row.project_id, draftId: row.draft_id, draftRevision: row.draft_revision,
      definitionDigest: row.definition_digest,
      toolSchemaHashes: JSON.parse(String(row.tool_schema_hashes_json)) as unknown,
      validationDigest: row.validation_digest, status: row.status,
      issues: JSON.parse(String(row.issues_json)) as unknown, createdAt: row.created_at,
    });
  }
}
