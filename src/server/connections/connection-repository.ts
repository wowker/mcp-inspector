import type { ProjectStore } from "../projects/project-store.js";
import type { ConnectionError, ConnectionRecord, CreateConnectionInput } from "./connection-types.js";

interface ConnectionRow {
  id: string;
  project_id: string;
  name: string;
  url: string;
  transport: string;
  auth_mode: string;
  timeout_ms: number;
  last_protocol_version: string | null;
  last_server_info_json: string | null;
  last_error_json: string | null;
}

function parseObject(value: string | null): Record<string, unknown> | null {
  if (value === null) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function parseError(value: string | null): ConnectionError | null {
  const parsed = parseObject(value);
  return parsed !== null && typeof parsed.code === "string" && typeof parsed.message === "string"
    ? { code: parsed.code, message: parsed.message }
    : null;
}

function toRecord(row: ConnectionRow): ConnectionRecord {
  if (row.transport !== "streamable-http" || row.auth_mode !== "none") {
    throw new Error("Connection configuration is not supported by this application version");
  }
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    url: row.url,
    transport: row.transport,
    authMode: row.auth_mode,
    timeoutMs: row.timeout_ms,
    status: "disconnected",
    lastProtocolVersion: row.last_protocol_version,
    lastServerInfo: parseObject(row.last_server_info_json),
    lastError: parseError(row.last_error_json),
  };
}

const columns = `
  id, project_id, name, url, transport, auth_mode, timeout_ms,
  last_protocol_version, last_server_info_json, last_error_json
`;

export class ConnectionRepository {
  constructor(private readonly store: ProjectStore) {}

  create(connection: CreateConnectionInput & {
    id: string;
    projectId: string;
    createdAt: string;
    updatedAt: string;
  }): ConnectionRecord {
    this.store.database.prepare(`
      INSERT INTO connections (
        id, project_id, name, url, transport, auth_mode, timeout_ms, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      connection.id,
      connection.projectId,
      connection.name,
      connection.url,
      connection.transport,
      connection.authMode,
      connection.timeoutMs,
      connection.createdAt,
      connection.updatedAt,
    );
    const created = this.store.database.prepare(`SELECT ${columns} FROM connections WHERE id = ? AND project_id = ?`)
      .get(connection.id, connection.projectId) as ConnectionRow | undefined;
    if (created === undefined) throw new Error("Connection was not persisted");
    return toRecord(created);
  }

  list(projectId: string): ConnectionRecord[] {
    const rows = this.store.database.prepare(`
      SELECT ${columns}
      FROM connections
      WHERE project_id = ?
      ORDER BY created_at, id
    `).all(projectId) as ConnectionRow[];
    return rows.map(toRecord);
  }

  delete(projectId: string, connectionId: string): boolean {
    const result = this.store.database.prepare(
      "DELETE FROM connections WHERE id = ? AND project_id = ?",
    ).run(connectionId, projectId);
    return result.changes === 1;
  }
}
