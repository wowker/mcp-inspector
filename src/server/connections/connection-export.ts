import type { ProjectStore } from "../projects/project-store.js";
import type { ConnectionRecord } from "./connection-types.js";
import {
  parseServerExportEnvironment,
  type ServerExportEnvironment,
} from "../../shared/server-export.js";
import type { JsonValue } from "../../shared/tool-definition.js";
import { sanitizeSensitiveUrl } from "../../shared/sensitive-url.js";

type ExportRow = Record<string, unknown>;

export interface ServerExportBundle {
  format: "mcp-inspector-server-export";
  version: 2;
  exportedAt: string;
  security: {
    containsSensitiveToolData: false;
    omittedSensitiveToolData: readonly ["tab-drafts", "run-requests", "run-responses", "run-events", "saved-items"];
    oauthCredentialsIncluded: false;
    bearerTokenIncluded: false;
    customHeaderValuesIncluded: false;
    environmentSecretValuesIncluded: false;
  };
  project: { id: string; name: string };
  server: Omit<ConnectionRecord, "headers" | "bearerToken" | "status"> & {
    bearerToken: null;
    headers: Array<{ name: string; value: null; redacted: true }>;
  };
  data: {
    toolSnapshots: ExportRow[];
    tools: ExportRow[];
    folders: ExportRow[];
    folderAssignments: ExportRow[];
    tabs: ExportRow[];
    runs: ExportRow[];
    runRequests: ExportRow[];
    runResponses: ExportRow[];
    runEvents: ExportRow[];
    savedItems: ExportRow[];
    environment: ServerExportEnvironment;
  };
}

interface EnvironmentVariableRow {
  name: string;
  connection_id: string | null;
  value_json: string;
  secret: number;
}

interface EnvironmentProfileRow {
  id: string;
  name: string;
  description: string;
  parent_profile_id: string | null;
  revision: number;
}

interface EnvironmentProfileVariableRow {
  profile_id: string;
  name: string;
  connection_id: string | null;
  mode: "value" | "unset";
  value_json: string | null;
  secret: number;
}

function camelCase(value: string): string {
  return value.replace(/_([a-z])/g, (_match, letter: string) => letter.toUpperCase());
}

function parseJson(value: unknown, field: string): unknown {
  if (value === null) return null;
  if (typeof value !== "string") throw new Error(`Stored export field ${field} is invalid`);
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new Error(`Stored export field ${field} is corrupt`);
  }
}

function normalizeRow(row: ExportRow): ExportRow {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => {
    if (key.endsWith("_json")) {
      const name = camelCase(key.slice(0, -5));
      return [name, parseJson(value, key)];
    }
    return [camelCase(key), value];
  }));
}

function query(store: ProjectStore, sql: string, ...params: string[]): ExportRow[] {
  const rows = store.database.prepare(sql).all(...params) as ExportRow[];
  return rows.map(normalizeRow);
}

function exportedValue(row: EnvironmentVariableRow) {
  const scope = row.connection_id === null ? "project" as const : "server" as const;
  if (row.secret === 1) {
    return { name: row.name, scope, secret: true as const, redacted: true as const };
  }
  return {
    name: row.name,
    scope,
    secret: false as const,
    value: parseJson(row.value_json, "value_json") as JsonValue,
  };
}

function exportEnvironment(
  store: ProjectStore,
  projectId: string,
  connectionId: string,
): ServerExportEnvironment {
  const baseRows = store.database.prepare(`
    SELECT name, connection_id, value_json, secret
    FROM environment_variables
    WHERE project_id = ? AND (connection_id IS NULL OR connection_id = ?)
    ORDER BY connection_id IS NOT NULL, name COLLATE NOCASE, name
  `).all(projectId, connectionId) as EnvironmentVariableRow[];
  const profileRows = store.database.prepare(`
    SELECT id, name, description, parent_profile_id, revision
    FROM environment_profiles
    WHERE project_id = ?
    ORDER BY name COLLATE NOCASE, name, id
  `).all(projectId) as EnvironmentProfileRow[];
  const variableRows = store.database.prepare(`
    SELECT profile_id, connection_id, name, mode, value_json, secret
    FROM environment_profile_variables
    WHERE project_id = ? AND (connection_id IS NULL OR connection_id = ?)
    ORDER BY profile_id, connection_id IS NOT NULL, name COLLATE NOCASE, name, id
  `).all(projectId, connectionId) as EnvironmentProfileVariableRow[];
  const variablesByProfile = new Map<string, EnvironmentProfileVariableRow[]>();
  for (const row of variableRows) {
    const current = variablesByProfile.get(row.profile_id) ?? [];
    current.push(row);
    variablesByProfile.set(row.profile_id, current);
  }
  const active = store.database.prepare(`
    SELECT profile_id FROM connection_environment_profiles
    WHERE project_id = ? AND connection_id = ?
  `).get(projectId, connectionId) as { profile_id: string } | undefined;

  return parseServerExportEnvironment({
    activeProfileId: active?.profile_id ?? null,
    baseVariables: baseRows.map(exportedValue),
    profiles: profileRows.map((profile) => ({
      id: profile.id,
      name: profile.name,
      description: profile.description,
      parentProfileId: profile.parent_profile_id,
      revision: profile.revision,
      variables: (variablesByProfile.get(profile.id) ?? []).map((row) => {
        const scope = row.connection_id === null ? "project" as const : "server" as const;
        if (row.mode === "unset") {
          return { name: row.name, scope, mode: "unset" as const, secret: false as const };
        }
        return {
          ...exportedValue({ ...row, value_json: row.value_json! }),
          mode: "value" as const,
        };
      }),
    })),
  });
}

export function createServerExport(
  store: ProjectStore,
  connection: ConnectionRecord,
  exportedAt: string,
): ServerExportBundle {
  const project = store.getProject();
  const connectionId = connection.id;
  const projectId = connection.projectId;
  const { headers, bearerToken: _bearerToken, status: _status, ...configuration } = connection;

  return {
    format: "mcp-inspector-server-export",
    version: 2,
    exportedAt,
    security: {
      containsSensitiveToolData: false,
      omittedSensitiveToolData: ["tab-drafts", "run-requests", "run-responses", "run-events", "saved-items"],
      oauthCredentialsIncluded: false,
      bearerTokenIncluded: false,
      customHeaderValuesIncluded: false,
      environmentSecretValuesIncluded: false,
    },
    project: { id: project.id, name: project.name },
    server: {
      ...configuration,
      url: sanitizeSensitiveUrl(configuration.url),
      bearerToken: null,
      headers: Object.keys(headers).sort((left, right) => left.localeCompare(right))
        .map((name) => ({ name, value: null, redacted: true as const })),
    },
    data: {
      toolSnapshots: query(store, `SELECT * FROM tool_snapshots
        WHERE project_id = ? AND connection_id = ? ORDER BY created_at, id`, projectId, connectionId),
      tools: query(store, `SELECT * FROM tools
        WHERE project_id = ? AND connection_id = ? ORDER BY name`, projectId, connectionId),
      folders: query(store, `SELECT * FROM tool_folders
        WHERE project_id = ? AND connection_id = ? ORDER BY name COLLATE NOCASE, id`, projectId, connectionId),
      folderAssignments: query(store, `SELECT * FROM tool_folder_assignments
        WHERE project_id = ? AND connection_id = ? ORDER BY folder_id, tool_name`, projectId, connectionId),
      tabs: query(store, `SELECT * FROM debug_tabs
        WHERE project_id = ? AND connection_id = ? ORDER BY position, id`, projectId, connectionId)
        .map(({ viewState: _viewState, arguments: _arguments, rawText: _rawText, ...tab }) => tab),
      runs: query(store, `SELECT * FROM runs
        WHERE project_id = ? AND connection_id = ? ORDER BY created_at, id`, projectId, connectionId),
      runRequests: [],
      runResponses: [],
      runEvents: [],
      savedItems: [],
      environment: exportEnvironment(store, projectId, connectionId),
    },
  };
}
