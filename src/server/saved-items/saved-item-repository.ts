import type { ProjectStore } from "../projects/project-store.js";

export type SavedItemKind = "request" | "response";
export interface SavedItemSummary {
  id: string; projectId: string; connectionId: string; toolName: string; kind: SavedItemKind;
  name: string; description: string; sourceRunId: string | null; createdAt: string; updatedAt: string;
}
export interface SavedItemDetail extends SavedItemSummary { payload: unknown }
export interface SavedItemPage { items: SavedItemSummary[]; next: { createdAt: string; id: string } | null }

interface SavedItemRow {
  id: string; project_id: string; connection_id: string; tool_name: string; kind: SavedItemKind;
  name: string; description: string; payload_json: string; source_run_id: string | null;
  created_at: string; updated_at: string;
}

function summary(row: SavedItemRow): SavedItemSummary {
  return { id: row.id, projectId: row.project_id, connectionId: row.connection_id, toolName: row.tool_name,
    kind: row.kind, name: row.name, description: row.description, sourceRunId: row.source_run_id,
    createdAt: row.created_at, updatedAt: row.updated_at };
}
function detail(row: SavedItemRow): SavedItemDetail {
  let payload: unknown;
  try { payload = JSON.parse(row.payload_json); } catch { throw new Error("Stored saved item payload is corrupt"); }
  return { ...summary(row), payload };
}
const columns = `id, project_id, connection_id, tool_name, kind, name, description,
  payload_json, source_run_id, created_at, updated_at`;

export class SavedItemRepository {
  constructor(private readonly store: ProjectStore) {}
  hasTool(projectId: string, connectionId: string, toolName: string): boolean {
    return this.store.database.prepare(`SELECT 1 FROM tools
      WHERE project_id = ? AND connection_id = ? AND name = ?`).get(projectId, connectionId, toolName) !== undefined;
  }
  runMatches(projectId: string, runId: string, connectionId: string, toolName: string): boolean {
    return this.store.database.prepare(`SELECT 1 FROM runs WHERE id = ? AND project_id = ?
      AND connection_id = ? AND tool_name = ?`).get(runId, projectId, connectionId, toolName) !== undefined;
  }
  list(projectId: string, connectionId: string, toolName: string, limit: number,
    cursor: { createdAt: string; id: string } | null): SavedItemPage {
    const cursorSql = cursor === null ? "" : "AND (created_at < ? OR (created_at = ? AND id < ?))";
    const params = cursor === null ? [projectId, connectionId, toolName, limit + 1]
      : [projectId, connectionId, toolName, cursor.createdAt, cursor.createdAt, cursor.id, limit + 1];
    const rows = this.store.database.prepare(`SELECT ${columns} FROM saved_tool_items
      WHERE project_id = ? AND connection_id = ? AND tool_name = ? ${cursorSql}
      ORDER BY created_at DESC, id DESC LIMIT ?`).all(...params) as SavedItemRow[];
    const visible = rows.slice(0, limit); const last = visible.at(-1);
    return { items: visible.map(summary), next: rows.length > limit && last !== undefined
      ? { createdAt: last.created_at, id: last.id } : null };
  }
  get(projectId: string, id: string): SavedItemDetail | null {
    const row = this.store.database.prepare(`SELECT ${columns} FROM saved_tool_items
      WHERE project_id = ? AND id = ?`).get(projectId, id) as SavedItemRow | undefined;
    return row === undefined ? null : detail(row);
  }
  insert(item: SavedItemDetail, payloadJson: string): SavedItemDetail {
    this.store.database.prepare(`INSERT INTO saved_tool_items
      (id, project_id, connection_id, tool_name, kind, name, description, payload_json,
       source_run_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(item.id, item.projectId, item.connectionId, item.toolName, item.kind, item.name,
        item.description, payloadJson, item.sourceRunId, item.createdAt, item.updatedAt);
    return item;
  }
  remove(projectId: string, id: string): boolean {
    return this.store.database.prepare("DELETE FROM saved_tool_items WHERE project_id = ? AND id = ?")
      .run(projectId, id).changes === 1;
  }
}
