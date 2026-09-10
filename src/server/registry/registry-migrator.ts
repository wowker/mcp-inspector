import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type Database from "better-sqlite3";

interface RegistryMigration {
  version: number;
  name: string;
  checksum: string;
  sql: string;
}

export function resolveDefaultRegistryMigrationsUrl(
  moduleUrl: URL = new URL(import.meta.url),
): URL {
  const sourceLayout = new URL("./migrations/", moduleUrl);
  if (existsSync(fileURLToPath(sourceLayout))) return sourceLayout;
  const bundledLayout = new URL("./registry/migrations/", moduleUrl);
  if (existsSync(fileURLToPath(bundledLayout))) return bundledLayout;
  throw new Error("Registry migrations directory is missing");
}

function discoverRegistryMigrations(migrationsUrl: URL): RegistryMigration[] {
  const migrations = readdirSync(fileURLToPath(migrationsUrl))
    .filter((name) => name.endsWith(".sql"))
    .map((name) => {
      const match = /^(\d+)_.*\.sql$/.exec(name);
      if (match === null) throw new Error("Invalid registry migration filename");
      const sql = readFileSync(new URL(name, migrationsUrl), "utf8");
      return {
        version: Number.parseInt(match[1], 10),
        name,
        checksum: createHash("sha256").update(sql).digest("hex"),
        sql,
      };
    })
    .sort((left, right) => left.version - right.version);

  migrations.forEach((migration, index) => {
    if (migration.version !== index + 1) {
      throw new Error("Registry migration versions must be contiguous from 1");
    }
  });
  return migrations;
}

export function applyRegistryMigrations(
  database: Database.Database,
  migrationsUrl: URL = resolveDefaultRegistryMigrationsUrl(),
): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS registry_schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      checksum TEXT NOT NULL,
      applied_at TEXT NOT NULL
    )
  `);
  const migrations = discoverRegistryMigrations(migrationsUrl);
  const applied = database.prepare(`
    SELECT version, name, checksum
    FROM registry_schema_migrations
    ORDER BY version
  `).all() as Array<{ version: number; name: string; checksum: string }>;
  const validHistory = applied.length <= migrations.length && applied.every((record, index) => {
    const migration = migrations[index];
    return record.version === migration?.version &&
      record.name === migration.name &&
      record.checksum === migration.checksum;
  });
  if (!validHistory) throw new Error("Registry migration history is invalid");

  for (const migration of migrations.slice(applied.length)) {
    database.transaction(() => {
      database.exec(migration.sql);
      database.prepare(`
        INSERT INTO registry_schema_migrations (version, name, checksum, applied_at)
        VALUES (?, ?, ?, ?)
      `).run(migration.version, migration.name, migration.checksum, new Date().toISOString());
    })();
  }
}
