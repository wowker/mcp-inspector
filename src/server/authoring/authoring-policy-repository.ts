import {
  connectionAuthoringPolicySchema,
  type ConnectionAuthoringPolicy,
  type ReplaceAuthoringPolicyInput,
} from "../../shared/authoring/policy.js";
import type { ProjectStore } from "../projects/project-store.js";

interface PolicyRow {
  project_id: string;
  connection_id: string;
  mode: string;
  allowed_tools_json: string;
  denied_tools_json: string;
  require_cleanup_for_draft_mutations: number;
  max_calls_per_minute: number;
  max_concurrent_calls: number;
  max_call_duration_ms: number;
  revision: number;
  created_at: string;
  updated_at: string;
}

function fromRow(row: PolicyRow): ConnectionAuthoringPolicy {
  return connectionAuthoringPolicySchema.parse({
    projectId: row.project_id,
    connectionId: row.connection_id,
    mode: row.mode,
    allowedTools: JSON.parse(row.allowed_tools_json),
    deniedTools: JSON.parse(row.denied_tools_json),
    requireCleanupForDraftMutations: row.require_cleanup_for_draft_mutations === 1,
    maxCallsPerMinute: row.max_calls_per_minute,
    maxConcurrentCalls: row.max_concurrent_calls,
    maxCallDurationMs: row.max_call_duration_ms,
    revision: row.revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

const columns = `
  project_id, connection_id, mode, allowed_tools_json, denied_tools_json,
  require_cleanup_for_draft_mutations, max_calls_per_minute,
  max_concurrent_calls, max_call_duration_ms, revision, created_at, updated_at
`;

export class AuthoringPolicyRepository {
  constructor(private readonly store: ProjectStore) {}

  find(projectId: string, connectionId: string): ConnectionAuthoringPolicy | null {
    const row = this.store.database.prepare(`
      SELECT ${columns}
      FROM authoring_connection_policies
      WHERE project_id = ? AND connection_id = ?
    `).get(projectId, connectionId) as PolicyRow | undefined;
    return row === undefined ? null : fromRow(row);
  }

  replace(options: {
    projectId: string;
    connectionId: string;
    policy: Omit<ReplaceAuthoringPolicyInput, "expectedRevision">;
    expectedRevision: number;
    timestamp: string;
  }): ConnectionAuthoringPolicy | null {
    const write = this.store.database.transaction(() => {
      const current = this.find(options.projectId, options.connectionId);
      if ((current?.revision ?? 0) !== options.expectedRevision) return null;
      if (current === null) {
        this.store.database.prepare(`
          INSERT INTO authoring_connection_policies (
            project_id, connection_id, mode, allowed_tools_json, denied_tools_json,
            require_cleanup_for_draft_mutations, max_calls_per_minute,
            max_concurrent_calls, max_call_duration_ms, revision, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
        `).run(
          options.projectId,
          options.connectionId,
          options.policy.mode,
          JSON.stringify(options.policy.allowedTools),
          JSON.stringify(options.policy.deniedTools),
          Number(options.policy.requireCleanupForDraftMutations),
          options.policy.maxCallsPerMinute,
          options.policy.maxConcurrentCalls,
          options.policy.maxCallDurationMs,
          options.timestamp,
          options.timestamp,
        );
      } else {
        this.store.database.prepare(`
          UPDATE authoring_connection_policies
          SET mode = ?, allowed_tools_json = ?, denied_tools_json = ?,
              require_cleanup_for_draft_mutations = ?, max_calls_per_minute = ?,
              max_concurrent_calls = ?, max_call_duration_ms = ?,
              revision = revision + 1, updated_at = ?
          WHERE project_id = ? AND connection_id = ? AND revision = ?
        `).run(
          options.policy.mode,
          JSON.stringify(options.policy.allowedTools),
          JSON.stringify(options.policy.deniedTools),
          Number(options.policy.requireCleanupForDraftMutations),
          options.policy.maxCallsPerMinute,
          options.policy.maxConcurrentCalls,
          options.policy.maxCallDurationMs,
          options.timestamp,
          options.projectId,
          options.connectionId,
          options.expectedRevision,
        );
      }
      return this.find(options.projectId, options.connectionId);
    });
    return write.immediate();
  }
}
