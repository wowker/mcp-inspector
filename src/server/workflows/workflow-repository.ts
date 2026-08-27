import { parseToolWorkflow, type ToolWorkflow, type ToolWorkflowUpdate } from "../../shared/script-workflow.js";
import type { ProjectStore } from "../projects/project-store.js";

interface WorkflowRow {
  project_id: string;
  connection_id: string;
  tool_name: string;
  revision: number;
  before_enabled: number;
  before_source: string;
  after_enabled: number;
  after_source: string;
  timeout_ms: number;
  created_at: string;
  updated_at: string;
}

function fromRow(row: WorkflowRow): ToolWorkflow {
  return parseToolWorkflow({
    projectId: row.project_id,
    connectionId: row.connection_id,
    toolName: row.tool_name,
    revision: row.revision,
    before: { enabled: row.before_enabled === 1, source: row.before_source },
    after: { enabled: row.after_enabled === 1, source: row.after_source },
    timeoutMs: row.timeout_ms,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

export class WorkflowRepository {
  constructor(private readonly store: ProjectStore) {}

  get(projectId: string, connectionId: string, toolName: string): ToolWorkflow | null {
    const row = this.store.database.prepare(`
      SELECT project_id, connection_id, tool_name, revision,
             before_enabled, before_source, after_enabled, after_source,
             timeout_ms, created_at, updated_at
      FROM tool_workflows
      WHERE project_id = ? AND connection_id = ? AND tool_name = ?
    `).get(projectId, connectionId, toolName) as WorkflowRow | undefined;
    return row === undefined ? null : fromRow(row);
  }

  getOrCreate(
    projectId: string,
    connectionId: string,
    toolName: string,
    timestamp: string,
  ): ToolWorkflow {
    this.store.database.prepare(`
      INSERT OR IGNORE INTO tool_workflows
        (project_id, connection_id, tool_name, revision, before_enabled, before_source,
         after_enabled, after_source, timeout_ms, created_at, updated_at)
      VALUES (?, ?, ?, 1, 0, '', 0, '', 5000, ?, ?)
    `).run(projectId, connectionId, toolName, timestamp, timestamp);
    const workflow = this.get(projectId, connectionId, toolName);
    if (workflow === null) throw new Error("Tool workflow was not persisted");
    return workflow;
  }

  update(
    projectId: string,
    connectionId: string,
    toolName: string,
    expectedRevision: number,
    update: ToolWorkflowUpdate,
    timestamp: string,
  ): ToolWorkflow | null {
    const result = this.store.database.prepare(`
      UPDATE tool_workflows
      SET revision = revision + 1,
          before_enabled = ?, before_source = ?,
          after_enabled = ?, after_source = ?,
          timeout_ms = ?, updated_at = ?
      WHERE project_id = ? AND connection_id = ? AND tool_name = ? AND revision = ?
    `).run(
      update.before.enabled ? 1 : 0,
      update.before.source,
      update.after.enabled ? 1 : 0,
      update.after.source,
      update.timeoutMs,
      timestamp,
      projectId,
      connectionId,
      toolName,
      expectedRevision,
    );
    return result.changes === 1 ? this.get(projectId, connectionId, toolName) : null;
  }
}
