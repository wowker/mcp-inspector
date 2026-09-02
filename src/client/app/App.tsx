import { lazy, Suspense, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import "./app.css";
import "./redesign.css";
import "./run-results.css";
import "../components/foundation.css";
import {
  createApiClient,
  type InspectorApiClient,
  type ProjectSummary,
} from "../api/api-client.js";
import { ProjectPicker } from "../features/projects/ProjectPicker.js";
import "../i18n/index.js";

const InspectorWorkbench = lazy(async () => {
  const module = await import("./InspectorWorkbench.js");
  return { default: module.InspectorWorkbench };
});

type HealthState =
  | { status: "checking" }
  | { status: "ready"; version: string }
  | { status: "error"; reason: "invalid-response" | "health-failed" | "unknown"; httpStatus?: number };

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
  const { t } = useTranslation("app");
  const [health, setHealth] = useState<HealthState>({ status: "checking" });
  const [api, setApi] = useState<InspectorApiClient | null>(null);
  const [activeProject, setActiveProject] = useState<ProjectSummary | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/health", {
      credentials: "same-origin",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`health:${response.status}`);
        }
        const payload: unknown = await response.json();
        if (!isHealthResponse(payload)) {
          throw new Error("invalid-health-response");
        }
        return payload;
      })
      .then(({ version }) => {
        setHealth({ status: "ready", version });
        setApi(createApiClient());
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setHealth({
            status: "error",
            reason: error instanceof Error && error.message === "invalid-health-response" ? "invalid-response"
              : error instanceof Error && error.message.startsWith("health:") ? "health-failed" : "unknown",
            httpStatus: error instanceof Error && error.message.startsWith("health:") ? Number(error.message.slice(7)) : undefined,
          });
        }
      });

    return () => controller.abort();
  }, []);

  const statusText =
    health.status === "checking"
      ? t("shell.connecting")
      : health.status === "ready"
        ? t("shell.ready", { version: health.version })
        : health.reason === "invalid-response" ? t("shell.invalidHealth")
            : health.reason === "health-failed" ? t("shell.healthFailed", { status: health.httpStatus })
              : t("shell.unknownHealth");

  if (health.status === "ready" && api !== null && activeProject !== null) {
    return <Suspense fallback={<main className="app-shell"><p role="status">{t("shell.loadingWorkbench")}</p></main>}>
      <InspectorWorkbench api={api} project={activeProject} version={health.version} />
    </Suspense>;
  }

  return (
    <main className="app-shell">
      <section className="welcome-card" aria-labelledby="app-title">
        <p className="eyebrow">{t("shell.eyebrow")}</p>
        <h1 id="app-title">MCP Inspector</h1>
        <p className="summary">{t("shell.preparing")}</p>
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
      </section>
    </main>
  );
}
