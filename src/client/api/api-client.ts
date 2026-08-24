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

export interface InspectorApiClient {
  listProjects(): Promise<ProjectSummary[]>;
  createProject(name: string): Promise<ProjectSummary>;
  openProject(projectId: string): Promise<ProjectSummary>;
  listConnections(projectId: string): Promise<ConnectionSummary[]>;
  createConnection(projectId: string, input: CreateConnectionRequest): Promise<ConnectionSummary>;
  deleteConnection(projectId: string, connectionId: string): Promise<void>;
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
  };
}
