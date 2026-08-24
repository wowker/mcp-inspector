import type { ProjectStore } from "../projects/project-store.js";
import type { CatalogTool, ToolDefinition, ToolDetail, ToolSnapshot, ToolStatus } from "./tool-types.js";

interface CatalogRow {
  project_id: string;
  connection_id: string;
  name: string;
  status: ToolStatus;
  updated_at: string;
  snapshot_id: string;
  tool_name: string;
  content_hash: string;
  definition_json: string;
  created_at: string;
}

interface SnapshotRow {
  id: string;
  project_id: string;
  connection_id: string;
  tool_name: string;
  content_hash: string;
  definition_json: string;
  created_at: string;
}

export interface RefreshedTool {
  id: string;
  name: string;
  contentHash: string;
  definitionJson: string;
}

function definitionFromJson(value: string): ToolDefinition {
  const parsed: unknown = JSON.parse(value);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed) ||
      typeof (parsed as Record<string, unknown>).name !== "string") {
    throw new Error("Stored Tool definition is invalid");
  }
  return parsed as ToolDefinition;
}

function snapshotFromRow(row: SnapshotRow): ToolSnapshot {
  return {
    id: row.id,
    projectId: row.project_id,
    connectionId: row.connection_id,
    toolName: row.tool_name,
    contentHash: row.content_hash,
    definition: definitionFromJson(row.definition_json),
    createdAt: row.created_at,
  };
}

function catalogFromRow(row: CatalogRow): CatalogTool {
  return {
    projectId: row.project_id,
    connectionId: row.connection_id,
    name: row.name,
    status: row.status,
    updatedAt: row.updated_at,
    currentSnapshot: snapshotFromRow({
      id: row.snapshot_id,
      project_id: row.project_id,
      connection_id: row.connection_id,
      tool_name: row.tool_name,
      content_hash: row.content_hash,
      definition_json: row.definition_json,
      created_at: row.created_at,
    }),
  };
}

const catalogSelect = `
  SELECT t.project_id, t.connection_id, t.name, t.status, t.updated_at,
         s.id AS snapshot_id, s.tool_name, s.content_hash, s.definition_json, s.created_at
  FROM tools t
  JOIN tool_snapshots s ON s.id = t.current_snapshot_id
`;

export class ToolRepository {
  constructor(private readonly store: ProjectStore) {}

  list(projectId: string, connectionId: string): CatalogTool[] {
    const rows = this.store.database.prepare(`
      ${catalogSelect}
      WHERE t.project_id = ? AND t.connection_id = ?
      ORDER BY t.name COLLATE NOCASE, t.name
    `).all(projectId, connectionId) as CatalogRow[];
    return rows.map(catalogFromRow);
  }

  get(projectId: string, connectionId: string, toolName: string): ToolDetail | null {
    const row = this.store.database.prepare(`
      ${catalogSelect}
      WHERE t.project_id = ? AND t.connection_id = ? AND t.name = ?
    `).get(projectId, connectionId, toolName) as CatalogRow | undefined;
    if (row === undefined) return null;
    const snapshots = this.store.database.prepare(`
      SELECT id, project_id, connection_id, tool_name, content_hash, definition_json, created_at
      FROM tool_snapshots
      WHERE project_id = ? AND connection_id = ? AND tool_name = ?
      ORDER BY created_at, id
    `).all(projectId, connectionId, toolName) as SnapshotRow[];
    return { tool: catalogFromRow(row), snapshots: snapshots.map(snapshotFromRow) };
  }

  replaceCatalog(
    projectId: string,
    connectionId: string,
    incoming: RefreshedTool[],
    timestamp: string,
  ): void {
    this.store.database.transaction(() => {
      const previous = new Map(this.list(projectId, connectionId).map((item) => [item.name, item]));
      const seen = new Set<string>();
      const insertSnapshot = this.store.database.prepare(`
        INSERT OR IGNORE INTO tool_snapshots (
          id, project_id, connection_id, tool_name, content_hash, definition_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      const findSnapshot = this.store.database.prepare(`
        SELECT id FROM tool_snapshots
        WHERE connection_id = ? AND tool_name = ? AND content_hash = ?
      `);
      const upsertTool = this.store.database.prepare(`
        INSERT INTO tools (project_id, connection_id, name, current_snapshot_id, status, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(connection_id, name) DO UPDATE SET
          project_id = excluded.project_id,
          current_snapshot_id = excluded.current_snapshot_id,
          status = excluded.status,
          updated_at = excluded.updated_at
      `);

      for (const item of incoming) {
        seen.add(item.name);
        insertSnapshot.run(
          item.id, projectId, connectionId, item.name,
          item.contentHash, item.definitionJson, timestamp,
        );
        const snapshot = findSnapshot.get(connectionId, item.name, item.contentHash) as
          { id: string } | undefined;
        if (snapshot === undefined) throw new Error("Tool snapshot was not persisted");
        const old = previous.get(item.name);
        const status: ToolStatus = old === undefined || old.currentSnapshot.contentHash === item.contentHash
          ? "current"
          : "changed";
        upsertTool.run(projectId, connectionId, item.name, snapshot.id, status, timestamp);
      }

      const markRemoved = this.store.database.prepare(`
        UPDATE tools SET status = 'removed', updated_at = ?
        WHERE project_id = ? AND connection_id = ? AND name = ?
      `);
      for (const old of previous.values()) {
        if (!seen.has(old.name) && old.status !== "removed") {
          markRemoved.run(timestamp, projectId, connectionId, old.name);
        }
      }
    })();
  }
}
