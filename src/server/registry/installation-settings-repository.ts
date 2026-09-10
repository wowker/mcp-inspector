import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import { resolveRegistryPath } from "../projects/project-paths.js";
import { applyRegistryMigrations } from "./registry-migrator.js";

export interface InstallationAuthoringSettings {
  enabled: boolean;
  tokenDigest: string | null;
  tokenHint: string | null;
  tokenCreatedAt: string | null;
  tokenRotatedAt: string | null;
  updatedAt: string | null;
}

interface InstallationAuthoringSettingsRow {
  enabled: number;
  token_digest: string | null;
  token_hint: string | null;
  token_created_at: string | null;
  token_rotated_at: string | null;
  updated_at: string | null;
}

export class InstallationSettingsRepository {
  readonly database: Database.Database;

  constructor(options: { dataRoot: string; migrationsUrl?: URL }) {
    const registryPath = resolveRegistryPath(options.dataRoot);
    mkdirSync(dirname(registryPath), { recursive: true });
    this.database = new Database(registryPath);
    try {
      this.database.pragma("foreign_keys = ON");
      this.database.pragma("journal_mode = WAL");
      this.database.pragma("busy_timeout = 5000");
      applyRegistryMigrations(this.database, options.migrationsUrl);
    } catch (error) {
      this.database.close();
      throw error;
    }
  }

  getAuthoring(): InstallationAuthoringSettings {
    const row = this.database.prepare(`
      SELECT enabled, token_digest, token_hint, token_created_at, token_rotated_at, updated_at
      FROM authoring_settings
      WHERE installation_key = 1
    `).get() as InstallationAuthoringSettingsRow | undefined;
    if (row === undefined) {
      return {
        enabled: false,
        tokenDigest: null,
        tokenHint: null,
        tokenCreatedAt: null,
        tokenRotatedAt: null,
        updatedAt: null,
      };
    }
    return {
      enabled: row.enabled === 1,
      tokenDigest: row.token_digest,
      tokenHint: row.token_hint,
      tokenCreatedAt: row.token_created_at,
      tokenRotatedAt: row.token_rotated_at,
      updatedAt: row.updated_at,
    };
  }

  replaceAuthoring(settings: InstallationAuthoringSettings): void {
    this.database.prepare(`
      INSERT INTO authoring_settings (
        installation_key, enabled, token_digest, token_hint,
        token_created_at, token_rotated_at, updated_at
      ) VALUES (1, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(installation_key) DO UPDATE SET
        enabled = excluded.enabled,
        token_digest = excluded.token_digest,
        token_hint = excluded.token_hint,
        token_created_at = excluded.token_created_at,
        token_rotated_at = excluded.token_rotated_at,
        updated_at = excluded.updated_at
    `).run(
      settings.enabled ? 1 : 0,
      settings.tokenDigest,
      settings.tokenHint,
      settings.tokenCreatedAt,
      settings.tokenRotatedAt,
      settings.updatedAt,
    );
  }

  close(): void {
    this.database.close();
  }
}
