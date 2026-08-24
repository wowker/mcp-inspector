export interface ProjectSummary {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  lastOpenedAt: string | null;
}

export interface InspectorApiClient {
  listProjects(): Promise<ProjectSummary[]>;
  createProject(name: string): Promise<ProjectSummary>;
  openProject(projectId: string): Promise<ProjectSummary>;
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
  };
}
