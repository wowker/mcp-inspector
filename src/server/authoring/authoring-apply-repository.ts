import {
  authoringApplyResultSchema,
  type AuthoringAppliedAsset,
  type AuthoringApplyResult,
} from "../../shared/authoring/apply.js";
import type { ProjectStore } from "../projects/project-store.js";

interface ApplyRow {
  id: string; project_id: string; draft_id: string; draft_revision: number; validation_digest: string;
  request_hash: string; status: "APPLYING" | "APPLIED" | "FAILED"; result_json: string | null;
  completed_at: string | null;
}

export class AuthoringApplyRepositoryConflictError extends Error {}
export class AuthoringApplyRepositoryAlreadyAppliedError extends Error {}

export class AuthoringApplyRepository {
  constructor(private readonly store: ProjectStore) {}

  replay(projectId: string, idempotencyKey: string, requestHash: string): AuthoringApplyResult | null {
    const row = this.store.database.prepare(`SELECT id, project_id, draft_id, draft_revision,
      validation_digest, request_hash, status, result_json, completed_at
      FROM authoring_draft_apply_results WHERE project_id = ? AND idempotency_key = ?`)
      .get(projectId, idempotencyKey) as ApplyRow | undefined;
    if (row === undefined) return null;
    if (row.request_hash !== requestHash || row.status !== "APPLIED" || row.result_json === null) {
      throw new AuthoringApplyRepositoryConflictError();
    }
    return authoringApplyResultSchema.parse(JSON.parse(row.result_json));
  }

  apply(input: {
    applyId: string; projectId: string; draftId: string; draftRevision: number;
    validationId: string; validationDigest: string; idempotencyKey: string; requestHash: string;
    timestamp: string; writeAssets(): AuthoringAppliedAsset[]; afterStage?(stage: string): void;
  }): AuthoringApplyResult {
    return this.store.database.transaction(() => {
      const replay = this.replay(input.projectId, input.idempotencyKey, input.requestHash);
      if (replay !== null) return replay;
      const alreadyApplied = this.store.database.prepare(`SELECT 1 FROM authoring_draft_apply_results
        WHERE project_id = ? AND draft_id = ? AND status = 'APPLIED'`).get(input.projectId, input.draftId);
      if (alreadyApplied !== undefined) throw new AuthoringApplyRepositoryAlreadyAppliedError();
      this.store.database.prepare(`INSERT INTO authoring_draft_apply_results
        (id, project_id, draft_id, draft_revision, validation_id, validation_digest,
         idempotency_key, request_hash, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'APPLYING', ?)`)
        .run(input.applyId, input.projectId, input.draftId, input.draftRevision, input.validationId,
          input.validationDigest, input.idempotencyKey, input.requestHash, input.timestamp);
      input.afterStage?.("APPLY_CREATED");
      const assets = input.writeAssets();
      const result = authoringApplyResultSchema.parse({ applyId: input.applyId, projectId: input.projectId,
        draftId: input.draftId, draftRevision: input.draftRevision, validationDigest: input.validationDigest,
        assets, appliedAt: input.timestamp });
      const mapping = this.store.database.prepare(`INSERT INTO authoring_draft_asset_mappings
        (project_id, apply_id, draft_id, draft_local_id, asset_kind, formal_asset_id, formal_revision)
        VALUES (?, ?, ?, ?, ?, ?, ?)`);
      for (const asset of assets) mapping.run(input.projectId, input.applyId, input.draftId,
        asset.draftLocalId, asset.kind, asset.formalAssetId, asset.revision);
      input.afterStage?.("MAPPINGS_WRITTEN");
      this.store.database.prepare(`UPDATE authoring_draft_apply_results
        SET status = 'APPLIED', result_json = ?, completed_at = ? WHERE project_id = ? AND id = ?`)
        .run(JSON.stringify(result), input.timestamp, input.projectId, input.applyId);
      const changed = this.store.database.prepare(`UPDATE authoring_drafts SET state = 'APPLIED', updated_at = ?
        WHERE project_id = ? AND id = ? AND revision = ? AND state = 'ACTIVE'`)
        .run(input.timestamp, input.projectId, input.draftId, input.draftRevision);
      if (changed.changes !== 1) throw new AuthoringApplyRepositoryConflictError();
      return result;
    }).immediate();
  }
}
