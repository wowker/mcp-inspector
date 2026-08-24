import { createHash } from "node:crypto";
import type { ProjectStore } from "../projects/project-store.js";
import { RunEventBus } from "./run-event-bus.js";
import type { RunDetail, RunError, RunEvent, RunPage, RunStatus, RunSummary } from "./run-types.js";

interface RunRow {
  id: string; project_id: string; connection_id: string; tab_id: string | null; tool_name: string;
  tool_snapshot_id: string; idempotency_key: string; status: RunStatus; created_at: string;
  started_at: string | null; completed_at: string | null; duration_ms: number | null;
  network_duration_ms: number | null; protocol_version: string | null;
  server_info_json: string | null; client_info_json: string;
}
interface RequestRow { arguments_json: string; jsonrpc_json: string; http_json: string | null }
interface ResponseRow { result_json: string | null; error_json: string | null; truncated: number; original_bytes: number | null }
interface EventRow { run_id: string; sequence: number; kind: string; occurred_at: string; payload_json: string }

const columns = `id, project_id, connection_id, tab_id, tool_name, tool_snapshot_id,
  idempotency_key, status, created_at, started_at, completed_at, duration_ms,
  network_duration_ms, protocol_version, server_info_json, client_info_json`;
const active: RunStatus[] = ["queued", "connecting", "authorizing", "running"];

function parseJson(text: string, label: string): unknown {
  try { return JSON.parse(text) as unknown; } catch { throw new Error(`Stored Run ${label} is corrupt`); }
}
function objectJson(text: string, label: string): Record<string, unknown> {
  const parsed = parseJson(text, label);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error(`Stored Run ${label} is invalid`);
  return parsed as Record<string, unknown>;
}
function summary(row: RunRow): RunSummary {
  return { id: row.id, projectId: row.project_id, connectionId: row.connection_id, tabId: row.tab_id,
    toolName: row.tool_name, toolSnapshotId: row.tool_snapshot_id, idempotencyKey: row.idempotency_key,
    status: row.status, createdAt: row.created_at, startedAt: row.started_at, completedAt: row.completed_at,
    durationMs: row.duration_ms, networkDurationMs: row.network_duration_ms };
}
function event(row: EventRow): RunEvent {
  return { runId: row.run_id, sequence: row.sequence, kind: row.kind, occurredAt: row.occurred_at,
    payload: parseJson(row.payload_json, "event payload") };
}

export interface NewRun {
  id: string; projectId: string; connectionId: string; tabId: string; toolName: string; toolSnapshotId: string;
  idempotencyKey: string; canonicalArguments: string; jsonrpc: unknown; clientInfo: Record<string, unknown>; createdAt: string;
}
export interface ExistingIdentity { tabId: string | null; toolSnapshotId: string; canonicalArguments: string }

export class RunRepository {
  private readonly maxResponseBytes: number;
  constructor(private readonly store: ProjectStore, private readonly bus: RunEventBus,
    options: { maxResponseBytes?: number } = {}) {
    this.maxResponseBytes = options.maxResponseBytes ?? 25 * 1024 * 1024;
    if (!Number.isSafeInteger(this.maxResponseBytes) || this.maxResponseBytes < 1) throw new Error("Response limit is invalid");
  }

  create(input: NewRun): { run: RunSummary; created: boolean; identity: ExistingIdentity } {
    const operation = this.store.database.transaction(() => {
      const inserted = this.store.database.prepare(`INSERT INTO runs
        (id, project_id, connection_id, tab_id, tool_name, tool_snapshot_id, idempotency_key,
         status, created_at, client_info_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?)
        ON CONFLICT(project_id, idempotency_key) DO NOTHING`)
        .run(input.id, input.projectId, input.connectionId, input.tabId, input.toolName,
          input.toolSnapshotId, input.idempotencyKey, input.createdAt, JSON.stringify(input.clientInfo));
      if (inserted.changes === 0) {
        const previous = this.byIdempotency(input.projectId, input.idempotencyKey);
        if (previous === null) throw new Error("Conflicting Run could not be read");
        return { run: previous.run, created: false, identity: previous.identity, queuedEvent: null };
      }
      this.store.database.prepare(`INSERT INTO run_requests (run_id, arguments_json, jsonrpc_json, http_json)
        VALUES (?, ?, ?, NULL)`).run(input.id, input.canonicalArguments, JSON.stringify(input.jsonrpc));
      const queuedEvent: RunEvent = { runId: input.id, sequence: 1, kind: "run-status",
        occurredAt: input.createdAt, payload: { status: "queued" } };
      this.store.database.prepare(`INSERT INTO run_events (run_id, sequence, kind, occurred_at, payload_json)
        VALUES (?, 1, 'run-status', ?, ?)`).run(input.id, input.createdAt, JSON.stringify(queuedEvent.payload));
      const created = this.getSummary(input.projectId, input.id);
      if (created === null) throw new Error("Run was not persisted");
      return { run: created, created: true,
        identity: { tabId: input.tabId, toolSnapshotId: input.toolSnapshotId, canonicalArguments: input.canonicalArguments }, queuedEvent };
    });
    const result = operation();
    if (result.queuedEvent !== null) this.bus.publish(result.queuedEvent);
    return { run: result.run, created: result.created, identity: result.identity };
  }

  private byIdempotency(projectId: string, key: string): { run: RunSummary; identity: ExistingIdentity } | null {
    const row = this.store.database.prepare(`SELECT ${columns}, q.arguments_json
      FROM runs r JOIN run_requests q ON q.run_id = r.id
      WHERE r.project_id = ? AND r.idempotency_key = ?`).get(projectId, key) as (RunRow & { arguments_json: string }) | undefined;
    return row === undefined ? null : { run: summary(row), identity: {
      tabId: row.tab_id, toolSnapshotId: row.tool_snapshot_id, canonicalArguments: row.arguments_json,
    } };
  }

  getSummary(projectId: string, runId: string): RunSummary | null {
    const row = this.store.database.prepare(`SELECT ${columns} FROM runs WHERE project_id = ? AND id = ?`)
      .get(projectId, runId) as RunRow | undefined;
    return row === undefined ? null : summary(row);
  }

  get(projectId: string, runId: string): RunDetail | null {
    const row = this.store.database.prepare(`SELECT ${columns} FROM runs WHERE project_id = ? AND id = ?`)
      .get(projectId, runId) as RunRow | undefined;
    if (row === undefined) return null;
    const request = this.store.database.prepare(`SELECT arguments_json, jsonrpc_json, http_json FROM run_requests WHERE run_id = ?`)
      .get(runId) as RequestRow | undefined;
    if (request === undefined) throw new Error("Stored Run request is missing");
    const response = this.store.database.prepare(`SELECT result_json, error_json, truncated, original_bytes FROM run_responses WHERE run_id = ?`)
      .get(runId) as ResponseRow | undefined;
    let parsedError: RunError | null = null;
    if (response?.error_json !== null && response?.error_json !== undefined) {
      const rawError = objectJson(response.error_json, "error");
      if (typeof rawError.code !== "string" || typeof rawError.message !== "string") throw new Error("Stored Run error is invalid");
      parsedError = { code: rawError.code, message: rawError.message };
    }
    return { ...summary(row), protocolVersion: row.protocol_version,
      serverInfo: row.server_info_json === null ? null : objectJson(row.server_info_json, "server info"),
      clientInfo: objectJson(row.client_info_json, "client info"), request: {
        arguments: objectJson(request.arguments_json, "arguments"), jsonrpc: parseJson(request.jsonrpc_json, "JSON-RPC request"),
        http: request.http_json === null ? null : parseJson(request.http_json, "HTTP request"),
      }, response: response === undefined ? null : {
        result: response.result_json === null ? null : parseJson(response.result_json, "result"), error: parsedError,
        truncated: response.truncated === 1, originalBytes: response.original_bytes,
      }, events: this.events(runId, 0) };
  }

  transition(projectId: string, runId: string, from: RunStatus[], to: RunStatus, at: string,
    metadata?: { protocolVersion: string; serverInfo: Record<string, unknown> | null }): boolean {
    const placeholders = from.map(() => "?").join(",");
    const running = to === "running";
    const result = this.store.database.prepare(`UPDATE runs SET status = ?,
      started_at = CASE WHEN ? THEN COALESCE(started_at, ?) ELSE started_at END,
      protocol_version = CASE WHEN ? THEN ? ELSE protocol_version END,
      server_info_json = CASE WHEN ? THEN ? ELSE server_info_json END
      WHERE project_id = ? AND id = ? AND status IN (${placeholders})`).run(
        to, Number(running), at, Number(running), metadata?.protocolVersion ?? null,
        Number(running), metadata?.serverInfo === null || metadata?.serverInfo === undefined ? null : JSON.stringify(metadata.serverInfo),
        projectId, runId, ...from);
    return result.changes === 1;
  }

  private responseRecord(result: unknown | undefined): {
    resultJson: string | null; truncated: number; originalBytes: number | null;
  } {
    if (result === undefined) return { resultJson: null, truncated: 0, originalBytes: null };
    let json: string;
    try {
      json = JSON.stringify(result);
      if (json === undefined) throw new Error();
    } catch {
      return { resultJson: JSON.stringify({ unavailable: true, reason: "Result is not valid JSON" }),
        truncated: 1, originalBytes: null };
    }
    const originalBytes = Buffer.byteLength(json, "utf8");
    if (originalBytes <= this.maxResponseBytes) return { resultJson: json, truncated: 0, originalBytes };
    const isError = typeof result === "object" && result !== null && !Array.isArray(result) &&
      (result as Record<string, unknown>).isError === true;
    const descriptor = { ...(isError ? { isError: true } : {}), truncated: true, originalBytes,
      sha256: createHash("sha256").update(json).digest("hex"),
      preview: Array.from(json).slice(0, 256).join("") };
    return { resultJson: JSON.stringify(descriptor), truncated: 1, originalBytes };
  }

  finish(projectId: string, runId: string, status: "succeeded" | "failed" | "cancelled",
    at: string, durationMs: number, networkDurationMs: number | null,
    response: { result?: unknown; error?: RunError }): RunEvent | null {
    const stored = this.responseRecord(response.result);
    const completed = this.store.database.transaction(() => {
      const placeholders = active.map(() => "?").join(",");
      const changed = this.store.database.prepare(`UPDATE runs SET status = ?, completed_at = ?, duration_ms = ?, network_duration_ms = ?
        WHERE project_id = ? AND id = ? AND status IN (${placeholders})`)
        .run(status, at, durationMs, networkDurationMs, projectId, runId, ...active).changes;
      if (changed !== 1) return null;
      this.store.database.prepare(`INSERT INTO run_responses
        (run_id, result_json, error_json, truncated, original_bytes) VALUES (?, ?, ?, ?, ?)`)
        .run(runId, stored.resultJson, response.error === undefined ? null : JSON.stringify(response.error),
          stored.truncated, stored.originalBytes);
      this.store.database.prepare(`UPDATE debug_tabs SET last_run_id = ?, updated_at = ?
        WHERE project_id = ? AND id = (SELECT tab_id FROM runs WHERE id = ?)`)
        .run(runId, at, projectId, runId);
      const row = this.store.database.prepare("SELECT COALESCE(MAX(sequence), 0) + 1 AS sequence FROM run_events WHERE run_id = ?")
        .get(runId) as { sequence: number };
      const terminalEvent: RunEvent = { runId, sequence: row.sequence, kind: "run-status", occurredAt: at, payload: { status } };
      this.store.database.prepare(`INSERT INTO run_events (run_id, sequence, kind, occurred_at, payload_json)
        VALUES (?, ?, 'run-status', ?, ?)`).run(runId, row.sequence, at, JSON.stringify(terminalEvent.payload));
      return terminalEvent;
    })();
    if (completed !== null) this.bus.publish(completed);
    return completed;
  }

  failRecording(projectId: string, runId: string, at: string, durationMs: number,
    networkDurationMs: number | null, result?: unknown): boolean {
    const stored = this.responseRecord(result);
    const error = { code: "TRACE_PERSIST_FAILED", message: "Run recording failed" };
    const persist = (withEvent: boolean) => this.store.database.transaction(() => {
      const placeholders = active.map(() => "?").join(",");
      const changed = this.store.database.prepare(`UPDATE runs SET status = 'failed', completed_at = ?, duration_ms = ?, network_duration_ms = ?
        WHERE project_id = ? AND id = ? AND status IN (${placeholders})`)
        .run(at, durationMs, networkDurationMs, projectId, runId, ...active).changes;
      if (changed !== 1) return null;
      this.store.database.prepare(`INSERT INTO run_responses
        (run_id, result_json, error_json, truncated, original_bytes) VALUES (?, ?, ?, ?, ?)`)
        .run(runId, stored.resultJson, JSON.stringify(error), stored.truncated, stored.originalBytes);
      this.store.database.prepare(`UPDATE debug_tabs SET last_run_id = ?, updated_at = ?
        WHERE project_id = ? AND id = (SELECT tab_id FROM runs WHERE id = ?)`)
        .run(runId, at, projectId, runId);
      const row = this.store.database.prepare("SELECT COALESCE(MAX(sequence), 0) + 1 AS sequence FROM run_events WHERE run_id = ?")
        .get(runId) as { sequence: number };
      const failureEvent: RunEvent = { runId, sequence: row.sequence, kind: "run-status", occurredAt: at,
        payload: withEvent ? { status: "failed" } : { status: "failed", synthetic: true, code: error.code } };
      if (withEvent) {
        this.store.database.prepare(`INSERT INTO run_events (run_id, sequence, kind, occurred_at, payload_json)
          VALUES (?, ?, 'run-status', ?, ?)`).run(runId, row.sequence, at, JSON.stringify(failureEvent.payload));
      }
      return failureEvent;
    })();
    try {
      const persisted = persist(true);
      if (persisted === null) return false;
      this.bus.publish(persisted);
      return true;
    } catch {
      // This event is intentionally live-only: storage is known to reject terminal events.
      // The failed Run row and TRACE_PERSIST_FAILED response remain the reconnect authority.
      const lastResort = persist(false);
      if (lastResort === null) return false;
      this.bus.publish(lastResort);
      return true;
    }
  }

  append(runId: string, kind: string, occurredAt: string, payload: unknown): RunEvent | null {
    const created = this.store.database.transaction(() => {
      const run = this.store.database.prepare("SELECT status FROM runs WHERE id = ?").get(runId) as { status: RunStatus } | undefined;
      if (run === undefined) throw new Error("Run not found while appending an event");
      if (!active.includes(run.status)) return null;
      const row = this.store.database.prepare("SELECT COALESCE(MAX(sequence), 0) + 1 AS sequence FROM run_events WHERE run_id = ?")
        .get(runId) as { sequence: number };
      this.store.database.prepare(`INSERT INTO run_events (run_id, sequence, kind, occurred_at, payload_json)
        VALUES (?, ?, ?, ?, ?)`).run(runId, row.sequence, kind, occurredAt, JSON.stringify(payload));
      return { runId, sequence: row.sequence, kind, occurredAt, payload } satisfies RunEvent;
    })();
    if (created !== null) this.bus.publish(created);
    return created;
  }

  recordHttpRequest(runId: string, value: unknown, replace = false): void {
    this.store.database.prepare(`UPDATE run_requests SET http_json = ${replace ? "?" : "COALESCE(http_json, ?)"} WHERE run_id = ?`)
      .run(JSON.stringify(value), runId);
  }

  events(runId: string, after: number, limit?: number): RunEvent[] {
    return (this.store.database.prepare(`SELECT run_id, sequence, kind, occurred_at, payload_json
      FROM run_events WHERE run_id = ? AND sequence > ? ORDER BY sequence ${limit === undefined ? "" : "LIMIT ?"}`)
      .all(...(limit === undefined ? [runId, after] : [runId, after, limit])) as EventRow[]).map(event);
  }

  list(projectId: string, cursor?: string, limit = 50): RunPage {
    let boundary: { projectId: string; createdAt: string; id: string } | undefined;
    if (cursor !== undefined) {
      try {
        const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as unknown;
        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error();
        const value = parsed as Record<string, unknown>;
        if (value.projectId !== projectId || typeof value.createdAt !== "string" || Number.isNaN(Date.parse(value.createdAt)) ||
            new Date(value.createdAt).toISOString() !== value.createdAt ||
            typeof value.id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.id)) throw new Error();
        boundary = { projectId, createdAt: value.createdAt, id: value.id };
      } catch { throw new Error("Run cursor is invalid"); }
    }
    const rows = this.store.database.prepare(`SELECT ${columns} FROM runs WHERE project_id = ?
      ${boundary === undefined ? "" : "AND (created_at < ? OR (created_at = ? AND id < ?))"}
      ORDER BY created_at DESC, id DESC LIMIT ?`).all(...(boundary === undefined
        ? [projectId, limit + 1] : [projectId, boundary.createdAt, boundary.createdAt, boundary.id, limit + 1])) as RunRow[];
    const page = rows.slice(0, limit).map(summary);
    const last = page.at(-1);
    return { runs: page, nextCursor: rows.length > limit && last !== undefined
      ? Buffer.from(JSON.stringify({ projectId, createdAt: last.createdAt, id: last.id })).toString("base64url") : null };
  }
}
