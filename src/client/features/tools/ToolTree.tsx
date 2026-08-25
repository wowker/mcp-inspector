import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { ArrowClockwise } from "@phosphor-icons/react";
import type { CatalogToolSummary, ConnectionSummary } from "../../api/api-client.js";
import { summarizeToolDescription } from "./tool-description.js";

interface ToolTreeProps {
  connections: ConnectionSummary[];
  catalogs: Readonly<Record<string, CatalogToolSummary[]>>;
  refreshingConnectionIds?: ReadonlySet<string>;
  readyConnectionIds?: ReadonlySet<string>;
  errors?: Readonly<Record<string, string>>;
  onRefresh: (connectionId: string) => void;
  onSelectTool: (tool: CatalogToolSummary) => void;
  onOpenTool: (tool: CatalogToolSummary) => void;
}

const statusLabels: Record<CatalogToolSummary["status"], string> = {
  current: "当前",
  changed: "已变化",
  removed: "已移除",
};

// Covers common desktop OS double-click windows while keyboard activation stays immediate.
const POINTER_DOUBLE_CLICK_WINDOW_MS = 500;

export function ToolTree({
  connections,
  catalogs,
  refreshingConnectionIds = new Set(),
  readyConnectionIds = new Set(),
  errors = {},
  onRefresh,
  onSelectTool,
  onOpenTool,
}: ToolTreeProps) {
  const pendingSelection = useRef<{
    timer: ReturnType<typeof setTimeout>;
    tool: CatalogToolSummary;
  } | null>(null);
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const filtered = useMemo(() => Object.fromEntries(connections.map((connection) => [
    connection.id,
    (catalogs[connection.id] ?? []).filter((tool) => {
      const description = tool.currentSnapshot.definition.description;
      return normalizedQuery.length === 0 || tool.name.toLocaleLowerCase().includes(normalizedQuery) ||
        (typeof description === "string" && description.toLocaleLowerCase().includes(normalizedQuery));
    }),
  ])), [catalogs, connections, normalizedQuery]);

  useEffect(() => () => {
    if (pendingSelection.current !== null) clearTimeout(pendingSelection.current.timer);
  }, []);

  function select(tool: CatalogToolSummary, event: MouseEvent<HTMLButtonElement>): void {
    if (event.detail === 0) {
      onSelectTool(tool);
      return;
    }
    if (event.detail > 1) {
      if (pendingSelection.current !== null) clearTimeout(pendingSelection.current.timer);
      pendingSelection.current = null;
      return;
    }
    if (pendingSelection.current !== null) {
      clearTimeout(pendingSelection.current.timer);
      onSelectTool(pendingSelection.current.tool);
    }
    const timer = setTimeout(() => {
      if (pendingSelection.current?.timer !== timer) return;
      pendingSelection.current = null;
      onSelectTool(tool);
    }, POINTER_DOUBLE_CLICK_WINDOW_MS);
    pendingSelection.current = { timer, tool };
  }

  function open(tool: CatalogToolSummary): void {
    if (pendingSelection.current !== null) clearTimeout(pendingSelection.current.timer);
    pendingSelection.current = null;
    onOpenTool(tool);
  }

  function toggle(connectionId: string): void {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(connectionId)) next.delete(connectionId);
      else next.add(connectionId);
      return next;
    });
  }

  return (
    <section className="tool-tree-panel" aria-labelledby="tool-tree-title">
      <div className="tool-tree-panel__heading">
        <div>
          <p className="eyebrow">Tool Catalog</p>
          <h2 id="tool-tree-title">Tools</h2>
        </div>
        <label className="tool-search">
          <span>搜索 Tool</span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="名称或描述"
          />
        </label>
      </div>

      <ul className="tool-tree" role="tree" aria-label="MCP Tools">
        {connections.map((connection) => {
          const isCollapsed = collapsed.has(connection.id);
          const tools = filtered[connection.id] ?? [];
          const refreshing = refreshingConnectionIds.has(connection.id);
          const isReady = readyConnectionIds.has(connection.id);
          return (
            <li key={connection.id} role="none" className="tool-connection-group">
              <div className="tool-connection-group__heading">
                <button
                  type="button"
                  className="tool-group-toggle"
                  role="treeitem"
                  aria-expanded={!isCollapsed}
                  aria-label={`${isCollapsed ? "展开" : "折叠"} ${connection.name}`}
                  onClick={() => toggle(connection.id)}
                >
                  <span aria-hidden="true">{isCollapsed ? "▸" : "▾"}</span>
                  <span aria-hidden="true" className="tool-group-name">
                    {Array.from(connection.name).map((character, index) => (
                      <span key={index}>{character}</span>
                    ))}
                  </span>
                </button>
                <span className="catalog-readiness" role="status" aria-live="polite">
                  {refreshing
                    ? "正在刷新 Tool 目录"
                    : connection.status === "connected"
                    ? isReady ? "目录已就绪" : "已连接，目录未就绪"
                    : "连接后可刷新"}
                </span>
                <button
                  type="button"
                  className="button-secondary tool-refresh-button"
                  aria-label={`刷新 ${connection.name} Tools`}
                  disabled={refreshing || connection.status !== "connected"}
                  onClick={() => onRefresh(connection.id)}
                >
                  <ArrowClockwise size={16} aria-hidden="true" />
                  <span className="sr-only">{refreshing ? "刷新中" : "刷新"}</span>
                </button>
              </div>
              {errors[connection.id] !== undefined && (
                <p role="alert" className="tool-error">{errors[connection.id]}</p>
              )}
              {!isCollapsed && (
                <ul role="group" className="tool-items">
                  {tools.map((tool) => (
                    <li key={tool.name} role="none">
                      <button
                        type="button"
                        role="treeitem"
                        className="tool-item"
                        aria-label={`${tool.name}，${statusLabels[tool.status]}`}
                        onClick={(event) => select(tool, event)}
                        onDoubleClick={() => open(tool)}
                      >
                        <span className="tool-item__copy">
                          <strong>{tool.name}</strong>
                          {typeof tool.currentSnapshot.definition.description === "string" && (
                            <span>{summarizeToolDescription(tool.currentSnapshot.definition.description)}</span>
                          )}
                        </span>
                        <span className={`tool-status tool-status--${tool.status}`}>
                          {statusLabels[tool.status]}
                        </span>
                      </button>
                    </li>
                  ))}
                  {tools.length === 0 && (
                    <li role="none" className="tool-empty">
                      {normalizedQuery.length > 0 ? "没有匹配的 Tool" : "暂无 Tool 快照"}
                    </li>
                  )}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
