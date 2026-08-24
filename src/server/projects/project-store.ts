import { existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import type { ProjectSummary } from "./project-registry.js";

interface Migration {
  version: number;
  sql: string;
}

export function resolveDefaultMigrationsUrl(moduleUrl: URL = new URL(import.meta.url)): URL {
  const sourceLayout = new URL("./migrations/", moduleUrl);
  if (existsSync(fileURLToPath(sourceLayout))) return sourceLayout;

  const bundledLayout = new URL("./projects/migrations/", moduleUrl);
  if (existsSync(fileURLToPath(bundledLayout))) return bundledLayout;

  throw new Error("Project migrations directory is missing");
}

export interface StoredProject {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  retentionDays: number;
  retentionCount: number;
}

function discoverMigrations(migrationsUrl: URL): Migration[] {
  const directory = fileURLToPath(migrationsUrl);
  const migrations = readdirSync(directory)
    .filter((name) => name.endsWith(".sql"))
    .map((name) => {
      const match = /^(\d+)_.*\.sql$/.exec(name);
      if (match === null) {
        throw new Error(`Invalid migration filename: ${name}`);
      }
      return {
        version: Number.parseInt(match[1], 10),
        sql: readFileSync(new URL(name, migrationsUrl), "utf8"),
      };
    })
    .sort((left, right) => left.version - right.version);

  for (let index = 0; index < migrations.length; index += 1) {
    const current = migrations[index];
    if (!Number.isSafeInteger(current.version) || current.version <= 0) {
      throw new Error("Migration versions must be positive integers");
    }
    if (index > 0 && migrations[index - 1].version >= current.version) {
      throw new Error(`Duplicate or out-of-order migration version: ${current.version}`);
    }
  }
  return migrations;
}

export class ProjectStore {
  readonly database: Database.Database;

  constructor(options: {
    databasePath: string;
    project: ProjectSummary;
    migrationsUrl?: URL;
  }) {
    mkdirSync(dirname(options.databasePath), { recursive: true });
    this.database = new Database(options.databasePath);

    try {
      this.database.pragma("foreign_keys = ON");
      this.database.pragma("journal_mode = WAL");
      this.database.pragma("busy_timeout = 5000");
      this.applyMigrations(options.migrationsUrl ?? resolveDefaultMigrationsUrl());
      this.database.prepare(`
        INSERT OR IGNORE INTO projects (id, name, created_at, updated_at)
        VALUES (?, ?, ?, ?)
      `).run(
        options.project.id,
        options.project.name,
        options.project.createdAt,
        options.project.updatedAt,
      );
    } catch (error) {
      this.database.close();
      throw error;
    }
  }

  private applyMigrations(migrationsUrl: URL): void {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      )
    `);
    const appliedVersions = (
      this.database.prepare(
        "SELECT version FROM schema_migrations ORDER BY version",
      ).all() as Array<{ version: number }>
    ).map(({ version }) => version);
    const migrations = discoverMigrations(migrationsUrl);

    const isOrderedPrefix =
      appliedVersions.length <= migrations.length &&
      appliedVersions.every((version, index) => migrations[index]?.version === version);
    if (!isOrderedPrefix) {
      throw new Error("Project migration history is invalid");
    }

    for (const migration of migrations.slice(appliedVersions.length)) {
      this.database.transaction(() => {
        this.database.exec(migration.sql);
        this.database.prepare(
          "INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)",
        ).run(migration.version, new Date().toISOString());
      })();
    }
  }

  getProject(): StoredProject {
    const row = this.database.prepare(`
      SELECT id, name, created_at, updated_at, retention_days, retention_count
      FROM projects
      LIMIT 1
    `).get() as {
      id: string;
      name: string;
      created_at: string;
      updated_at: string;
      retention_days: number;
      retention_count: number;
    } | undefined;
    if (row === undefined) throw new Error("Project metadata is missing");
    return {
      id: row.id,
      name: row.name,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      retentionDays: row.retention_days,
      retentionCount: row.retention_count,
    };
  }

  close(): void {
    this.database.close();
  }
}
