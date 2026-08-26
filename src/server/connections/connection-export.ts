import type { ProjectStore } from "../projects/project-store.js";
import type { ConnectionRecord } from "./connection-types.js";

type ExportRow = Record<string, unknown>;

export interface ServerExportBundle {
  format: "mcp-inspector-server-export";
  version: 1;
  exportedAt: string;
  security: {
    containsSensitiveToolData: true;
    oauthCredentialsIncluded: false;
    bearerTokenIncluded: false;
    customHeaderValuesIncluded: false;
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
  };
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
    version: 1,
    exportedAt,
    security: {
      containsSensitiveToolData: true,
      oauthCredentialsIncluded: false,
      bearerTokenIncluded: false,
      customHeaderValuesIncluded: false,
    },
    project: { id: project.id, name: project.name },
    server: {
      ...configuration,
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
        WHERE project_id = ? AND connection_id = ? ORDER BY position, id`, projectId, connectionId),
      runs: query(store, `SELECT * FROM runs
        WHERE project_id = ? AND connection_id = ? ORDER BY created_at, id`, projectId, connectionId),
      runRequests: query(store, `SELECT request.* FROM run_requests request
        JOIN runs run ON run.id = request.run_id
        WHERE run.project_id = ? AND run.connection_id = ? ORDER BY run.created_at, run.id`, projectId, connectionId),
      runResponses: query(store, `SELECT response.* FROM run_responses response
        JOIN runs run ON run.id = response.run_id
        WHERE run.project_id = ? AND run.connection_id = ? ORDER BY run.created_at, run.id`, projectId, connectionId),
      runEvents: query(store, `SELECT event.* FROM run_events event
        JOIN runs run ON run.id = event.run_id
        WHERE run.project_id = ? AND run.connection_id = ? ORDER BY run.created_at, run.id, event.sequence`, projectId, connectionId),
      savedItems: query(store, `SELECT * FROM saved_tool_items
        WHERE project_id = ? AND connection_id = ? ORDER BY created_at, id`, projectId, connectionId),
    },
  };
}
