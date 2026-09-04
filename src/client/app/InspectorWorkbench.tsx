import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  BracketsCurly,
  ClockCounterClockwise,
  ClipboardText,
  HardDrives,
  Moon,
  Stack,
  SidebarSimple,
  Sun,
  TestTube,
  Wrench,
} from "@phosphor-icons/react";
import type { ConnectionSummary, InspectorApiClient, ProjectSummary, RunDetail, SavedItemDetail } from "../api/api-client.js";
import { ConnectionPanel } from "../features/connections/ConnectionPanel.js";
import { DebugWorkspace, type ToolOpenIntent } from "../features/tabs/DebugWorkspace.js";
import { applyInitialTheme, toggleTheme, type ThemeMode } from "./theme.js";
import { isOAuthCompleteEvent, OAUTH_CHANNEL } from "../../shared/oauth-events.js";
import { RunHistoryPage } from "../features/runs/RunHistoryPage.js";
import { EnvironmentVariablesPage } from "../features/environment/EnvironmentVariablesPage.js";
import { LanguageSwitcher } from "../i18n/LanguageSwitcher.js";
import { TestCasesPage, type TestCaseSourceIntent } from "../features/testing/TestCasesPage.js";
import { TestSuitesPage } from "../features/testing/TestSuitesPage.js";
import { TestReportsPage } from "../features/testing/TestReportsPage.js";
import { ServerTab } from "./ServerTab.js";

type WorkbenchPage = "servers" | "tools" | "environment" | "testing" | "suites" | "reports" | "history";
type PersistentWorkbenchPage = Extract<WorkbenchPage, "tools" | "testing" | "suites">;
const persistentWorkbenchPages = new Set<WorkbenchPage>(["tools", "testing", "suites"]);

interface InspectorWorkbenchProps {
  api: InspectorApiClient;
  project: ProjectSummary;
  version: string;
}

interface ServerWorkspaceState {
  tabs: ConnectionSummary[];
  activeId: string | null;
}

function NavIcon({ type, active }: { type: WorkbenchPage; active: boolean }) {
  const iconProps = {
    className: "workbench-nav-icon",
    size: 18,
    weight: active ? "bold" : "regular",
    "aria-hidden": true,
  } as const;
  if (type === "servers") return <HardDrives {...iconProps} />;
  if (type === "tools") return <Wrench {...iconProps} />;
  if (type === "environment") return <BracketsCurly {...iconProps} />;
  if (type === "testing") return <TestTube {...iconProps} />;
  if (type === "suites") return <Stack {...iconProps} />;
  if (type === "reports") return <ClipboardText {...iconProps} />;
  return <ClockCounterClockwise {...iconProps} />;
}

function useCompactSidebar(): boolean {
  const query = "(max-width: 900px)";
  const [compact, setCompact] = useState(() => typeof window.matchMedia === "function" && window.matchMedia(query).matches);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const media = window.matchMedia(query);
    const update = () => setCompact(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return compact;
}

export function InspectorWorkbench({ api, project, version }: InspectorWorkbenchProps) {
  const { t } = useTranslation("app");
  const [page, setPage] = useState<WorkbenchPage>("servers");
  const [mountedPersistentPages, setMountedPersistentPages] = useState<ReadonlySet<PersistentWorkbenchPage>>(new Set());
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [catalogWidth, setCatalogWidth] = useState(300);
  const [theme, setTheme] = useState<ThemeMode>(() => applyInitialTheme());
  const compactSidebar = useCompactSidebar();
  const [servers, setServers] = useState<ServerWorkspaceState>({ tabs: [], activeId: null });
  const [toolIntent, setToolIntent] = useState<ToolOpenIntent | null>(null);
  const toolIntentSequence = useRef(0);
  const [activeTool, setActiveTool] = useState<{ connectionId: string; name: string } | null>(null);
  const [oauthConnectionUpdate, setOauthConnectionUpdate] = useState<ConnectionSummary | null>(null);
  const [testCaseSourceIntent, setTestCaseSourceIntent] = useState<TestCaseSourceIntent | null>(null);
  const closedServerIds = useRef(new Set<string>());
  const serversRef = useRef(servers); serversRef.current = servers;
  const pageLabels: Record<WorkbenchPage, string> = {
    servers: t("workbench.nav.servers"), tools: t("workbench.nav.tools"),
    environment: t("workbench.nav.environment"), history: t("workbench.nav.history"),
    testing: t("workbench.nav.testing"), suites: t("workbench.nav.suites"), reports: t("workbench.nav.reports"),
  };

  useEffect(() => {
    if (!persistentWorkbenchPages.has(page)) return;
    setMountedPersistentPages((current) => current.has(page as PersistentWorkbenchPage)
      ? current : new Set(current).add(page as PersistentWorkbenchPage));
  }, [page]);

  useEffect(() => {
    let channel: BroadcastChannel | null = null;
    let active = true;
    const complete = async (value: unknown) => {
      if (!isOAuthCompleteEvent(value)) return;
      let connection: ConnectionSummary | undefined;
      try {
        connection = (await api.listConnections(project.id)).find(({ id }) => id === value.connectionId);
      } catch { return; }
      if (!active || connection === undefined || connection.authMode !== "oauth" || connection.authorizationStatus !== "authorized") return;
      setOauthConnectionUpdate(connection);
      setPage("servers");
      try { window.focus(); } catch { /* Focus is best-effort when the browser blocks background tabs. */ }
      channel?.postMessage({ type: "oauth-ready", connectionId: value.connectionId });
    };
    const message = (event: MessageEvent) => { if (event.origin === window.location.origin) void complete(event.data); };
    try {
      if (typeof BroadcastChannel === "function") {
        channel = new BroadcastChannel(OAUTH_CHANNEL);
        channel.onmessage = (event) => { void complete(event.data); };
      }
    } catch { /* The pending connection still completes when BroadcastChannel is unavailable. */ }
    window.addEventListener("message", message);
    return () => { active = false; window.removeEventListener("message", message); channel?.close(); };
  }, [api, project.id]);

  function activateServer(connection: ConnectionSummary): void {
    closedServerIds.current.delete(connection.id);
    setServers((current) => ({
      tabs: [...current.tabs.filter(({ id }) => id !== connection.id), connection],
      activeId: connection.id,
    }));
    setPage("tools");
  }

  function removeServer(connectionId: string): void {
    closedServerIds.current.add(connectionId);
    setServers((current) => {
      const tabs = current.tabs.filter(({ id }) => id !== connectionId);
      return { tabs, activeId: current.activeId === connectionId ? tabs[0]?.id ?? null : current.activeId };
    });
  }

  function restoreConnectedServers(connections: ConnectionSummary[]): void {
    const connected = connections.filter(({ id, status }) => status === "connected" && !closedServerIds.current.has(id));
    setServers((current) => ({
      tabs: connected,
      activeId: connected.some(({ id }) => id === current.activeId) ? current.activeId : connected[0]?.id ?? null,
    }));
  }

  async function closeServer(connectionId: string): Promise<void> {
    try {
      const disconnected = await api.disconnectConnection(project.id, connectionId);
      if (disconnected.id !== connectionId || disconnected.projectId !== project.id || disconnected.status !== "disconnected") {
        throw new Error("Connection identity or status mismatch");
      }
      removeServer(connectionId);
    } catch {
      toast.error(t("workbench.errors.closeServerFailed"));
    }
  }

  function selectServer(connectionId: string): void {
    setServers((current) => ({ ...current, activeId: connectionId }));
    setPage("tools");
  }

  async function openRunInDebug(run: RunDetail): Promise<void> {
    if (run.projectId !== project.id) throw new Error(t("workbench.errors.runProjectMismatch"));
    let connection = serversRef.current.tabs.find(({ id }) => id === run.connectionId);
    if (connection === undefined) {
      const connections = await api.listConnections(project.id);
      connection = connections.find(({ id }) => id === run.connectionId);
    }
    if (connection === undefined) throw new Error(t("workbench.errors.runServerMissing"));

    const detail = await api.getTool(project.id, run.connectionId, run.toolName);
    if (detail.tool.projectId !== project.id || detail.tool.connectionId !== run.connectionId || detail.tool.name !== run.toolName) {
      throw new Error(t("workbench.errors.runToolMismatch"));
    }
    if (detail.tool.status === "removed") throw new Error(t("workbench.errors.runToolRemoved"));

    setServers((current) => ({
      tabs: current.tabs.some(({ id }) => id === connection.id) ? current.tabs : [...current.tabs, connection],
      activeId: connection.id,
    }));
    setToolIntent({
      sequence: ++toolIntentSequence.current,
      tool: detail.tool,
      newTab: true,
      restoreRun: run,
    });
    setPage("tools");
  }

  function createTestFromRun(run: RunDetail): void {
    if (run.projectId !== project.id) return;
    setTestCaseSourceIntent((current) => ({ sequence: (current?.sequence ?? 0) + 1, source: { kind: "run", run } }));
    setPage("testing");
  }

  function createTestFromSaved(item: SavedItemDetail): void {
    if (item.projectId !== project.id) return;
    setTestCaseSourceIntent((current) => ({ sequence: (current?.sequence ?? 0) + 1, source: { kind: "saved-item", item } }));
    setPage("testing");
  }

  function navigateServerTabs(event: KeyboardEvent<HTMLButtonElement>, index: number): void {
    let targetIndex: number | null = null;
    if (event.key === "ArrowRight") targetIndex = (index + 1) % servers.tabs.length;
    if (event.key === "ArrowLeft") targetIndex = (index - 1 + servers.tabs.length) % servers.tabs.length;
    if (event.key === "Home") targetIndex = 0;
    if (event.key === "End") targetIndex = servers.tabs.length - 1;
    if (targetIndex === null) return;
    event.preventDefault();
    const target = servers.tabs[targetIndex];
    if (target === undefined) return;
    selectServer(target.id);
    queueMicrotask(() => document.getElementById(`server-tab-${target.id}`)?.focus());
  }

  function resizeCatalog(event: ReactPointerEvent<HTMLDivElement>): void {
    const layout = event.currentTarget.parentElement;
    if (layout === null) return;
    const bounds = layout.getBoundingClientRect();
    setCatalogWidth(Math.round(Math.min(380, Math.max(260, event.clientX - bounds.left))));
  }

  return (
    <div className={`workbench${sidebarCollapsed ? " workbench--sidebar-collapsed" : ""}`}>
      <a className="skip-link" href="#workbench-content">{t("workbench.skipMain")}</a>
      <aside className="workbench-sidebar">
        <div className="workbench-brand" aria-label="MCP Inspector">
          <span className="workbench-brand__mark" aria-hidden="true">M</span>
          <span className="workbench-brand__text"><strong>MCP</strong><small>Inspector</small></span>
        </div>
        <nav aria-label={t("workbench.navigation")}>
          {(["servers", "tools", "environment", "testing", "suites", "reports", "history"] as const).map((item) => (
            <button
              key={item}
              type="button"
              aria-current={page === item ? "page" : undefined}
              onClick={() => setPage(item)}
            >
              <NavIcon type={item} active={page === item} />
              <span>{pageLabels[item]}</span>
            </button>
          ))}
        </nav>
        <div className="workbench-sidebar__footer">
          <div className="workbench-sidebar__service-row">
            <span className="service-indicator" aria-label={t("workbench.localService", { version })}>
              <i aria-hidden="true" />
              <span title={t("workbench.localService", { version })}>{t("workbench.localService", { version })}</span>
            </span>
          </div>
          {!sidebarCollapsed && <div className="sidebar-controls">
            <LanguageSwitcher variant={compactSidebar ? "compact" : "select"} />
            <button
              type="button"
              className="theme-toggle"
              aria-label={theme === "light" ? t("workbench.themeDark") : t("workbench.themeLight")}
              onClick={() => setTheme((current) => toggleTheme(current))}
            >{theme === "light" ? <Moon size={17} aria-hidden="true" /> : <Sun size={17} aria-hidden="true" />}</button>
            <button
              type="button"
              className="sidebar-toggle"
              aria-label={t("workbench.collapseSidebar")}
              onClick={() => setSidebarCollapsed(true)}
            ><SidebarSimple size={17} aria-hidden="true" /></button>
          </div>}
        </div>
      </aside>

      <section className="workbench-stage">
        {sidebarCollapsed && (
          <button
            type="button"
            className="sidebar-restore"
            aria-label={t("workbench.expandSidebar")}
            onClick={() => setSidebarCollapsed(false)}
          ><SidebarSimple size={19} aria-hidden="true" /></button>
        )}
        <header className="server-tabbar">
          <div className="server-tabs">
            <div className="sr-only" role="tablist" aria-label={t("workbench.connectedServers")}
              aria-owns={servers.tabs.map(({ id }) => `server-tab-${id}`).join(" ")} />
            {servers.tabs.map((connection, index) => (
              <ServerTab
                key={connection.id}
                connection={connection}
                selected={page === "tools" && servers.activeId === connection.id}
                tabIndex={(
                  page === "tools" && servers.activeId === connection.id
                ) || (
                  page === "servers" && index === 0
                ) ? 0 : -1}
                onSelect={() => selectServer(connection.id)}
                onClose={() => closeServer(connection.id)}
                onKeyDown={(event) => navigateServerTabs(event, index)}
              />
            ))}
            {servers.tabs.length === 0 && <span className="server-tabs__empty">{t("workbench.noConnectedServers")}</span>}
          </div>
        </header>

        <main id="workbench-content" className={`workbench-content workbench-content--${page}`} tabIndex={-1}>
          {!persistentWorkbenchPages.has(page) && (page === "servers" ? (
            <section className="servers-page" aria-labelledby="servers-page-title">
              <header className="page-heading">
                <div><h1 id="servers-page-title">{t("workbench.serversTitle")}</h1><p>{t("workbench.serversSummary")}</p></div>
              </header>
              <ConnectionPanel
                api={api}
                projectId={project.id}
                mode="servers"
                onConnectionConnected={activateServer}
                onConnectionDisconnected={removeServer}
                onConnectionsLoaded={restoreConnectedServers}
                connectionUpdate={oauthConnectionUpdate}
              />
            </section>
          ) : page === "environment" ? <EnvironmentVariablesPage api={api} projectId={project.id} />
            : page === "reports" ? <TestReportsPage api={api} projectId={project.id} />
            : <RunHistoryPage api={api} projectId={project.id} onOpenDebug={openRunInDebug} onCreateTest={createTestFromRun} />)}
          {(page === "testing" || mountedPersistentPages.has("testing")) && <div className="workbench-page-slot" hidden={page !== "testing"}>
            <TestCasesPage api={api} projectId={project.id} sourceIntent={testCaseSourceIntent} active={page === "testing"} />
          </div>}
          {(page === "suites" || mountedPersistentPages.has("suites")) && <div className="workbench-page-slot" hidden={page !== "suites"}>
            <TestSuitesPage api={api} projectId={project.id} active={page === "suites"} />
          </div>}
          {(page === "tools" || mountedPersistentPages.has("tools")) && <div className="workbench-page-slot workbench-page-slot--tools" hidden={page !== "tools"}>
            <section
              id="server-tool-panel"
              className="tools-page"
              role="tabpanel"
              aria-label={servers.activeId === null ? t("workbench.toolsPanel") : undefined}
              aria-labelledby={servers.activeId === null ? undefined : `server-tab-${servers.activeId}`}
            >
              {servers.activeId === null ? (
                <div className="workbench-empty" role="status">
                  <strong>{t("workbench.emptyToolsTitle")}</strong>
                  <p>{t("workbench.emptyToolsHint")}</p>
                  <button type="button" onClick={() => setPage("servers")}>{t("workbench.openServers")}</button>
                </div>
              ) : (
                <div
                  className="tools-layout"
                  style={{ "--tool-catalog-width": `${catalogWidth}px` } as CSSProperties}
                >
                  <aside id="tool-catalog" className="tools-catalog" aria-label={t("workbench.catalog")}>
                    <ConnectionPanel
                      api={api}
                      projectId={project.id}
                      mode="tools"
                      connectionFilterId={servers.activeId}
                      selectedTool={activeTool}
                      onSelectTool={(tool) => setToolIntent({ sequence: ++toolIntentSequence.current, tool, newTab: true })}
                      onOpenTool={(tool) => setToolIntent({ sequence: ++toolIntentSequence.current, tool, newTab: true })}
                    />
                  </aside>
                  <div
                    className="catalog-resize-handle"
                    role="separator"
                    tabIndex={0}
                    aria-label={t("workbench.resizeCatalog")}
                    aria-orientation="vertical"
                    aria-valuemin={260}
                    aria-valuemax={380}
                    aria-valuenow={catalogWidth}
                    onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); resizeCatalog(event); }}
                    onPointerMove={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) resizeCatalog(event); }}
                    onKeyDown={(event) => {
                      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
                      event.preventDefault();
                      setCatalogWidth((current) => Math.min(380, Math.max(260, current + (event.key === "ArrowRight" ? 12 : -12))));
                    }}
                  ><span aria-hidden="true" /></div>
                  <DebugWorkspace api={api} projectId={project.id} connectionId={servers.activeId}
                    toolIntent={toolIntent} onActiveToolChange={setActiveTool} onCreateTestFromSaved={createTestFromSaved}
                    onToolIntentHandled={(sequence) => setToolIntent((current) => current?.sequence === sequence ? null : current)} />
                </div>
              )}
            </section>
          </div>}
        </main>
      </section>
    </div>
  );
}
