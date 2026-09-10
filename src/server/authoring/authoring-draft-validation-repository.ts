import type { DraftValidationResult } from "../../shared/authoring/validation.js";
import type { ProjectStore } from "../projects/project-store.js";

export class AuthoringDraftValidationRepository {
  constructor(private readonly store: ProjectStore) {}

  insert(result: DraftValidationResult): DraftValidationResult {
    this.store.database.prepare(`INSERT INTO authoring_draft_validations
      (id, project_id, draft_id, draft_revision, definition_digest, tool_schema_hashes_json,
       validation_digest, status, issues_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(result.id, result.projectId, result.draftId, result.draftRevision, result.definitionDigest,
        JSON.stringify(result.toolSchemaHashes), result.validationDigest, result.status,
        JSON.stringify(result.issues), result.createdAt);
    return result;
  }
}
