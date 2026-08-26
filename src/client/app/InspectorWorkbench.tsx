import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import {
  ClockCounterClockwise,
  HardDrives,
  Moon,
  SidebarSimple,
  Sun,
  Wrench,
} from "@phosphor-icons/react";
import type { ConnectionSummary, InspectorApiClient, ProjectSummary, RunDetail } from "../api/api-client.js";
import { ConnectionPanel } from "../features/connections/ConnectionPanel.js";
import { DebugWorkspace, type ToolOpenIntent } from "../features/tabs/DebugWorkspace.js";
import { applyInitialTheme, toggleTheme, type ThemeMode } from "./theme.js";
import { isOAuthCompleteEvent, OAUTH_CHANNEL } from "../../shared/oauth-events.js";
import { RunHistoryPage } from "../features/runs/RunHistoryPage.js";

type WorkbenchPage = "servers" | "tools" | "history";

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
  return <ClockCounterClockwise {...iconProps} />;
}

export function InspectorWorkbench({ api, project, version }: InspectorWorkbenchProps) {
  const [page, setPage] = useState<WorkbenchPage>("servers");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [catalogWidth, setCatalogWidth] = useState(300);
  const [theme, setTheme] = useState<ThemeMode>(() => applyInitialTheme());
  const [servers, setServers] = useState<ServerWorkspaceState>({ tabs: [], activeId: null });
  const [toolIntent, setToolIntent] = useState<ToolOpenIntent | null>(null);
  const [activeTool, setActiveTool] = useState<{ connectionId: string; name: string } | null>(null);
  const [oauthConnectionUpdate, setOauthConnectionUpdate] = useState<ConnectionSummary | null>(null);
  const serversRef = useRef(servers); serversRef.current = servers;

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
    setServers((current) => ({
      tabs: [...current.tabs.filter(({ id }) => id !== connection.id), connection],
      activeId: connection.id,
    }));
    setPage("tools");
  }

  function removeServer(connectionId: string): void {
    setServers((current) => {
      const tabs = current.tabs.filter(({ id }) => id !== connectionId);
      return { tabs, activeId: current.activeId === connectionId ? tabs[0]?.id ?? null : current.activeId };
    });
  }

  function restoreConnectedServers(connections: ConnectionSummary[]): void {
    const connected = connections.filter(({ status }) => status === "connected");
    setServers((current) => ({
      tabs: connected,
      activeId: connected.some(({ id }) => id === current.activeId) ? current.activeId : connected[0]?.id ?? null,
    }));
  }

  function selectServer(connectionId: string): void {
    setServers((current) => ({ ...current, activeId: connectionId }));
    setPage("tools");
  }

  async function openRunInDebug(run: RunDetail): Promise<void> {
    if (run.projectId !== project.id) throw new Error("运行记录不属于当前项目");
    let connection = serversRef.current.tabs.find(({ id }) => id === run.connectionId);
    if (connection === undefined) {
      const connections = await api.listConnections(project.id);
      connection = connections.find(({ id }) => id === run.connectionId);
    }
    if (connection === undefined) throw new Error("运行记录所属 Server 已不存在");

    const detail = await api.getTool(project.id, run.connectionId, run.toolName);
    if (detail.tool.projectId !== project.id || detail.tool.connectionId !== run.connectionId || detail.tool.name !== run.toolName) {
      throw new Error("Tool 数据与运行记录不匹配");
    }
    if (detail.tool.status === "removed") throw new Error("该运行记录的 Tool 已移除，无法打开调试");

    setServers((current) => ({
      tabs: current.tabs.some(({ id }) => id === connection.id) ? current.tabs : [...current.tabs, connection],
      activeId: connection.id,
    }));
    setToolIntent((current) => ({
      sequence: (current?.sequence ?? 0) + 1,
      tool: detail.tool,
      newTab: true,
      restoreRun: run,
    }));
    setPage("tools");
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
      <a className="skip-link" href="#workbench-content">跳到主要内容</a>
      <aside className="workbench-sidebar">
        <div className="workbench-brand" aria-label="MCP Inspector">
          <span className="workbench-brand__mark" aria-hidden="true">M</span>
          <span className="workbench-brand__text"><strong>MCP</strong><small>Inspector</small></span>
        </div>
        <nav aria-label="工作台导航">
          {(["servers", "tools", "history"] as const).map((item) => (
            <button
              key={item}
              type="button"
              aria-current={page === item ? "page" : undefined}
              onClick={() => setPage(item)}
            >
              <NavIcon type={item} active={page === item} />
              <span>{item === "servers" ? "Servers" : item === "tools" ? "Tools" : "运行历史"}</span>
            </button>
          ))}
        </nav>
        <div className="workbench-sidebar__footer">
          <span className="service-indicator"><i aria-hidden="true" /> <span>本地服务 v{version}</span></span>
          {!sidebarCollapsed && <div className="sidebar-controls">
            <button
              type="button"
              className="theme-toggle"
              aria-label={theme === "light" ? "切换到深色主题" : "切换到浅色主题"}
              onClick={() => setTheme((current) => toggleTheme(current))}
            >{theme === "light" ? <Moon size={17} aria-hidden="true" /> : <Sun size={17} aria-hidden="true" />}</button>
            <button
              type="button"
              className="sidebar-toggle"
              aria-label="收起侧边栏"
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
            aria-label="展开侧边栏"
            onClick={() => setSidebarCollapsed(false)}
          ><SidebarSimple size={19} aria-hidden="true" /></button>
        )}
        <header className="server-tabbar">
          <div className="server-tabs" role="tablist" aria-label="已连接 Servers">
            {servers.tabs.map((connection, index) => (
              <button
                key={connection.id}
                id={`server-tab-${connection.id}`}
                type="button"
                role="tab"
                aria-controls="server-tool-panel"
                aria-selected={page === "tools" && servers.activeId === connection.id}
                tabIndex={(
                  page === "tools" && servers.activeId === connection.id
                ) || (
                  page === "servers" && index === 0
                ) ? 0 : -1}
                onClick={() => selectServer(connection.id)}
                onKeyDown={(event) => navigateServerTabs(event, index)}
              >
                <i aria-hidden="true" />
                <span>{connection.name}</span>
              </button>
            ))}
            {servers.tabs.length === 0 && <span className="server-tabs__empty">尚未连接 Server</span>}
          </div>
        </header>

        <main id="workbench-content" className="workbench-content" tabIndex={-1}>
          {page === "servers" ? (
            <section className="servers-page" aria-labelledby="servers-page-title">
              <header className="page-heading">
                <div><h1 id="servers-page-title">Servers</h1><p>管理 MCP Server 连接、认证方式和运行状态。</p></div>
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
          ) : page === "history" ? <RunHistoryPage api={api} projectId={project.id} onOpenDebug={openRunInDebug} /> : (
            <section
              id="server-tool-panel"
              className="tools-page"
              role="tabpanel"
              aria-label={servers.activeId === null ? "Tools" : undefined}
              aria-labelledby={servers.activeId === null ? undefined : `server-tab-${servers.activeId}`}
            >
              {servers.activeId === null ? (
                <div className="workbench-empty" role="status">
                  <strong>选择一个已连接的 Server 开始调试</strong>
                  <p>前往 Servers 页面建立连接，连接成功后会自动创建 Server 页签。</p>
                  <button type="button" onClick={() => setPage("servers")}>前往 Servers</button>
                </div>
              ) : (
                <div
                  className="tools-layout"
                  style={{ "--tool-catalog-width": `${catalogWidth}px` } as CSSProperties}
                >
                  <aside id="tool-catalog" className="tools-catalog" aria-label="Tool 目录">
                    <ConnectionPanel
                      api={api}
                      projectId={project.id}
                      mode="tools"
                      connectionFilterId={servers.activeId}
                      selectedTool={activeTool}
                      onSelectTool={(tool) => setToolIntent((current) => ({ sequence: (current?.sequence ?? 0) + 1, tool, newTab: false }))}
                      onOpenTool={(tool) => setToolIntent((current) => ({ sequence: (current?.sequence ?? 0) + 1, tool, newTab: true }))}
                    />
                  </aside>
                  <div
                    className="catalog-resize-handle"
                    role="separator"
                    tabIndex={0}
                    aria-label="调整 Tool 目录宽度"
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
                  <DebugWorkspace api={api} projectId={project.id} toolIntent={toolIntent} onActiveToolChange={setActiveTool} />
                </div>
              )}
            </section>
          )}
        </main>
      </section>
    </div>
  );
}
