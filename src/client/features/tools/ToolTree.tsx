import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { ArrowClockwise } from "@phosphor-icons/react";
import type { CatalogToolSummary, ConnectionSummary } from "../../api/api-client.js";
import { summarizeToolDescription } from "./tool-description.js";

interface ToolTreeProps {
  connections: ConnectionSummary[];
  catalogs: Readonly<Record<string, CatalogToolSummary[]>>;
  refreshingConnectionIds?: ReadonlySet<string>;
  onRefresh: (connectionId: string) => void;
  onSelectTool: (tool: CatalogToolSummary) => void;
  onOpenTool: (tool: CatalogToolSummary) => void;
  onDeleteTool?: (tool: CatalogToolSummary) => Promise<void>;
}

const statusLabels: Record<CatalogToolSummary["status"], string> = {
  current: "当前",
  changed: "已变化",
  removed: "已移除",
};

// Covers common desktop OS double-click windows while keyboard activation stays immediate.
const POINTER_DOUBLE_CLICK_WINDOW_MS = 500;

function normalizeSearch(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase().replace(/[_/.-]+/g, " ").replace(/\s+/g, " ").trim();
}

function isSubsequence(needle: string, haystack: string): boolean {
  let index = 0;
  for (const character of haystack) {
    if (character === needle[index]) index += 1;
    if (index === needle.length) return true;
  }
  return needle.length === 0;
}

function fuzzyMatches(query: string, value: string): boolean {
  const searchable = normalizeSearch(value);
  return normalizeSearch(query).split(" ").every((token) =>
    searchable.includes(token) || isSubsequence(token, searchable)
  );
}

function canonicalIdentifier(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase().trim();
}

function searchRank(query: string, tool: CatalogToolSummary): number | null {
  const rawQuery = canonicalIdentifier(query);
  const rawName = canonicalIdentifier(tool.name);
  const normalizedQuery = normalizeSearch(query);
  const normalizedName = normalizeSearch(tool.name);
  const description = tool.currentSnapshot.definition.description;
  const summary = typeof description === "string" ? summarizeToolDescription(description) : "";
  const normalizedDescription = normalizeSearch(summary);
  if (rawName === rawQuery) return 0;
  if (normalizedName.startsWith(normalizedQuery)) return 1;
  if (normalizedName.includes(normalizedQuery)) return 2;
  if (fuzzyMatches(normalizedQuery, normalizedName)) return 3;
  if (normalizedDescription.includes(normalizedQuery)) return 4;
  if (fuzzyMatches(normalizedQuery, normalizedDescription)) return 5;
  return null;
}

export function ToolTree({
  connections,
  catalogs,
  refreshingConnectionIds = new Set(),
  onRefresh,
  onSelectTool,
  onOpenTool,
  onDeleteTool = async () => undefined,
}: ToolTreeProps) {
  const pendingSelection = useRef<{
    timer: ReturnType<typeof setTimeout>;
    tool: CatalogToolSummary;
  } | null>(null);
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [pendingDelete, setPendingDelete] = useState<CatalogToolSummary | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const deleteTrigger = useRef<HTMLButtonElement | null>(null);
  const normalizedQuery = normalizeSearch(query);
  const filtered = useMemo(() => Object.fromEntries(connections.map((connection) => {
    const tools = catalogs[connection.id] ?? [];
    if (normalizedQuery.length === 0) return [connection.id, tools];
    return [connection.id, tools.map((tool, index) => ({ tool, index, rank: searchRank(query, tool) }))
      .filter((candidate): candidate is { tool: CatalogToolSummary; index: number; rank: number } => candidate.rank !== null)
      .sort((left, right) => left.rank - right.rank || left.index - right.index)
      .map(({ tool }) => tool)];
  })), [catalogs, connections, normalizedQuery, query]);

  useEffect(() => () => {
    if (pendingSelection.current !== null) clearTimeout(pendingSelection.current.timer);
  }, []);

  function select(tool: CatalogToolSummary, event: MouseEvent<HTMLButtonElement>): void {
    if (tool.status === "removed") {
      if (pendingSelection.current !== null) clearTimeout(pendingSelection.current.timer);
      pendingSelection.current = null;
      deleteTrigger.current = event.currentTarget;
      setDeleteError(null);
      setPendingDelete(tool);
      return;
    }
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
    if (tool.status === "removed") return;
    if (pendingSelection.current !== null) clearTimeout(pendingSelection.current.timer);
    pendingSelection.current = null;
    onOpenTool(tool);
  }

  async function confirmDelete(): Promise<void> {
    if (pendingDelete === null || deleting) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await onDeleteTool(pendingDelete);
      setPendingDelete(null);
      queueMicrotask(() => deleteTrigger.current?.focus());
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : "无法删除已移除 Tool");
    } finally {
      setDeleting(false);
    }
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
        <p className="eyebrow" id="tool-tree-title">Tool Catalog</p>
        <input
          className="tool-search"
          type="search"
          aria-label="搜索 Tool"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索名称或描述"
        />
      </div>

      <ul className="tool-tree" role="tree" aria-label="MCP Tools">
        {connections.map((connection) => {
          const isCollapsed = collapsed.has(connection.id);
          const tools = filtered[connection.id] ?? [];
          const refreshing = refreshingConnectionIds.has(connection.id);
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
              {!isCollapsed && (
                <ul role="group" className="tool-items">
                  {tools.map((tool) => (
                    <li key={tool.name} role="none">
                      <button
                        type="button"
                        role="treeitem"
                        className="tool-item"
                        aria-label={`${tool.name}${tool.status === "current" ? "" : `，${statusLabels[tool.status]}`}`}
                        onClick={(event) => select(tool, event)}
                        onDoubleClick={() => open(tool)}
                      >
                        <span className="tool-item__copy">
                          <strong>{tool.name}</strong>
                        </span>
                        {tool.status !== "current" && <span className={`tool-status tool-status--${tool.status}`}>
                          {statusLabels[tool.status]}
                        </span>}
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
      {pendingDelete !== null && <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => {
        if (event.target === event.currentTarget && !deleting) setPendingDelete(null);
      }}>
        <section className="dialog-surface" role="dialog" aria-modal="true" aria-labelledby="delete-tool-title"
          aria-describedby="delete-tool-description" onKeyDown={(event) => {
            if (event.key === "Escape" && !deleting) setPendingDelete(null);
          }}>
          <div className="dialog-header dialog-header--compact"><div>
            <p className="dialog-kicker dialog-kicker--danger">LOCAL CATALOG</p>
            <h3 id="delete-tool-title">删除已移除 Tool</h3>
            <p id="delete-tool-description">确认从本地 Tool 目录删除 {pendingDelete.name}？既有运行历史仍会保留。</p>
          </div></div>
          {deleteError !== null && <p role="alert" className="connection-error dialog-error">{deleteError}</p>}
          <div className="dialog-actions">
            <button type="button" className="button-secondary" disabled={deleting} onClick={() => {
              setPendingDelete(null); queueMicrotask(() => deleteTrigger.current?.focus());
            }}>取消</button>
            <button type="button" className="button-danger" disabled={deleting}
              aria-label={`确认删除 ${pendingDelete.name}`} onClick={() => void confirmDelete()}>
              {deleting ? "正在删除…" : "确认删除"}
            </button>
          </div>
        </section>
      </div>}
    </section>
  );
}
