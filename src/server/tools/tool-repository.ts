import type { ProjectStore } from "../projects/project-store.js";
import type { CatalogTool, ToolDefinition, ToolDetail, ToolFolder, ToolSnapshot, ToolStatus } from "./tool-types.js";

interface CatalogRow {
  project_id: string;
  connection_id: string;
  name: string;
  status: ToolStatus;
  folder_id: string | null;
  favorite: number;
  last_used_at: string | null;
  updated_at: string;
  snapshot_id: string;
  tool_name: string;
  content_hash: string;
  definition_json: string;
  created_at: string;
}

interface FolderRow {
  id: string;
  project_id: string;
  connection_id: string;
  name: string;
  created_at: string;
  updated_at: string;
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
    folderId: row.folder_id,
    favorite: row.favorite === 1,
    lastUsedAt: row.last_used_at,
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

function folderFromRow(row: FolderRow): ToolFolder {
  return {
    id: row.id,
    projectId: row.project_id,
    connectionId: row.connection_id,
    name: row.name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const catalogSelect = `
  SELECT t.project_id, t.connection_id, t.name, t.status, t.updated_at,
         a.folder_id,
         COALESCE(p.favorite, 0) AS favorite,
         p.last_used_at,
         s.id AS snapshot_id, s.tool_name, s.content_hash, s.definition_json, s.created_at
  FROM tools t
  JOIN tool_snapshots s ON s.id = t.current_snapshot_id
  LEFT JOIN tool_folder_assignments a
    ON a.project_id = t.project_id AND a.connection_id = t.connection_id AND a.tool_name = t.name
  LEFT JOIN tool_catalog_preferences p
    ON p.project_id = t.project_id AND p.connection_id = t.connection_id AND p.tool_name = t.name
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

  setFavorite(projectId: string, connectionId: string, toolName: string, favorite: boolean): CatalogTool | null {
    if (this.get(projectId, connectionId, toolName) === null) return null;
    this.store.database.prepare(`
      INSERT INTO tool_catalog_preferences (project_id, connection_id, tool_name, favorite, last_used_at)
      VALUES (?, ?, ?, ?, NULL)
      ON CONFLICT(project_id, connection_id, tool_name) DO UPDATE SET favorite = excluded.favorite
    `).run(projectId, connectionId, toolName, favorite ? 1 : 0);
    return this.get(projectId, connectionId, toolName)!.tool;
  }

  markUsed(projectId: string, connectionId: string, toolName: string, timestamp: string): CatalogTool | null {
    if (this.get(projectId, connectionId, toolName) === null) return null;
    this.store.database.prepare(`
      INSERT INTO tool_catalog_preferences (project_id, connection_id, tool_name, favorite, last_used_at)
      VALUES (?, ?, ?, 0, ?)
      ON CONFLICT(project_id, connection_id, tool_name) DO UPDATE SET last_used_at = excluded.last_used_at
    `).run(projectId, connectionId, toolName, timestamp);
    return this.get(projectId, connectionId, toolName)!.tool;
  }

  listFolders(projectId: string, connectionId: string): ToolFolder[] {
    const rows = this.store.database.prepare(`
      SELECT id, project_id, connection_id, name, created_at, updated_at
      FROM tool_folders
      WHERE project_id = ? AND connection_id = ?
      ORDER BY name COLLATE NOCASE, name, id
    `).all(projectId, connectionId) as FolderRow[];
    return rows.map(folderFromRow);
  }

  createFolder(
    projectId: string,
    connectionId: string,
    id: string,
    name: string,
    timestamp: string,
  ): ToolFolder | null {
    const duplicate = this.store.database.prepare(`
      SELECT 1 FROM tool_folders
      WHERE project_id = ? AND connection_id = ? AND name = ? COLLATE NOCASE
    `).get(projectId, connectionId, name);
    if (duplicate !== undefined) return null;
    this.store.database.prepare(`
      INSERT INTO tool_folders (id, project_id, connection_id, name, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, projectId, connectionId, name, timestamp, timestamp);
    const row = this.store.database.prepare(`
      SELECT id, project_id, connection_id, name, created_at, updated_at
      FROM tool_folders WHERE project_id = ? AND connection_id = ? AND id = ?
    `).get(projectId, connectionId, id) as FolderRow;
    return folderFromRow(row);
  }

  renameFolder(
    projectId: string,
    connectionId: string,
    folderId: string,
    name: string,
    timestamp: string,
  ): "missing" | "conflict" | ToolFolder {
    return this.store.database.transaction(() => {
      const existing = this.store.database.prepare(`
        SELECT 1 FROM tool_folders
        WHERE project_id = ? AND connection_id = ? AND id = ?
      `).get(projectId, connectionId, folderId);
      if (existing === undefined) return "missing" as const;
      const duplicate = this.store.database.prepare(`
        SELECT 1 FROM tool_folders
        WHERE project_id = ? AND connection_id = ? AND id <> ? AND name = ? COLLATE NOCASE
      `).get(projectId, connectionId, folderId, name);
      if (duplicate !== undefined) return "conflict" as const;
      this.store.database.prepare(`
        UPDATE tool_folders SET name = ?, updated_at = ?
        WHERE project_id = ? AND connection_id = ? AND id = ?
      `).run(name, timestamp, projectId, connectionId, folderId);
      const row = this.store.database.prepare(`
        SELECT id, project_id, connection_id, name, created_at, updated_at
        FROM tool_folders WHERE project_id = ? AND connection_id = ? AND id = ?
      `).get(projectId, connectionId, folderId) as FolderRow;
      return folderFromRow(row);
    })();
  }

  deleteFolder(projectId: string, connectionId: string, folderId: string): boolean {
    const result = this.store.database.prepare(`
      DELETE FROM tool_folders WHERE project_id = ? AND connection_id = ? AND id = ?
    `).run(projectId, connectionId, folderId);
    return result.changes === 1;
  }

  moveToFolder(
    projectId: string,
    connectionId: string,
    toolName: string,
    folderId: string | null,
  ): "tool-missing" | "folder-missing" | CatalogTool {
    return this.store.database.transaction(() => {
      const tool = this.get(projectId, connectionId, toolName);
      if (tool === null) return "tool-missing" as const;
      if (folderId !== null) {
        const folder = this.store.database.prepare(`
          SELECT 1 FROM tool_folders WHERE project_id = ? AND connection_id = ? AND id = ?
        `).get(projectId, connectionId, folderId);
        if (folder === undefined) return "folder-missing" as const;
      }
      this.store.database.prepare(`
        DELETE FROM tool_folder_assignments
        WHERE project_id = ? AND connection_id = ? AND tool_name = ?
      `).run(projectId, connectionId, toolName);
      if (folderId !== null) {
        this.store.database.prepare(`
          INSERT INTO tool_folder_assignments (project_id, connection_id, tool_name, folder_id)
          VALUES (?, ?, ?, ?)
        `).run(projectId, connectionId, toolName, folderId);
      }
      return this.get(projectId, connectionId, toolName)!.tool;
    })();
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

  deleteRemoved(projectId: string, connectionId: string, toolName: string): "deleted" | "active" | "missing" {
    const row = this.store.database.prepare(`
      SELECT status FROM tools
      WHERE project_id = ? AND connection_id = ? AND name = ?
    `).get(projectId, connectionId, toolName) as { status: ToolStatus } | undefined;
    if (row === undefined) return "missing";
    if (row.status !== "removed") return "active";
    this.store.database.prepare(`
      DELETE FROM tools
      WHERE project_id = ? AND connection_id = ? AND name = ? AND status = 'removed'
    `).run(projectId, connectionId, toolName);
    return "deleted";
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
