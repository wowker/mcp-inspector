import {
  useEffect, useMemo, useRef, useState,
  type DragEvent, type FormEvent, type MouseEvent,
} from "react";
import {
  ArrowClockwise, FolderPlus, FolderSimple, FolderSimplePlus, MagnifyingGlass, X,
} from "@phosphor-icons/react";
import type {
  CatalogToolSummary, ConnectionSummary, ToolFolderSummary,
} from "../../api/api-client.js";
import { summarizeToolDescription } from "./tool-description.js";

interface ToolTreeProps {
  connections: ConnectionSummary[];
  catalogs: Readonly<Record<string, CatalogToolSummary[]>>;
  folders?: readonly ToolFolderSummary[];
  refreshingConnectionIds?: ReadonlySet<string>;
  onRefresh: (connectionId: string) => void;
  onSelectTool: (tool: CatalogToolSummary) => void;
  onOpenTool: (tool: CatalogToolSummary) => void;
  onDeleteTool?: (tool: CatalogToolSummary) => Promise<void>;
  onCreateFolder?: (name: string) => Promise<void>;
  onMoveTool?: (tool: CatalogToolSummary, folderId: string | null) => Promise<void>;
  selectedTool?: { connectionId: string; name: string } | null;
}

const statusLabels: Record<CatalogToolSummary["status"], string> = {
  current: "当前", changed: "已变化", removed: "已移除",
};
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
    searchable.includes(token) || isSubsequence(token, searchable));
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
  connections, catalogs, folders = [], refreshingConnectionIds = new Set(), onRefresh,
  onSelectTool, onOpenTool, onDeleteTool = async () => undefined,
  onCreateFolder = async () => undefined, onMoveTool = async () => undefined,
  selectedTool = null,
}: ToolTreeProps) {
  const connection = connections[0] ?? null;
  const pendingSelection = useRef<{ timer: ReturnType<typeof setTimeout>; tool: CatalogToolSummary } | null>(null);
  const draggedTool = useRef<CatalogToolSummary | null>(null);
  const [query, setQuery] = useState("");
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [folderName, setFolderName] = useState("");
  const [folderPending, setFolderPending] = useState(false);
  const [organizeError, setOrganizeError] = useState<string | null>(null);
  const [movingToolName, setMovingToolName] = useState<string | null>(null);
  const [dragTarget, setDragTarget] = useState<string | null | undefined>(undefined);
  const [pendingDelete, setPendingDelete] = useState<CatalogToolSummary | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const deleteTrigger = useRef<HTMLButtonElement | null>(null);
  const normalizedQuery = normalizeSearch(query);
  const tools = connection === null ? [] : catalogs[connection.id] ?? [];
  const activeFolders = useMemo(() => [...folders]
    .filter((folder) => connection !== null && folder.connectionId === connection.id)
    .sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: "base", numeric: true }) ||
      left.id.localeCompare(right.id)), [connection, folders]);
  const knownFolderIds = useMemo(() => new Set(activeFolders.map(({ id }) => id)), [activeFolders]);
  const filteredTools = useMemo(() => {
    if (normalizedQuery.length === 0) return tools;
    return tools.map((tool, index) => ({ tool, index, rank: searchRank(query, tool) }))
      .filter((candidate): candidate is { tool: CatalogToolSummary; index: number; rank: number } => candidate.rank !== null)
      .sort((left, right) => left.rank - right.rank || left.index - right.index)
      .map(({ tool }) => tool);
  }, [normalizedQuery, query, tools]);

  useEffect(() => () => {
    if (pendingSelection.current !== null) clearTimeout(pendingSelection.current.timer);
  }, []);

  function select(tool: CatalogToolSummary, event: MouseEvent<HTMLButtonElement>): void {
    if (tool.status === "removed") {
      if (pendingSelection.current !== null) clearTimeout(pendingSelection.current.timer);
      pendingSelection.current = null;
      deleteTrigger.current = event.currentTarget;
      setDeleteError(null); setPendingDelete(tool); return;
    }
    if (event.detail === 0) { onSelectTool(tool); return; }
    if (event.detail > 1) {
      if (pendingSelection.current !== null) clearTimeout(pendingSelection.current.timer);
      pendingSelection.current = null; return;
    }
    if (pendingSelection.current !== null) {
      clearTimeout(pendingSelection.current.timer); onSelectTool(pendingSelection.current.tool);
    }
    const timer = setTimeout(() => {
      if (pendingSelection.current?.timer !== timer) return;
      pendingSelection.current = null; onSelectTool(tool);
    }, POINTER_DOUBLE_CLICK_WINDOW_MS);
    pendingSelection.current = { timer, tool };
  }

  function open(tool: CatalogToolSummary): void {
    if (tool.status === "removed") return;
    if (pendingSelection.current !== null) clearTimeout(pendingSelection.current.timer);
    pendingSelection.current = null; onOpenTool(tool);
  }

  async function confirmDelete(): Promise<void> {
    if (pendingDelete === null || deleting) return;
    setDeleting(true); setDeleteError(null);
    try {
      await onDeleteTool(pendingDelete); setPendingDelete(null);
      queueMicrotask(() => deleteTrigger.current?.focus());
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : "无法删除已移除 Tool");
    } finally { setDeleting(false); }
  }

  async function createFolder(event: FormEvent): Promise<void> {
    event.preventDefault();
    const name = folderName.trim();
    if (name.length === 0 || folderPending) return;
    setFolderPending(true); setOrganizeError(null);
    try {
      await onCreateFolder(name); setFolderName(""); setCreatingFolder(false);
    } catch (error) {
      setOrganizeError(error instanceof Error ? error.message : "无法创建文件夹");
    } finally { setFolderPending(false); }
  }

  async function move(tool: CatalogToolSummary, folderId: string | null): Promise<void> {
    if (movingToolName !== null || tool.folderId === folderId) return;
    setMovingToolName(tool.name); setOrganizeError(null);
    try { await onMoveTool(tool, folderId); }
    catch (error) { setOrganizeError(error instanceof Error ? error.message : "无法移动 Tool"); }
    finally {
      setMovingToolName(null); setDragTarget(undefined); draggedTool.current = null;
    }
  }

  function dragStart(event: DragEvent<HTMLLIElement>, tool: CatalogToolSummary): void {
    if (tool.status === "removed" || (event.target as HTMLElement).closest(".tool-move-control") !== null) {
      event.preventDefault(); return;
    }
    draggedTool.current = tool;
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", tool.name);
  }

  function drop(event: DragEvent, folderId: string | null): void {
    event.preventDefault();
    const tool = draggedTool.current;
    setDragTarget(undefined);
    if (tool !== null) void move(tool, folderId);
  }

  function renderTool(tool: CatalogToolSummary) {
    const active = selectedTool?.connectionId === tool.connectionId && selectedTool.name === tool.name;
    return <li key={tool.name} role="none" className="tool-row"
      draggable={tool.status !== "removed" && movingToolName !== tool.name}
      onDragStart={(event) => dragStart(event, tool)}
      onDragEnd={() => { draggedTool.current = null; setDragTarget(undefined); }}>
      <button type="button" role="treeitem" className={`tool-item${active ? " tool-item--selected" : ""}`}
        aria-current={active ? "true" : undefined}
        aria-label={`${tool.name}${tool.status === "current" ? "" : `，${statusLabels[tool.status]}`}`}
        onClick={(event) => select(tool, event)} onDoubleClick={() => open(tool)}>
        <span className="tool-item__copy"><strong>{tool.name}</strong></span>
        {tool.status !== "current" && <span className={`tool-status tool-status--${tool.status}`}>
          {statusLabels[tool.status]}
        </span>}
      </button>
      {tool.status !== "removed" && activeFolders.length > 0 && <label className="tool-move-control" title="移动到文件夹">
        <FolderSimplePlus size={15} weight="bold" aria-hidden="true" />
        <select aria-label={`移动 ${tool.name} 到文件夹`} value={tool.folderId ?? ""}
          disabled={movingToolName !== null} onChange={(event) => void move(tool, event.target.value || null)}>
          <option value="">未分类</option>
          {activeFolders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}
        </select>
      </label>}
    </li>;
  }

  const unfiled = tools.filter((tool) => tool.folderId === null || !knownFolderIds.has(tool.folderId));
  const refreshing = connection !== null && refreshingConnectionIds.has(connection.id);

  return <section className="tool-tree-panel" aria-labelledby="tool-tree-title">
    <div className="tool-tree-panel__heading">
      <p className="eyebrow" id="tool-tree-title">Tool Catalog</p>
      <div className="tool-catalog-actions">
        <button type="button" className="button-secondary" aria-label="创建文件夹" title="创建文件夹"
          onClick={() => { setCreatingFolder(true); setOrganizeError(null); }}>
          <FolderPlus size={16} weight="bold" aria-hidden="true" />
        </button>
        {connection !== null && <button type="button" className="button-secondary tool-refresh-button"
          aria-label={`刷新 ${connection.name} Tools`} title="刷新 Tool 目录"
          disabled={refreshing || connection.status !== "connected"} onClick={() => onRefresh(connection.id)}>
          <ArrowClockwise size={16} aria-hidden="true" />
          <span className="sr-only">{refreshing ? "刷新中" : "刷新"}</span>
        </button>}
      </div>
      <div className="tool-search-wrap">
        <MagnifyingGlass size={15} weight="bold" aria-hidden="true" />
        <input className="tool-search" type="search" aria-label="搜索 Tool" value={query}
          onChange={(event) => setQuery(event.target.value)} placeholder="搜索名称或描述" />
        {query !== "" && <button type="button" aria-label="清除 Tool 搜索" onClick={() => setQuery("")}>
          <X size={14} weight="bold" aria-hidden="true" />
        </button>}
      </div>
    </div>

    {creatingFolder && <form className="tool-folder-create" onSubmit={(event) => void createFolder(event)}>
      <FolderSimple size={16} weight="fill" aria-hidden="true" />
      <input autoFocus aria-label="文件夹名称" value={folderName} maxLength={80}
        onChange={(event) => setFolderName(event.target.value)} placeholder="文件夹名称" />
      <button type="submit" disabled={folderPending || folderName.trim().length === 0}>创建</button>
      <button type="button" className="button-secondary" disabled={folderPending}
        onClick={() => { setCreatingFolder(false); setFolderName(""); }}>取消</button>
    </form>}
    {organizeError !== null && <p className="tool-organize-error" role="alert">{organizeError}</p>}

    <ul className="tool-tree" role="tree" aria-label="MCP Tools">
      {normalizedQuery.length > 0 ? filteredTools.map(renderTool) : <>
        {activeFolders.map((folder) => {
          const folderTools = tools.filter((tool) => tool.folderId === folder.id);
          return <li key={folder.id} role="none"
            className={`tool-folder-group${dragTarget === folder.id ? " tool-folder-group--dragover" : ""}`}
            onDragEnter={(event) => { event.preventDefault(); setDragTarget(folder.id); }}
            onDragOver={(event) => event.preventDefault()} onDrop={(event) => drop(event, folder.id)}>
            <div className="tool-folder-heading" role="treeitem" tabIndex={0}
              aria-label={`${folder.name} 文件夹，${folderTools.length} 个 Tool`}>
              <FolderSimple size={16} weight="fill" aria-hidden="true" />
              <strong>{folder.name}</strong><span>{folderTools.length}</span>
            </div>
            <ul role="group" className="tool-items">
              {folderTools.map(renderTool)}
              {folderTools.length === 0 && <li role="none" className="tool-folder-empty">拖拽 Tool 到这里</li>}
            </ul>
          </li>;
        })}
        <li role="none" className={`tool-unfiled${dragTarget === null ? " tool-unfiled--dragover" : ""}`}
          onDragEnter={(event) => { event.preventDefault(); setDragTarget(null); }}
          onDragOver={(event) => event.preventDefault()} onDrop={(event) => drop(event, null)}>
          {activeFolders.length > 0 && <div className="tool-unfiled-heading">未分类 <span>{unfiled.length}</span></div>}
          <ul role="group" className="tool-items">
            {unfiled.map(renderTool)}
            {tools.length === 0 && <li role="none" className="tool-empty">暂无 Tool 快照</li>}
          </ul>
        </li>
      </>}
      {normalizedQuery.length > 0 && filteredTools.length === 0 &&
        <li role="none" className="tool-empty">没有匹配的 Tool</li>}
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
  </section>;
}
