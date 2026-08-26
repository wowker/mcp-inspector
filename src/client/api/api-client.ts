import { parseToolDefinition, type ToolDefinition } from "../../shared/tool-definition.js";
import { normalizeCustomHeaders } from "../../shared/custom-headers.js";

export interface ProjectSummary {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  lastOpenedAt: string | null;
}

export interface ConnectionSummary {
  id: string;
  projectId: string;
  name: string;
  url: string;
  transport: "streamable-http";
  authMode: "none" | "oauth";
  headers: Record<string, string>;
  timeoutMs: number;
  status: "disconnected" | "connecting" | "connected" | "failed";
  lastProtocolVersion: string | null;
  lastServerInfo: Record<string, unknown> | null;
  lastError: { code: string; message: string } | null;
}

export interface CreateConnectionRequest {
  name: string;
  url: string;
  transport: "streamable-http";
  authMode: "none" | "oauth";
  headers?: Record<string, string>;
  timeoutMs: number;
}

export type UpdateConnectionRequest = Partial<Pick<CreateConnectionRequest,
  "name" | "url" | "authMode" | "headers" | "timeoutMs">>;

export interface ToolSnapshotSummary {
  id: string;
  projectId: string;
  connectionId: string;
  toolName: string;
  contentHash: string;
  definition: ToolDefinition;
  createdAt: string;
}

export interface CatalogToolSummary {
  projectId: string;
  connectionId: string;
  name: string;
  status: "current" | "changed" | "removed";
  folderId: string | null;
  updatedAt: string;
  currentSnapshot: ToolSnapshotSummary;
}

export interface ToolFolderSummary {
  id: string;
  projectId: string;
  connectionId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface ToolDetailSummary {
  tool: CatalogToolSummary;
  snapshots: ToolSnapshotSummary[];
}

export interface DebugTabSummary {
  id: string;
  projectId: string;
  connectionId: string;
  toolName: string;
  title: string;
  position: number;
  pinned: boolean;
  inputMode: "form" | "raw";
  arguments: Record<string, unknown>;
  rawText: string;
  viewState: { editorScrollTop: number; resultScrollTop: number; splitRatio: number };
  lastRunId: string | null;
}

export type RunStatus = "queued" | "connecting" | "authorizing" | "running" |
  "succeeded" | "failed" | "cancelled" | "interrupted";
export interface RunEvent {
  runId: string; sequence: number; kind: string; occurredAt: string; payload: unknown;
}
export interface RunSummary {
  id: string; projectId: string; connectionId: string; tabId: string | null;
  toolName: string; toolSnapshotId: string; idempotencyKey: string; status: RunStatus;
  createdAt: string; startedAt: string | null; completedAt: string | null;
  durationMs: number | null; networkDurationMs: number | null;
}
export interface RunDetail extends RunSummary {
  toolSnapshotHash: string;
  protocolVersion: string | null;
  serverInfo: Record<string, unknown> | null;
  clientInfo: Record<string, unknown>;
  request: { arguments: Record<string, unknown>; jsonrpc: unknown; http: unknown | null };
  response: { result: unknown | null; error: { code: string; message: string } | null;
    truncated: boolean; originalBytes: number | null } | null;
  events: RunEvent[];
}
export interface RunPage { runs: RunSummary[]; nextCursor: string | null }
export interface RunListFilter { tabId?: string; connectionId?: string; toolName?: string }

export type SavedItemKind = "request" | "response";
export interface SavedItemSummary {
  id: string; projectId: string; connectionId: string; toolName: string; kind: SavedItemKind;
  name: string; description: string; sourceRunId: string | null; createdAt: string; updatedAt: string;
}
export interface SavedItemDetail extends SavedItemSummary { payload: unknown }
export interface SavedItemPage { items: SavedItemSummary[]; nextCursor: string | null }
export interface CreateSavedItemRequest {
  kind: SavedItemKind; name: string; description: string; payload: unknown; sourceRunId: string | null;
}

export type UpdateDebugTabRequest = Partial<Pick<DebugTabSummary,
  "title" | "pinned" | "inputMode" | "arguments" | "rawText" | "viewState" | "lastRunId">>;

export interface InspectorApiClient {
  listProjects(): Promise<ProjectSummary[]>;
  createProject(name: string): Promise<ProjectSummary>;
  openProject(projectId: string): Promise<ProjectSummary>;
  listConnections(projectId: string): Promise<ConnectionSummary[]>;
  createConnection(projectId: string, input: CreateConnectionRequest): Promise<ConnectionSummary>;
  updateConnection(projectId: string, connectionId: string, input: UpdateConnectionRequest): Promise<ConnectionSummary>;
  deleteConnection(projectId: string, connectionId: string): Promise<void>;
  connectConnection(projectId: string, connectionId: string): Promise<ConnectionSummary>;
  disconnectConnection(projectId: string, connectionId: string): Promise<ConnectionSummary>;
  listTools(projectId: string, connectionId: string): Promise<CatalogToolSummary[]>;
  refreshTools(projectId: string, connectionId: string): Promise<CatalogToolSummary[]>;
  getTool(projectId: string, connectionId: string, toolName: string): Promise<ToolDetailSummary>;
  deleteTool(projectId: string, connectionId: string, toolName: string): Promise<void>;
  listToolFolders(projectId: string, connectionId: string): Promise<ToolFolderSummary[]>;
  createToolFolder(projectId: string, connectionId: string, name: string): Promise<ToolFolderSummary>;
  renameToolFolder(projectId: string, connectionId: string, folderId: string, name: string): Promise<ToolFolderSummary>;
  deleteToolFolder(projectId: string, connectionId: string, folderId: string): Promise<void>;
  moveToolToFolder(projectId: string, connectionId: string, toolName: string, folderId: string | null): Promise<CatalogToolSummary>;
  listTabs(projectId: string): Promise<DebugTabSummary[]>;
  openTab(projectId: string, connectionId: string, toolName: string): Promise<DebugTabSummary>;
  replaceTabTool(projectId: string, tabId: string, connectionId: string, toolName: string): Promise<DebugTabSummary>;
  updateTab(projectId: string, tabId: string, patch: UpdateDebugTabRequest): Promise<DebugTabSummary>;
  duplicateTab(projectId: string, tabId: string): Promise<DebugTabSummary>;
  reorderTabs(projectId: string, tabIds: string[]): Promise<DebugTabSummary[]>;
  closeTab(projectId: string, tabId: string): Promise<void>;
  closeOtherTabs(projectId: string, tabId: string): Promise<DebugTabSummary[]>;
  closeTabsRight(projectId: string, tabId: string): Promise<DebugTabSummary[]>;
  startRun(projectId: string, tabId: string, idempotencyKey: string, args: Record<string, unknown>): Promise<RunSummary>;
  getRunSummary(projectId: string, runId: string, signal?: AbortSignal): Promise<RunSummary>;
  getRun(projectId: string, runId: string, signal?: AbortSignal): Promise<RunDetail>;
  listRuns(projectId: string, cursor?: string, filter?: RunListFilter): Promise<RunPage>;
  openRunEventStream(projectId: string, runId: string, after: number, signal: AbortSignal): Promise<Response>;
  listSavedItems(projectId: string, connectionId: string, toolName: string, cursor?: string): Promise<SavedItemPage>;
  getSavedItem(projectId: string, connectionId: string, toolName: string, itemId: string): Promise<SavedItemDetail>;
  createSavedItem(projectId: string, connectionId: string, toolName: string, input: CreateSavedItemRequest): Promise<SavedItemDetail>;
  deleteSavedItem(projectId: string, connectionId: string, toolName: string, itemId: string): Promise<void>;
}

interface ApiErrorBody {
  error?: { message?: unknown };
}

async function decodeResponse<T>(response: Response): Promise<T> {
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    if (!response.ok) throw new Error(`Request failed (${response.status})`);
    throw new Error("Invalid response");
  }
  if (!response.ok) {
    const message = (payload as ApiErrorBody)?.error?.message;
    throw new Error(typeof message === "string" ? message : `Request failed (${response.status})`);
  }
  return payload as T;
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNullableObject(value: unknown): value is Record<string, unknown> | null {
  return value === null || isObject(value);
}

function isConnectionStatus(value: unknown): value is ConnectionSummary["status"] {
  return value === "disconnected" || value === "connecting" ||
    value === "connected" || value === "failed";
}

function decodeConnection(value: unknown, projectId: string): ConnectionSummary {
  if (!isObject(value)) throw new Error("Invalid connection response");
  const {
    id,
    projectId: recordProjectId,
    name,
    url: rawUrl,
    transport,
    authMode,
    headers,
    timeoutMs,
    status,
    lastProtocolVersion,
    lastServerInfo,
    lastError,
  } = value;
  if (typeof rawUrl !== "string") throw new Error("Invalid connection response");
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(rawUrl);
  } catch {
    throw new Error("Invalid connection response");
  }
  const validError = lastError === null || (
    isObject(lastError) &&
    typeof lastError.code === "string" &&
    typeof lastError.message === "string"
  );
  const normalizedHeaders = normalizeCustomHeaders(headers, authMode === "oauth" ? "oauth" : "none");
  if (
    typeof id !== "string" || !uuidPattern.test(id) ||
    typeof recordProjectId !== "string" || !uuidPattern.test(recordProjectId) ||
    recordProjectId !== projectId ||
    typeof name !== "string" || name.trim() !== name || name.length < 1 || name.length > 120 ||
    (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") ||
    parsedUrl.hostname.length === 0 || parsedUrl.username.length > 0 || parsedUrl.password.length > 0 ||
    transport !== "streamable-http" || (authMode !== "none" && authMode !== "oauth") || !isConnectionStatus(status) ||
    typeof timeoutMs !== "number" || !Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 600_000 ||
    !(lastProtocolVersion === null || typeof lastProtocolVersion === "string") ||
    !isNullableObject(lastServerInfo) || !validError || normalizedHeaders === null
  ) {
    throw new Error("Invalid connection response");
  }
  return {
    id,
    projectId: recordProjectId,
    name,
    url: rawUrl,
    transport,
    authMode,
    headers: normalizedHeaders,
    timeoutMs,
    status,
    lastProtocolVersion,
    lastServerInfo,
    lastError: lastError === null
      ? null
      : { code: lastError.code as string, message: lastError.message as string },
  };
}

async function decodeConnectionResponse(response: Response): Promise<unknown> {
  try {
    return await decodeResponse<unknown>(response);
  } catch (error) {
    if (response.ok) throw new Error("Invalid connection response");
    throw error;
  }
}

function decodeConnectionList(value: unknown, projectId: string): ConnectionSummary[] {
  if (!isObject(value) || !Array.isArray(value.connections)) {
    throw new Error("Invalid connection response");
  }
  return value.connections.map((connection) => decodeConnection(connection, projectId));
}

function decodeCreatedConnection(value: unknown, projectId: string): ConnectionSummary {
  if (!isObject(value) || !("connection" in value)) {
    throw new Error("Invalid connection response");
  }
  return decodeConnection(value.connection, projectId);
}

function isCanonicalUtcTimestamp(value: unknown): value is string {
  if (typeof value !== "string" ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false;
  const epoch = Date.parse(value);
  return Number.isFinite(epoch) && new Date(epoch).toISOString() === value;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (isObject(value)) {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function decodeSnapshot(
  value: unknown,
  projectId: string,
  connectionId: string,
  toolName: string,
): ToolSnapshotSummary {
  if (!isObject(value)) throw new Error("Invalid Tool response");
  const { id, projectId: owner, connectionId: connection, toolName: name,
    contentHash, definition, createdAt } = value;
  let parsedDefinition: ToolDefinition;
  try {
    parsedDefinition = parseToolDefinition(definition);
  } catch {
    throw new Error("Invalid Tool response");
  }
  if (
    !uuidPattern.test(projectId) || !uuidPattern.test(connectionId) ||
    typeof id !== "string" || !uuidPattern.test(id) || owner !== projectId ||
    connection !== connectionId || name !== toolName ||
    typeof contentHash !== "string" || !/^[a-f0-9]{64}$/.test(contentHash) ||
    parsedDefinition.name !== toolName || !isCanonicalUtcTimestamp(createdAt)
  ) throw new Error("Invalid Tool response");
  return { id, projectId, connectionId, toolName, contentHash,
    definition: parsedDefinition, createdAt };
}

function decodeTool(value: unknown, projectId: string, connectionId: string): CatalogToolSummary {
  if (!isObject(value)) throw new Error("Invalid Tool response");
  const { projectId: owner, connectionId: connection, name, status, folderId, updatedAt, currentSnapshot } = value;
  if (owner !== projectId || connection !== connectionId || typeof name !== "string" || name.length === 0 ||
      (status !== "current" && status !== "changed" && status !== "removed") ||
      !(folderId === null || (typeof folderId === "string" && uuidPattern.test(folderId))) ||
      !isCanonicalUtcTimestamp(updatedAt)) {
    throw new Error("Invalid Tool response");
  }
  return {
    projectId, connectionId, name, status, folderId, updatedAt,
    currentSnapshot: decodeSnapshot(currentSnapshot, projectId, connectionId, name),
  };
}

function decodeToolFolder(value: unknown, projectId: string, connectionId: string): ToolFolderSummary {
  if (!isObject(value)) throw new Error("Invalid Tool folder response");
  const { id, projectId: owner, connectionId: connection, name, createdAt, updatedAt } = value;
  if (typeof id !== "string" || !uuidPattern.test(id) || owner !== projectId || connection !== connectionId ||
      typeof name !== "string" || name !== name.trim() || name.length === 0 || name.length > 80 ||
      /[\u0000-\u001f\u007f]/u.test(name) || !isCanonicalUtcTimestamp(createdAt) || !isCanonicalUtcTimestamp(updatedAt)) {
    throw new Error("Invalid Tool folder response");
  }
  return { id, projectId, connectionId, name, createdAt, updatedAt };
}

function decodeToolFolders(value: unknown, projectId: string, connectionId: string): ToolFolderSummary[] {
  if (!isObject(value) || !Array.isArray(value.folders)) throw new Error("Invalid Tool folder response");
  const folders = value.folders.map((folder) => decodeToolFolder(folder, projectId, connectionId));
  if (new Set(folders.map(({ id }) => id)).size !== folders.length ||
      new Set(folders.map(({ name }) => name.toLocaleLowerCase())).size !== folders.length) {
    throw new Error("Invalid Tool folder response");
  }
  return folders;
}

function decodeToolList(value: unknown, projectId: string, connectionId: string): CatalogToolSummary[] {
  if (!isObject(value) || !Array.isArray(value.tools)) throw new Error("Invalid Tool response");
  const decoded = value.tools.map((tool) => decodeTool(tool, projectId, connectionId));
  if (new Set(decoded.map(({ name }) => name)).size !== decoded.length) {
    throw new Error("Invalid Tool response");
  }
  return decoded;
}

function decodeToolDetail(value: unknown, projectId: string, connectionId: string, toolName: string): ToolDetailSummary {
  if (!isObject(value) || !isObject(value.detail)) {
    throw new Error("Invalid Tool response");
  }
  const detail = value.detail;
  const snapshotValues = detail.snapshots;
  if (!Array.isArray(snapshotValues)) throw new Error("Invalid Tool response");
  const tool = decodeTool(detail.tool, projectId, connectionId);
  if (tool.name !== toolName) throw new Error("Invalid Tool response");
  const snapshots = snapshotValues.map((snapshot: unknown) =>
    decodeSnapshot(snapshot, projectId, connectionId, toolName));
  const snapshotIds = new Set<string>();
  for (let index = 1; index < snapshots.length; index += 1) {
    const previous = snapshots[index - 1];
    const current = snapshots[index];
    const previousEpoch = Date.parse(previous.createdAt);
    const currentEpoch = Date.parse(current.createdAt);
    if (previousEpoch > currentEpoch ||
        (previousEpoch === currentEpoch && previous.id >= current.id)) {
      throw new Error("Invalid Tool response");
    }
  }
  for (const snapshot of snapshots) {
    if (snapshotIds.has(snapshot.id)) throw new Error("Invalid Tool response");
    snapshotIds.add(snapshot.id);
  }
  const currentHistorySnapshot = snapshots.find(({ id }) => id === tool.currentSnapshot.id);
  if (currentHistorySnapshot === undefined ||
      stableJson(currentHistorySnapshot) !== stableJson(tool.currentSnapshot)) {
    throw new Error("Invalid Tool response");
  }
  return { tool, snapshots };
}

function decodeTab(value: unknown, projectId: string): DebugTabSummary {
  if (!isObject(value)) throw new Error("Invalid Tab response");
  const { id, projectId: owner, connectionId, toolName, title, position, pinned, inputMode,
    arguments: args, rawText, viewState, lastRunId } = value;
  if (typeof id !== "string" || !uuidPattern.test(id) || owner !== projectId ||
      typeof connectionId !== "string" || !uuidPattern.test(connectionId) || typeof toolName !== "string" || toolName.trim().length === 0 || toolName.length > 512 ||
      typeof title !== "string" || title.trim().length === 0 || title.length > 180 || !Number.isInteger(position) || (position as number) < 0 ||
      typeof pinned !== "boolean" || (inputMode !== "form" && inputMode !== "raw") || !isObject(args) ||
      typeof rawText !== "string" || rawText.length > 2_000_000 || !isObject(viewState) ||
      typeof viewState.editorScrollTop !== "number" || !Number.isFinite(viewState.editorScrollTop) || viewState.editorScrollTop < 0 ||
      typeof viewState.resultScrollTop !== "number" || !Number.isFinite(viewState.resultScrollTop) || viewState.resultScrollTop < 0 ||
      typeof viewState.splitRatio !== "number" || !Number.isFinite(viewState.splitRatio) || viewState.splitRatio < 0.2 || viewState.splitRatio > 0.8 ||
      !(lastRunId === null || (typeof lastRunId === "string" && uuidPattern.test(lastRunId)))) {
    throw new Error("Invalid Tab response");
  }
  return { id, projectId, connectionId, toolName, title, position: position as number, pinned, inputMode,
    arguments: args, rawText, viewState: { editorScrollTop: viewState.editorScrollTop,
      resultScrollTop: viewState.resultScrollTop, splitRatio: viewState.splitRatio }, lastRunId };
}

function decodeTabs(value: unknown, projectId: string): DebugTabSummary[] {
  if (!isObject(value) || !Array.isArray(value.tabs)) throw new Error("Invalid Tab response");
  const tabs = value.tabs.map((item) => decodeTab(item, projectId));
  if (new Set(tabs.map(({ id }) => id)).size !== tabs.length || tabs.some((tab, index) => tab.position !== index)) {
    throw new Error("Invalid Tab response");
  }
  return tabs;
}

function decodeTabEnvelope(value: unknown, projectId: string): DebugTabSummary {
  if (!isObject(value) || !("tab" in value)) throw new Error("Invalid Tab response");
  return decodeTab(value.tab, projectId);
}

const runStatuses = new Set<RunStatus>(["queued", "connecting", "authorizing", "running",
  "succeeded", "failed", "cancelled", "interrupted"]);
function nullableTimestamp(value: unknown): value is string | null {
  return value === null || isCanonicalUtcTimestamp(value);
}
function nullableDuration(value: unknown): value is number | null {
  return value === null || (typeof value === "number" && Number.isSafeInteger(value) && value >= 0);
}
function decodeRunSummary(value: unknown, projectId: string): RunSummary {
  if (!isObject(value)) throw new Error("Invalid Run response");
  const { id, projectId: owner, connectionId, tabId, toolName, toolSnapshotId, idempotencyKey, status,
    createdAt, startedAt, completedAt, durationMs, networkDurationMs } = value;
  if (typeof id !== "string" || !uuidPattern.test(id) || owner !== projectId ||
      typeof connectionId !== "string" || !uuidPattern.test(connectionId) ||
      !(tabId === null || (typeof tabId === "string" && uuidPattern.test(tabId))) ||
      typeof toolName !== "string" || toolName.length === 0 || typeof toolSnapshotId !== "string" || !uuidPattern.test(toolSnapshotId) ||
      typeof idempotencyKey !== "string" || idempotencyKey.length === 0 || typeof status !== "string" || !runStatuses.has(status as RunStatus) ||
      !isCanonicalUtcTimestamp(createdAt) || !nullableTimestamp(startedAt) || !nullableTimestamp(completedAt) ||
      !nullableDuration(durationMs) || !nullableDuration(networkDurationMs)) throw new Error("Invalid Run response");
  return { id, projectId, connectionId, tabId, toolName, toolSnapshotId, idempotencyKey, status: status as RunStatus,
    createdAt, startedAt, completedAt, durationMs, networkDurationMs };
}

export function decodeRunEvent(value: unknown, runId: string): RunEvent {
  if (!isObject(value) || value.runId !== runId || !Number.isSafeInteger(value.sequence) || (value.sequence as number) < 1 ||
      typeof value.kind !== "string" || value.kind.length === 0 || !isCanonicalUtcTimestamp(value.occurredAt)) {
    throw new Error("Invalid Run event");
  }
  return { runId, sequence: value.sequence as number, kind: value.kind, occurredAt: value.occurredAt as string, payload: value.payload };
}

function decodeRunDetail(value: unknown, projectId: string): RunDetail {
  if (!isObject(value) || !isObject(value.run)) throw new Error("Invalid Run response");
  const raw = value.run; const base = decodeRunSummary(raw, projectId);
  if (typeof raw.toolSnapshotHash !== "string" || !/^[a-f0-9]{64}$/.test(raw.toolSnapshotHash) ||
      !(raw.protocolVersion === null || typeof raw.protocolVersion === "string") || !isNullableObject(raw.serverInfo) ||
      !isObject(raw.clientInfo) || !isObject(raw.request) || !isObject(raw.request.arguments) ||
      !("jsonrpc" in raw.request) || !("http" in raw.request) || !Array.isArray(raw.events)) throw new Error("Invalid Run response");
  const events = raw.events.map((event) => decodeRunEvent(event, base.id));
  if (events.some((event, index) => index > 0 && event.sequence <= events[index - 1]!.sequence)) throw new Error("Invalid Run response");
  let response: RunDetail["response"] = null;
  if (raw.response !== null) {
    if (!isObject(raw.response) || typeof raw.response.truncated !== "boolean" ||
        !(raw.response.originalBytes === null || (Number.isSafeInteger(raw.response.originalBytes) && (raw.response.originalBytes as number) >= 0)) ||
        !(raw.response.error === null || (isObject(raw.response.error) && typeof raw.response.error.code === "string" && typeof raw.response.error.message === "string"))) {
      throw new Error("Invalid Run response");
    }
    response = { result: raw.response.result ?? null,
      error: raw.response.error === null ? null : { code: raw.response.error.code as string, message: raw.response.error.message as string },
      truncated: raw.response.truncated, originalBytes: raw.response.originalBytes as number | null };
  }
  return { ...base, toolSnapshotHash: raw.toolSnapshotHash, protocolVersion: raw.protocolVersion as string | null,
    serverInfo: raw.serverInfo as Record<string, unknown> | null, clientInfo: raw.clientInfo,
    request: { arguments: raw.request.arguments, jsonrpc: raw.request.jsonrpc, http: raw.request.http ?? null }, response, events };
}

function decodeRunPage(value: unknown, projectId: string, filter: RunListFilter = {}): RunPage {
  if (!isObject(value) || !Array.isArray(value.runs) || !(value.nextCursor === null ||
      (typeof value.nextCursor === "string" && value.nextCursor.length > 0 && value.nextCursor.length <= 4096 && /^[A-Za-z0-9_-]+$/.test(value.nextCursor)))) {
    throw new Error("Invalid Run response");
  }
  const runs = value.runs.map((run) => decodeRunSummary(run, projectId));
  if (filter.tabId !== undefined && runs.some((run) => run.tabId !== filter.tabId)) throw new Error("Invalid Run response");
  if (filter.connectionId !== undefined && runs.some((run) => run.connectionId !== filter.connectionId)) throw new Error("Invalid Run response");
  if (filter.toolName !== undefined && runs.some((run) => run.toolName !== filter.toolName)) throw new Error("Invalid Run response");
  if (new Set(runs.map(({ id }) => id)).size !== runs.length) throw new Error("Invalid Run response");
  if (runs.some((run, index) => index > 0 && (run.createdAt > runs[index - 1]!.createdAt ||
      (run.createdAt === runs[index - 1]!.createdAt && run.id >= runs[index - 1]!.id)))) throw new Error("Invalid Run response");
  return { runs, nextCursor: value.nextCursor as string | null };
}

function decodeSavedItemSummary(value: unknown, projectId: string, connectionId: string, toolName: string): SavedItemSummary {
  if (!isObject(value)) throw new Error("Invalid saved item response");
  const { id, projectId: itemProjectId, connectionId: itemConnectionId, toolName: itemToolName, kind,
    name, description, sourceRunId, createdAt, updatedAt } = value;
  if (typeof id !== "string" || !uuidPattern.test(id) || itemProjectId !== projectId || itemConnectionId !== connectionId ||
      itemToolName !== toolName || (kind !== "request" && kind !== "response") || typeof name !== "string" ||
      name.trim() !== name || name.length < 1 || name.length > 120 || typeof description !== "string" || description.length > 1000 ||
      !(sourceRunId === null || (typeof sourceRunId === "string" && uuidPattern.test(sourceRunId))) ||
      typeof createdAt !== "string" || !Number.isFinite(Date.parse(createdAt)) || typeof updatedAt !== "string" || !Number.isFinite(Date.parse(updatedAt))) {
    throw new Error("Invalid saved item response");
  }
  return { id, projectId, connectionId, toolName, kind, name, description, sourceRunId, createdAt, updatedAt };
}

function decodeSavedItemDetail(value: unknown, projectId: string, connectionId: string, toolName: string, itemId?: string): SavedItemDetail {
  const summary = decodeSavedItemSummary(value, projectId, connectionId, toolName);
  if (!isObject(value) || !("payload" in value) || (itemId !== undefined && summary.id !== itemId) ||
      (summary.kind === "request" && (!isObject(value.payload)))) throw new Error("Invalid saved item response");
  return { ...summary, payload: value.payload };
}

export function createApiClient(sessionToken: string): InspectorApiClient {
  const headers = {
    "Content-Type": "application/json",
    "X-MCP-Inspector-Session": sessionToken,
  };

  return {
    async listProjects() {
      const response = await fetch("/api/projects", { headers });
      return (await decodeResponse<{ projects: ProjectSummary[] }>(response)).projects;
    },
    async createProject(name) {
      const response = await fetch("/api/projects", {
        method: "POST",
        headers,
        body: JSON.stringify({ name }),
      });
      return (await decodeResponse<{ project: ProjectSummary }>(response)).project;
    },
    async openProject(projectId) {
      const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/open`, {
        method: "POST",
        headers,
      });
      return (await decodeResponse<{ project: ProjectSummary }>(response)).project;
    },
    async listConnections(projectId) {
      const response = await fetch(
        `/api/projects/${encodeURIComponent(projectId)}/connections`,
        { headers },
      );
      return decodeConnectionList(await decodeConnectionResponse(response), projectId);
    },
    async createConnection(projectId, input) {
      const response = await fetch(
        `/api/projects/${encodeURIComponent(projectId)}/connections`,
        { method: "POST", headers, body: JSON.stringify(input) },
      );
      return decodeCreatedConnection(await decodeConnectionResponse(response), projectId);
    },
    async updateConnection(projectId, connectionId, input) {
      const response = await fetch(
        `/api/projects/${encodeURIComponent(projectId)}/connections/${encodeURIComponent(connectionId)}`,
        { method: "PATCH", headers, body: JSON.stringify(input) },
      );
      const updated = decodeCreatedConnection(await decodeConnectionResponse(response), projectId);
      if (updated.id !== connectionId) throw new Error("Invalid connection response");
      return updated;
    },
    async deleteConnection(projectId, connectionId) {
      const response = await fetch(
        `/api/projects/${encodeURIComponent(projectId)}/connections/${encodeURIComponent(connectionId)}`,
        { method: "DELETE", headers },
      );
      if (!response.ok) await decodeResponse<never>(response);
    },
    async connectConnection(projectId, connectionId) {
      const response = await fetch(
        `/api/projects/${encodeURIComponent(projectId)}/connections/${encodeURIComponent(connectionId)}/connect`,
        { method: "POST", headers },
      );
      return decodeCreatedConnection(await decodeConnectionResponse(response), projectId);
    },
    async disconnectConnection(projectId, connectionId) {
      const response = await fetch(
        `/api/projects/${encodeURIComponent(projectId)}/connections/${encodeURIComponent(connectionId)}/disconnect`,
        { method: "POST", headers },
      );
      return decodeCreatedConnection(await decodeConnectionResponse(response), projectId);
    },
    async listTools(projectId, connectionId) {
      const response = await fetch(
        `/api/projects/${encodeURIComponent(projectId)}/connections/${encodeURIComponent(connectionId)}/tools`,
        { headers },
      );
      return decodeToolList(await decodeResponse<unknown>(response), projectId, connectionId);
    },
    async refreshTools(projectId, connectionId) {
      const response = await fetch(
        `/api/projects/${encodeURIComponent(projectId)}/connections/${encodeURIComponent(connectionId)}/tools/refresh`,
        { method: "POST", headers },
      );
      return decodeToolList(await decodeResponse<unknown>(response), projectId, connectionId);
    },
    async getTool(projectId, connectionId, toolName) {
      const response = await fetch(
        `/api/projects/${encodeURIComponent(projectId)}/connections/${encodeURIComponent(connectionId)}/tools/${encodeURIComponent(toolName)}`,
        { headers },
      );
      return decodeToolDetail(await decodeResponse<unknown>(response), projectId, connectionId, toolName);
    },
    async deleteTool(projectId, connectionId, toolName) {
      const response = await fetch(
        `/api/projects/${encodeURIComponent(projectId)}/connections/${encodeURIComponent(connectionId)}/tools/${encodeURIComponent(toolName)}`,
        { method: "DELETE", headers },
      );
      if (!response.ok) await decodeResponse<never>(response);
    },
    async listToolFolders(projectId, connectionId) {
      const response = await fetch(
        `/api/projects/${encodeURIComponent(projectId)}/connections/${encodeURIComponent(connectionId)}/tool-folders`,
        { headers },
      );
      return decodeToolFolders(await decodeResponse<unknown>(response), projectId, connectionId);
    },
    async createToolFolder(projectId, connectionId, name) {
      const response = await fetch(
        `/api/projects/${encodeURIComponent(projectId)}/connections/${encodeURIComponent(connectionId)}/tool-folders`,
        { method: "POST", headers, body: JSON.stringify({ name }) },
      );
      const value = await decodeResponse<unknown>(response);
      if (!isObject(value) || !("folder" in value)) throw new Error("Invalid Tool folder response");
      return decodeToolFolder(value.folder, projectId, connectionId);
    },
    async renameToolFolder(projectId, connectionId, folderId, name) {
      const response = await fetch(
        `/api/projects/${encodeURIComponent(projectId)}/connections/${encodeURIComponent(connectionId)}/tool-folders/${encodeURIComponent(folderId)}`,
        { method: "PATCH", headers, body: JSON.stringify({ name }) },
      );
      const value = await decodeResponse<unknown>(response);
      if (!isObject(value) || !("folder" in value)) throw new Error("Invalid Tool folder response");
      const folder = decodeToolFolder(value.folder, projectId, connectionId);
      if (folder.id !== folderId) throw new Error("Invalid Tool folder response");
      return folder;
    },
    async deleteToolFolder(projectId, connectionId, folderId) {
      const response = await fetch(
        `/api/projects/${encodeURIComponent(projectId)}/connections/${encodeURIComponent(connectionId)}/tool-folders/${encodeURIComponent(folderId)}`,
        { method: "DELETE", headers },
      );
      if (!response.ok) await decodeResponse<never>(response);
    },
    async moveToolToFolder(projectId, connectionId, toolName, folderId) {
      const response = await fetch(
        `/api/projects/${encodeURIComponent(projectId)}/connections/${encodeURIComponent(connectionId)}/tools/${encodeURIComponent(toolName)}/folder`,
        { method: "PUT", headers, body: JSON.stringify({ folderId }) },
      );
      const value = await decodeResponse<unknown>(response);
      if (!isObject(value) || !("tool" in value)) throw new Error("Invalid Tool response");
      const tool = decodeTool(value.tool, projectId, connectionId);
      if (tool.name !== toolName || tool.folderId !== folderId) throw new Error("Invalid Tool response");
      return tool;
    },
    async listTabs(projectId) {
      const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/tabs`, { headers });
      return decodeTabs(await decodeResponse<unknown>(response), projectId);
    },
    async openTab(projectId, connectionId, toolName) {
      const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/tabs`, {
        method: "POST", headers, body: JSON.stringify({ connectionId, toolName }),
      });
      return decodeTabEnvelope(await decodeResponse<unknown>(response), projectId);
    },
    async replaceTabTool(projectId, tabId, connectionId, toolName) {
      const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/tabs/${encodeURIComponent(tabId)}/tool`, {
        method: "PUT", headers, body: JSON.stringify({ connectionId, toolName }),
      });
      return decodeTabEnvelope(await decodeResponse<unknown>(response), projectId);
    },
    async updateTab(projectId, tabId, patch) {
      const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/tabs/${encodeURIComponent(tabId)}`, {
        method: "PATCH", headers, body: JSON.stringify(patch),
      });
      return decodeTabEnvelope(await decodeResponse<unknown>(response), projectId);
    },
    async duplicateTab(projectId, tabId) {
      const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/tabs/${encodeURIComponent(tabId)}/duplicate`, { method: "POST", headers });
      return decodeTabEnvelope(await decodeResponse<unknown>(response), projectId);
    },
    async reorderTabs(projectId, tabIds) {
      const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/tabs/reorder`, {
        method: "PUT", headers, body: JSON.stringify({ tabIds }),
      });
      return decodeTabs(await decodeResponse<unknown>(response), projectId);
    },
    async closeTab(projectId, tabId) {
      const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/tabs/${encodeURIComponent(tabId)}`, { method: "DELETE", headers });
      if (!response.ok) await decodeResponse<never>(response);
    },
    async closeOtherTabs(projectId, tabId) {
      const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/tabs/${encodeURIComponent(tabId)}/close-others`, { method: "POST", headers });
      return decodeTabs(await decodeResponse<unknown>(response), projectId);
    },
    async closeTabsRight(projectId, tabId) {
      const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/tabs/${encodeURIComponent(tabId)}/close-right`, { method: "POST", headers });
      return decodeTabs(await decodeResponse<unknown>(response), projectId);
    },
    async startRun(projectId, tabId, idempotencyKey, args) {
      const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/runs`, {
        method: "POST", headers, body: JSON.stringify({ tabId, idempotencyKey, arguments: args }),
      });
      const value = await decodeResponse<unknown>(response);
      if (!isObject(value) || !("run" in value)) throw new Error("Invalid Run response");
      const run = decodeRunSummary(value.run, projectId);
      if (run.tabId !== tabId || run.idempotencyKey !== idempotencyKey) throw new Error("Invalid Run response");
      return run;
    },
    async getRunSummary(projectId, runId, signal) {
      const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/runs/${encodeURIComponent(runId)}/status`, { headers, signal });
      const value = await decodeResponse<unknown>(response);
      if (!isObject(value) || !("run" in value)) throw new Error("Invalid Run response");
      const run = decodeRunSummary(value.run, projectId);
      if (run.id !== runId) throw new Error("Invalid Run response");
      return run;
    },
    async getRun(projectId, runId, signal) {
      const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/runs/${encodeURIComponent(runId)}`, { headers, signal });
      const run = decodeRunDetail(await decodeResponse<unknown>(response), projectId);
      if (run.id !== runId) throw new Error("Invalid Run response");
      return run;
    },
    async listRuns(projectId, cursor, filter = {}) {
      const search = new URLSearchParams(); if (cursor !== undefined) search.set("cursor", cursor);
      if (filter.tabId !== undefined) search.set("tabId", filter.tabId);
      if (filter.connectionId !== undefined) search.set("connectionId", filter.connectionId);
      if (filter.toolName !== undefined) search.set("toolName", filter.toolName);
      const query = search.size === 0 ? "" : `?${search.toString()}`;
      const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/runs${query}`, { headers });
      return decodeRunPage(await decodeResponse<unknown>(response), projectId, filter);
    },
    async openRunEventStream(projectId, runId, after, signal) {
      const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/runs/${encodeURIComponent(runId)}/events?after=${after}`, {
        headers: { "X-MCP-Inspector-Session": sessionToken, Accept: "text/event-stream" }, signal,
      });
      if (!response.ok) await decodeResponse<never>(response);
      return response;
    },
    async listSavedItems(projectId, connectionId, toolName, cursor) {
      const base = `/api/projects/${encodeURIComponent(projectId)}/connections/${encodeURIComponent(connectionId)}/tools/${encodeURIComponent(toolName)}/saved-items`;
      const target = cursor === undefined ? base : `${base}?cursor=${encodeURIComponent(cursor)}`;
      const value = await decodeResponse<unknown>(await fetch(target, { headers }));
      if (!isObject(value) || !Array.isArray(value.items) || !(value.nextCursor === null ||
          (typeof value.nextCursor === "string" && value.nextCursor.length > 0 && value.nextCursor.length <= 4096 && /^[A-Za-z0-9_-]+$/.test(value.nextCursor)))) {
        throw new Error("Invalid saved item response");
      }
      const items = value.items.map((item) => decodeSavedItemSummary(item, projectId, connectionId, toolName));
      if (new Set(items.map(({ id }) => id)).size !== items.length) throw new Error("Invalid saved item response");
      return { items, nextCursor: value.nextCursor };
    },
    async getSavedItem(projectId, connectionId, toolName, itemId) {
      const base = `/api/projects/${encodeURIComponent(projectId)}/connections/${encodeURIComponent(connectionId)}/tools/${encodeURIComponent(toolName)}/saved-items`;
      const value = await decodeResponse<unknown>(await fetch(`${base}/${encodeURIComponent(itemId)}`, { headers }));
      if (!isObject(value) || !("item" in value)) throw new Error("Invalid saved item response");
      return decodeSavedItemDetail(value.item, projectId, connectionId, toolName, itemId);
    },
    async createSavedItem(projectId, connectionId, toolName, input) {
      const base = `/api/projects/${encodeURIComponent(projectId)}/connections/${encodeURIComponent(connectionId)}/tools/${encodeURIComponent(toolName)}/saved-items`;
      const value = await decodeResponse<unknown>(await fetch(base, { method: "POST", headers, body: JSON.stringify(input) }));
      if (!isObject(value) || !("item" in value)) throw new Error("Invalid saved item response");
      const item = decodeSavedItemDetail(value.item, projectId, connectionId, toolName);
      if (item.kind !== input.kind || item.sourceRunId !== input.sourceRunId) throw new Error("Invalid saved item response");
      return item;
    },
    async deleteSavedItem(projectId, connectionId, toolName, itemId) {
      const base = `/api/projects/${encodeURIComponent(projectId)}/connections/${encodeURIComponent(connectionId)}/tools/${encodeURIComponent(toolName)}/saved-items`;
      const response = await fetch(`${base}/${encodeURIComponent(itemId)}`, { method: "DELETE", headers });
      if (!response.ok) await decodeResponse<never>(response);
    },
  };
}
