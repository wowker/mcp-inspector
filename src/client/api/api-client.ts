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
  const payload: unknown = await response.json();
  if (!response.ok) {
    const message = (payload as ApiErrorBody)?.error?.message;
    throw new Error(typeof message === "string" ? message : `Request failed (${response.status})`);
  }
  return payload as T;
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
      return (await decodeResponse<{ connections: ConnectionSummary[] }>(response)).connections;
    },
    async createConnection(projectId, input) {
      const response = await fetch(
        `/api/projects/${encodeURIComponent(projectId)}/connections`,
        { method: "POST", headers, body: JSON.stringify(input) },
      );
      return (await decodeResponse<{ connection: ConnectionSummary }>(response)).connection;
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
