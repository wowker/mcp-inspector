import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import { resolveRegistryPath } from "./project-paths.js";

export interface ProjectSummary {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  lastOpenedAt: string | null;
}

interface ProjectRegistryRow {
  id: string;
  name: string;
  database_path: string;
  created_at: string;
  updated_at: string;
  last_opened_at: string | null;
}

function toSummary(row: ProjectRegistryRow): ProjectSummary {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastOpenedAt: row.last_opened_at,
  };
}

export class ProjectRegistry {
  readonly database: Database.Database;

  constructor(dataRoot: string) {
    const registryPath = resolveRegistryPath(dataRoot);
    mkdirSync(dirname(registryPath), { recursive: true });
    this.database = new Database(registryPath);
    this.database.pragma("foreign_keys = ON");
    this.database.pragma("journal_mode = WAL");
    this.database.pragma("busy_timeout = 5000");
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS project_registry (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        database_path TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_opened_at TEXT
      )
    `);
  }

  create(record: ProjectSummary, databasePath: string): void {
    this.database.prepare(`
      INSERT INTO project_registry (
        id, name, database_path, created_at, updated_at, last_opened_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      record.id,
      record.name,
      databasePath,
      record.createdAt,
      record.updatedAt,
      record.lastOpenedAt,
    );
  }

  list(): ProjectSummary[] {
    const rows = this.database.prepare(`
      SELECT id, name, database_path, created_at, updated_at, last_opened_at
      FROM project_registry
      ORDER BY COALESCE(last_opened_at, created_at) DESC, created_at DESC, id ASC
    `).all() as ProjectRegistryRow[];
    return rows.map(toSummary);
  }

  get(projectId: string): (ProjectSummary & { databasePath: string }) | null {
    const row = this.database.prepare(`
      SELECT id, name, database_path, created_at, updated_at, last_opened_at
      FROM project_registry
      WHERE id = ?
    `).get(projectId) as ProjectRegistryRow | undefined;
    return row === undefined
      ? null
      : { ...toSummary(row), databasePath: row.database_path };
  }

  markOpened(projectId: string, openedAt: string): ProjectSummary {
    const result = this.database.prepare(`
      UPDATE project_registry
      SET last_opened_at = ?, updated_at = ?
      WHERE id = ?
    `).run(openedAt, openedAt, projectId);
    if (result.changes !== 1) {
      throw new Error("Project not found");
    }
    const record = this.get(projectId);
    if (record === null) throw new Error("Project not found");
    const { databasePath: _databasePath, ...summary } = record;
    return summary;
  }

  remove(projectId: string): void {
    this.database.prepare("DELETE FROM project_registry WHERE id = ?").run(projectId);
  }

  close(): void {
    this.database.close();
  }
}
