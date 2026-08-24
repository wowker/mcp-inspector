import { useEffect, useState } from "react";
import "./app.css";
import {
  createApiClient,
  type InspectorApiClient,
  type ProjectSummary,
} from "../api/api-client.js";
import { ProjectPicker } from "../features/projects/ProjectPicker.js";
import { ConnectionPanel } from "../features/connections/ConnectionPanel.js";
import { consumeBootstrapSession } from "./bootstrap-session.js";

const SESSION_HEADER = "X-DSers-Inspector-Session";

type HealthState =
  | { status: "checking" }
  | { status: "ready"; version: string }
  | { status: "error"; message: string };

interface HealthResponse {
  ok: true;
  version: string;
}

function isHealthResponse(value: unknown): value is HealthResponse {
  if (typeof value !== "object" || value === null) return false;

  const candidate = value as Record<string, unknown>;
  return (
    candidate.ok === true &&
    typeof candidate.version === "string" &&
    candidate.version.length > 0
  );
}

export function App() {
  const [health, setHealth] = useState<HealthState>({ status: "checking" });
  const [api, setApi] = useState<InspectorApiClient | null>(null);
  const [activeProject, setActiveProject] = useState<ProjectSummary | null>(null);

  useEffect(() => {
    const session = consumeBootstrapSession();
    if (session === null) {
      setHealth({ status: "error", message: "Missing local session" });
      return;
    }

    const controller = new AbortController();
    void fetch("/api/health", {
      headers: { [SESSION_HEADER]: session },
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`Health check failed (${response.status})`);
        }
        const payload: unknown = await response.json();
        if (!isHealthResponse(payload)) {
          throw new Error("Invalid health response");
        }
        return payload;
      })
      .then(({ version }) => {
        setHealth({ status: "ready", version });
        setApi(createApiClient(session));
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setHealth({
            status: "error",
            message: error instanceof Error ? error.message : "Health check failed",
          });
        }
      });

    return () => controller.abort();
  }, []);

  const statusText =
    health.status === "checking"
      ? "正在连接本地服务…"
      : health.status === "ready"
        ? `本地服务已就绪 · v${health.version}`
        : health.message;

  return (
    <main className="app-shell">
      <section className="welcome-card" aria-labelledby="app-title">
        <p className="eyebrow">MCP Tool 调试平台</p>
        <h1 id="app-title">DSers MCP Inspector</h1>
        <p className="summary">安全的本地调试工作台正在准备中。</p>
        <p
          className={`health health--${health.status}`}
          role={health.status === "error" ? "alert" : "status"}
          aria-live="polite"
        >
          <span className="health__dot" aria-hidden="true" />
          {statusText}
        </p>
        {health.status === "ready" && api !== null && activeProject === null && (
          <ProjectPicker api={api} onProjectOpened={setActiveProject} />
        )}
        {activeProject !== null && (
          <section className="active-project" aria-labelledby="active-project-name">
            <p className="eyebrow">当前项目</p>
            <h2 id="active-project-name">{activeProject.name}</h2>
            {api !== null && <ConnectionPanel api={api} projectId={activeProject.id} />}
          </section>
        )}
      </section>
    </main>
  );
}
