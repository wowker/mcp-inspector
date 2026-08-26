import type { ProjectStore } from "../projects/project-store.js";
import { normalizeCustomHeaders } from "../../shared/custom-headers.js";
import type { ConnectionError, ConnectionRecord, CreateConnectionInput } from "./connection-types.js";
import { isValidBearerToken } from "../../shared/connection-auth.js";

interface ConnectionRow {
  id: string;
  project_id: string;
  name: string;
  url: string;
  transport: string;
  auth_mode: string;
  bearer_token: string | null;
  headers_json: string;
  redact_sensitive_info: number;
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
  if (row.transport !== "streamable-http" ||
      (row.auth_mode !== "none" && row.auth_mode !== "bearer" && row.auth_mode !== "oauth")) {
    throw new Error("Connection configuration is not supported by this application version");
  }
  const headers = parseObject(row.headers_json);
  if (row.auth_mode === "bearer" && !isValidBearerToken(row.bearer_token)) {
    throw new Error("Connection Bearer token is invalid");
  }
  const normalizedHeaders = normalizeCustomHeaders(headers, row.auth_mode);
  if (normalizedHeaders === null) {
    throw new Error("Connection custom headers are invalid");
  }
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    url: row.url,
    transport: row.transport,
    authMode: row.auth_mode,
    bearerToken: row.auth_mode === "bearer" ? row.bearer_token : null,
    headers: normalizedHeaders,
    redactSensitiveInfo: row.redact_sensitive_info === 1,
    timeoutMs: row.timeout_ms,
    status: "disconnected",
    lastProtocolVersion: row.last_protocol_version,
    lastServerInfo: parseObject(row.last_server_info_json),
    lastError: parseError(row.last_error_json),
  };
}

const columns = `
  id, project_id, name, url, transport, auth_mode, bearer_token, headers_json, redact_sensitive_info, timeout_ms,
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
        id, project_id, name, url, transport, auth_mode, bearer_token, headers_json, redact_sensitive_info, timeout_ms, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      connection.id,
      connection.projectId,
      connection.name,
      connection.url,
      connection.transport,
      connection.authMode,
      connection.bearerToken ?? null,
      JSON.stringify(connection.headers ?? {}),
      Number(connection.redactSensitiveInfo ?? true),
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

  get(projectId: string, connectionId: string): ConnectionRecord | null {
    const row = this.store.database.prepare(`
      SELECT ${columns} FROM connections WHERE id = ? AND project_id = ?
    `).get(connectionId, projectId) as ConnectionRow | undefined;
    return row === undefined ? null : toRecord(row);
  }

  update(connection: Pick<ConnectionRecord, "id" | "projectId" | "name" | "url" | "authMode" | "bearerToken" | "headers" | "redactSensitiveInfo" | "timeoutMs"> & {
    updatedAt: string;
    resetDiagnostics: boolean;
  }): ConnectionRecord | null {
    const result = this.store.database.prepare(`
      UPDATE connections
      SET name = ?, url = ?, auth_mode = ?, bearer_token = ?, headers_json = ?, redact_sensitive_info = ?, timeout_ms = ?, updated_at = ?,
          last_protocol_version = CASE WHEN ? THEN NULL ELSE last_protocol_version END,
          last_server_info_json = CASE WHEN ? THEN NULL ELSE last_server_info_json END,
          last_error_json = CASE WHEN ? THEN NULL ELSE last_error_json END
      WHERE id = ? AND project_id = ?
    `).run(
      connection.name,
      connection.url,
      connection.authMode,
      connection.bearerToken,
      JSON.stringify(connection.headers),
      Number(connection.redactSensitiveInfo),
      connection.timeoutMs,
      connection.updatedAt,
      Number(connection.resetDiagnostics),
      Number(connection.resetDiagnostics),
      Number(connection.resetDiagnostics),
      connection.id,
      connection.projectId,
    );
    if (result.changes !== 1) return null;
    return this.get(connection.projectId, connection.id);
  }

  recordSuccess(
    projectId: string,
    connectionId: string,
    protocolVersion: string,
    serverInfo: Record<string, unknown> | null,
  ): void {
    const result = this.store.database.prepare(`
      UPDATE connections
      SET last_protocol_version = ?, last_server_info_json = ?, last_error_json = NULL
      WHERE id = ? AND project_id = ?
    `).run(
      protocolVersion,
      serverInfo === null ? null : JSON.stringify(serverInfo),
      connectionId,
      projectId,
    );
    if (result.changes !== 1) throw new Error("Connection disappeared during initialization");
  }

  recordFailure(projectId: string, connectionId: string, error: ConnectionError): void {
    this.store.database.prepare(`
      UPDATE connections SET last_error_json = ? WHERE id = ? AND project_id = ?
    `).run(JSON.stringify(error), connectionId, projectId);
  }

  delete(projectId: string, connectionId: string): boolean {
    const result = this.store.database.prepare(
      "DELETE FROM connections WHERE id = ? AND project_id = ?",
    ).run(connectionId, projectId);
    return result.changes === 1;
  }
}
