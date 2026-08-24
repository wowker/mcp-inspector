import { useState, type KeyboardEvent } from "react";
import type { ConnectionSummary, InspectorApiClient, ProjectSummary } from "../api/api-client.js";
import { ConnectionPanel } from "../features/connections/ConnectionPanel.js";
import { DebugWorkspace, type ToolOpenIntent } from "../features/tabs/DebugWorkspace.js";

type WorkbenchPage = "servers" | "tools";

interface InspectorWorkbenchProps {
  api: InspectorApiClient;
  project: ProjectSummary;
  version: string;
}

interface ServerWorkspaceState {
  tabs: ConnectionSummary[];
  activeId: string | null;
}

function NavIcon({ type }: { type: WorkbenchPage }) {
  return type === "servers" ? (
    <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="16" height="6" rx="2"/><rect x="4" y="14" width="16" height="6" rx="2"/><path d="M8 7h.01M8 17h.01"/></svg>
  ) : (
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14 6 4 4-8 8H6v-4l8-8Z"/><path d="m12 8 4 4M5 5l2 2M17 17l2 2"/></svg>
  );
}

export function InspectorWorkbench({ api, project, version }: InspectorWorkbenchProps) {
  const [page, setPage] = useState<WorkbenchPage>("servers");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [servers, setServers] = useState<ServerWorkspaceState>({ tabs: [], activeId: null });
  const [toolIntent, setToolIntent] = useState<ToolOpenIntent | null>(null);

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

  return (
    <div className={`workbench${sidebarCollapsed ? " workbench--sidebar-collapsed" : ""}`}>
      <a className="skip-link" href="#workbench-content">跳到主要内容</a>
      <aside className="workbench-sidebar">
        <div className="workbench-brand" aria-label="DSers MCP Inspector">
          <span className="workbench-brand__mark" aria-hidden="true">M</span>
          <span className="workbench-brand__text"><strong>MCP</strong><small>Inspector</small></span>
        </div>
        <nav aria-label="工作台导航">
          {(["servers", "tools"] as const).map((item) => (
            <button
              key={item}
              type="button"
              aria-current={page === item ? "page" : undefined}
              onClick={() => setPage(item)}
            >
              <NavIcon type={item} />
              <span>{item === "servers" ? "Servers" : "Tools"}</span>
            </button>
          ))}
        </nav>
        <div className="workbench-sidebar__footer">
          <span className="service-indicator"><i aria-hidden="true" /> <span>本地服务 v{version}</span></span>
          {!sidebarCollapsed && <button
            type="button"
            className="sidebar-toggle"
            aria-label="收起侧边栏"
            onClick={() => setSidebarCollapsed((value) => !value)}
          ><span aria-hidden="true">‹</span></button>}
        </div>
      </aside>

      <section className="workbench-stage">
        {sidebarCollapsed && (
          <button
            type="button"
            className="sidebar-restore"
            aria-label="展开侧边栏"
            onClick={() => setSidebarCollapsed(false)}
          >☰</button>
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
          <button type="button" className="add-server-tab" onClick={() => setPage("servers")}>＋ 添加 Server</button>
          <div className="project-identity"><span>{project.name}</span><small>当前项目</small></div>
        </header>

        <main id="workbench-content" className="workbench-content" tabIndex={-1}>
          {page === "servers" ? (
            <section className="servers-page" aria-labelledby="servers-page-title">
              <header className="page-heading">
                <div><p className="eyebrow">MCP CONNECTIONS</p><h1 id="servers-page-title">Servers</h1></div>
                <p>管理 MCP Server 连接、认证方式和运行状态。</p>
              </header>
              <ConnectionPanel
                api={api}
                projectId={project.id}
                mode="servers"
                onConnectionConnected={activateServer}
                onConnectionDisconnected={removeServer}
                onConnectionsLoaded={restoreConnectedServers}
              />
            </section>
          ) : (
            <section
              id="server-tool-panel"
              className="tools-page"
              role="tabpanel"
              aria-labelledby={servers.activeId === null ? "tools-page-title" : `server-tab-${servers.activeId}`}
            >
              <header className="page-heading page-heading--compact">
                <div><p className="eyebrow">MCP TOOL DEBUGGER</p><h1 id="tools-page-title">Tools</h1></div>
                <p>{servers.activeId === null ? "先连接 Server，再开始 Tool 调试。" : "选择 Tool，编辑参数并查看完整调用轨迹。"}</p>
              </header>
              {servers.activeId === null ? (
                <div className="workbench-empty" role="status">
                  <strong>选择一个已连接的 Server 开始调试</strong>
                  <p>前往 Servers 页面建立连接，连接成功后会自动创建 Server 页签。</p>
                  <button type="button" onClick={() => setPage("servers")}>前往 Servers</button>
                </div>
              ) : (
                <div className="tools-layout">
                  <aside className="tools-catalog">
                    <ConnectionPanel
                      api={api}
                      projectId={project.id}
                      mode="tools"
                      connectionFilterId={servers.activeId}
                      onSelectTool={(tool) => setToolIntent((current) => ({ sequence: (current?.sequence ?? 0) + 1, tool, newTab: false }))}
                      onOpenTool={(tool) => setToolIntent((current) => ({ sequence: (current?.sequence ?? 0) + 1, tool, newTab: true }))}
                    />
                  </aside>
                  <DebugWorkspace api={api} projectId={project.id} toolIntent={toolIntent} />
                </div>
              )}
            </section>
          )}
        </main>
      </section>
    </div>
  );
}
