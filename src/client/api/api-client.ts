import { parseToolDefinition, type ToolDefinition } from "../../shared/tool-definition.js";

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
  authMode: "none";
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
  authMode: "none";
  timeoutMs: number;
}

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
  updatedAt: string;
  currentSnapshot: ToolSnapshotSummary;
}

export interface ToolDetailSummary {
  tool: CatalogToolSummary;
  snapshots: ToolSnapshotSummary[];
}

export interface InspectorApiClient {
  listProjects(): Promise<ProjectSummary[]>;
  createProject(name: string): Promise<ProjectSummary>;
  openProject(projectId: string): Promise<ProjectSummary>;
  listConnections(projectId: string): Promise<ConnectionSummary[]>;
  createConnection(projectId: string, input: CreateConnectionRequest): Promise<ConnectionSummary>;
  deleteConnection(projectId: string, connectionId: string): Promise<void>;
  connectConnection(projectId: string, connectionId: string): Promise<ConnectionSummary>;
  disconnectConnection(projectId: string, connectionId: string): Promise<ConnectionSummary>;
  listTools(projectId: string, connectionId: string): Promise<CatalogToolSummary[]>;
  refreshTools(projectId: string, connectionId: string): Promise<CatalogToolSummary[]>;
  getTool(projectId: string, connectionId: string, toolName: string): Promise<ToolDetailSummary>;
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
  if (
    typeof id !== "string" || !uuidPattern.test(id) ||
    typeof recordProjectId !== "string" || !uuidPattern.test(recordProjectId) ||
    recordProjectId !== projectId ||
    typeof name !== "string" || name.trim() !== name || name.length < 1 || name.length > 120 ||
    (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") ||
    parsedUrl.hostname.length === 0 || parsedUrl.username.length > 0 || parsedUrl.password.length > 0 ||
    transport !== "streamable-http" || authMode !== "none" || !isConnectionStatus(status) ||
    typeof timeoutMs !== "number" || !Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 600_000 ||
    !(lastProtocolVersion === null || typeof lastProtocolVersion === "string") ||
    !isNullableObject(lastServerInfo) || !validError
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
  const { projectId: owner, connectionId: connection, name, status, updatedAt, currentSnapshot } = value;
  if (owner !== projectId || connection !== connectionId || typeof name !== "string" || name.length === 0 ||
      (status !== "current" && status !== "changed" && status !== "removed") ||
      !isCanonicalUtcTimestamp(updatedAt)) {
    throw new Error("Invalid Tool response");
  }
  return {
    projectId, connectionId, name, status, updatedAt,
    currentSnapshot: decodeSnapshot(currentSnapshot, projectId, connectionId, name),
  };
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

export function createApiClient(sessionToken: string): InspectorApiClient {
  const headers = {
    "Content-Type": "application/json",
    "X-DSers-Inspector-Session": sessionToken,
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
  };
}
