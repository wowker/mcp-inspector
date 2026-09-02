import {
  useEffect, useMemo, useRef, useState,
  type DragEvent, type FormEvent, type MouseEvent,
} from "react";
import {
  ArrowClockwise, CaretLeft, CaretRight, DotsThree, FolderPlus, FolderSimple,
  MagnifyingGlass, PencilSimple, Star, Trash, X,
} from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import { Dialog } from "../../components/overlays/Dialog.js";
import type {
  CatalogToolSummary, ConnectionSummary, ToolFolderSummary,
} from "../../api/api-client.js";
import { summarizeToolDescription } from "./tool-description.js";
import { ToolFolderSelect } from "./ToolFolderSelect.js";

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
  onRenameFolder?: (folder: ToolFolderSummary, name: string) => Promise<void>;
  onDeleteFolder?: (folder: ToolFolderSummary) => Promise<void>;
  onMoveTool?: (tool: CatalogToolSummary, folderId: string | null) => Promise<void>;
  onToggleFavorite?: (tool: CatalogToolSummary) => Promise<void>;
  selectedTool?: { connectionId: string; name: string } | null;
}

const POINTER_DOUBLE_CLICK_WINDOW_MS = 500;
const TOOL_PAGE_SIZE = 200;

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

function fuzzyMatches(normalizedQuery: string, normalizedValue: string): boolean {
  return normalizedQuery.split(" ").every((token) =>
    normalizedValue.includes(token) || isSubsequence(token, normalizedValue));
}

function canonicalIdentifier(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase().trim();
}

interface ToolSearchEntry {
  rawName: string;
  normalizedName: string;
  normalizedDescription: string;
}

function indexToolSearch(tool: CatalogToolSummary): ToolSearchEntry {
  const description = tool.currentSnapshot.definition.description;
  const summary = typeof description === "string" ? summarizeToolDescription(description) : "";
  return {
    rawName: canonicalIdentifier(tool.name),
    normalizedName: normalizeSearch(tool.name),
    normalizedDescription: normalizeSearch(summary),
  };
}

function searchRank(rawQuery: string, normalizedQuery: string, entry: ToolSearchEntry): number | null {
  if (entry.rawName === rawQuery) return 0;
  if (entry.normalizedName.startsWith(normalizedQuery)) return 1;
  if (entry.normalizedName.includes(normalizedQuery)) return 2;
  if (fuzzyMatches(normalizedQuery, entry.normalizedName)) return 3;
  if (entry.normalizedDescription.includes(normalizedQuery)) return 4;
  if (fuzzyMatches(normalizedQuery, entry.normalizedDescription)) return 5;
  return null;
}

export function ToolTree({
  connections, catalogs, folders = [], refreshingConnectionIds = new Set(), onRefresh,
  onSelectTool, onOpenTool, onDeleteTool = async () => undefined,
  onCreateFolder = async () => undefined, onMoveTool = async () => undefined,
  onRenameFolder = async () => undefined, onDeleteFolder = async () => undefined,
  onToggleFavorite = async () => undefined,
  selectedTool = null,
}: ToolTreeProps) {
  const { t, i18n } = useTranslation("tools");
  const statusLabels: Record<CatalogToolSummary["status"], string> = {
    current: t("catalog.status.current"), changed: t("catalog.status.changed"), removed: t("catalog.status.removed"),
  };
  const connection = connections[0] ?? null;
  const pendingSelection = useRef<{ timer: ReturnType<typeof setTimeout>; tool: CatalogToolSummary } | null>(null);
  const draggedTool = useRef<CatalogToolSummary | null>(null);
  const treeRef = useRef<HTMLUListElement | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "favorite" | "recent" | "changed" | "removed">("all");
  const [catalogPage, setCatalogPage] = useState(0);
  const [favoritePending, setFavoritePending] = useState<string | null>(null);
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [folderName, setFolderName] = useState("");
  const [folderPending, setFolderPending] = useState(false);
  const [organizeError, setOrganizeError] = useState<string | null>(null);
  const [movingToolName, setMovingToolName] = useState<string | null>(null);
  const [dragTarget, setDragTarget] = useState<string | null | undefined>(undefined);
  const [pendingDelete, setPendingDelete] = useState<CatalogToolSummary | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [collapsedFolderIds, setCollapsedFolderIds] = useState<ReadonlySet<string>>(
    () => new Set(folders.map(({ id }) => id)),
  );
  const seenFolderIds = useRef(new Set(folders.map(({ id }) => id)));
  const [folderMenuId, setFolderMenuId] = useState<string | null>(null);
  const [renamingFolder, setRenamingFolder] = useState<ToolFolderSummary | null>(null);
  const [renameName, setRenameName] = useState("");
  const [deletingFolder, setDeletingFolder] = useState<ToolFolderSummary | null>(null);
  const [folderActionPending, setFolderActionPending] = useState(false);
  const folderMenuRef = useRef<HTMLDivElement | null>(null);
  const folderMenuTriggerRef = useRef<HTMLButtonElement | null>(null);
  const renameInputRef = useRef<HTMLInputElement | null>(null);
  const deleteFolderButtonRef = useRef<HTMLButtonElement | null>(null);
  const deleteToolButtonRef = useRef<HTMLButtonElement | null>(null);
  const deleteTrigger = useRef<HTMLButtonElement | null>(null);
  const rawQuery = canonicalIdentifier(query);
  const normalizedQuery = normalizeSearch(query);
  const tools = connection === null ? [] : catalogs[connection.id] ?? [];
  const searchIndex = useMemo(() => new Map(tools.map((tool) => [tool.name, indexToolSearch(tool)])), [tools]);
  const activeFolders = useMemo(() => [...folders]
    .filter((folder) => connection !== null && folder.connectionId === connection.id)
    .sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: "base", numeric: true }) ||
      left.id.localeCompare(right.id)), [connection, folders]);
  const knownFolderIds = useMemo(() => new Set(activeFolders.map(({ id }) => id)), [activeFolders]);
  useEffect(() => {
    const newFolderIds = activeFolders
      .map(({ id }) => id)
      .filter((id) => !seenFolderIds.current.has(id));
    if (newFolderIds.length === 0) return;
    newFolderIds.forEach((id) => seenFolderIds.current.add(id));
    setCollapsedFolderIds((current) => new Set([...current, ...newFolderIds]));
  }, [activeFolders]);
  const scopedTools = useMemo(() => {
    const matching = tools.filter((tool) => filter === "all" ||
      (filter === "favorite" && tool.favorite) ||
      (filter === "recent" && tool.lastUsedAt !== null) || tool.status === filter);
    return filter === "recent"
      ? [...matching].sort((left, right) => (right.lastUsedAt ?? "").localeCompare(left.lastUsedAt ?? ""))
      : matching;
  }, [filter, tools]);
  const filteredTools = useMemo(() => {
    if (normalizedQuery.length === 0) return scopedTools;
    return scopedTools.map((tool, index) => ({
      tool, index, rank: searchRank(rawQuery, normalizedQuery, searchIndex.get(tool.name)!),
    }))
      .filter((candidate): candidate is { tool: CatalogToolSummary; index: number; rank: number } => candidate.rank !== null)
      .sort((left, right) => left.rank - right.rank || left.index - right.index)
      .map(({ tool }) => tool);
  }, [normalizedQuery, rawQuery, scopedTools, searchIndex]);
  const unfiled = useMemo(() => tools.filter((tool) =>
    tool.folderId === null || !knownFolderIds.has(tool.folderId)), [knownFolderIds, tools]);
  const expandedCatalogTools = useMemo(() => [
    ...activeFolders.flatMap((folder) => collapsedFolderIds.has(folder.id)
      ? [] : tools.filter((tool) => tool.folderId === folder.id)),
    ...unfiled,
  ], [activeFolders, collapsedFolderIds, tools, unfiled]);
  const pageSource = normalizedQuery.length > 0 || filter !== "all" ? filteredTools : expandedCatalogTools;
  const pageCount = Math.max(1, Math.ceil(pageSource.length / TOOL_PAGE_SIZE));
  const currentPage = Math.min(catalogPage, pageCount - 1);
  const pageStart = currentPage * TOOL_PAGE_SIZE;
  const visibleTools = pageSource.slice(pageStart, pageStart + TOOL_PAGE_SIZE);
  const hasBoundedPages = pageSource.length > TOOL_PAGE_SIZE;
  const numberFormat = useMemo(() => new Intl.NumberFormat(i18n.resolvedLanguage ?? i18n.language),
    [i18n.language, i18n.resolvedLanguage]);

  useEffect(() => { setCatalogPage(0); }, [connection?.id]);

  useEffect(() => {
    if (treeRef.current !== null) treeRef.current.scrollTop = 0;
  }, [currentPage, filter, normalizedQuery]);

  useEffect(() => {
    if (selectedTool === null || selectedTool.connectionId !== connection?.id) return;
    const selectedIndex = pageSource.findIndex((tool) => tool.name === selectedTool.name);
    if (selectedIndex >= 0) setCatalogPage(Math.floor(selectedIndex / TOOL_PAGE_SIZE));
  }, [connection?.id, pageSource, selectedTool]);

  useEffect(() => () => {
    if (pendingSelection.current !== null) clearTimeout(pendingSelection.current.timer);
  }, []);

  useEffect(() => {
    if (folderMenuId === null) return;
    function close(event: PointerEvent): void {
      if (!folderMenuRef.current?.contains(event.target as Node)) setFolderMenuId(null);
    }
    function escape(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        setFolderMenuId(null);
        queueMicrotask(() => folderMenuTriggerRef.current?.focus());
      }
    }
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", escape);
    };
  }, [folderMenuId]);

  function closeFolderDialog(kind: "rename" | "delete"): void {
    if (kind === "rename") setRenamingFolder(null); else setDeletingFolder(null);
    queueMicrotask(() => folderMenuTriggerRef.current?.focus());
  }

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
      setDeleteError(error instanceof Error ? error.message : t("catalog.errors.deleteTool"));
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
      setOrganizeError(error instanceof Error ? error.message : t("catalog.errors.createFolder"));
    } finally { setFolderPending(false); }
  }

  async function move(tool: CatalogToolSummary, folderId: string | null): Promise<void> {
    if (movingToolName !== null || tool.folderId === folderId) return;
    setMovingToolName(tool.name); setOrganizeError(null);
    try { await onMoveTool(tool, folderId); }
    catch (error) { setOrganizeError(error instanceof Error ? error.message : t("catalog.errors.moveTool")); }
    finally {
      setMovingToolName(null); setDragTarget(undefined); draggedTool.current = null;
    }
  }

  async function toggleFavorite(tool: CatalogToolSummary): Promise<void> {
    if (favoritePending !== null) return;
    setFavoritePending(tool.name); setOrganizeError(null);
    try { await onToggleFavorite(tool); }
    catch (error) { setOrganizeError(error instanceof Error ? error.message : t("catalog.errors.favorite")); }
    finally { setFavoritePending(null); }
  }

  async function renameFolder(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (renamingFolder === null || folderActionPending || renameName.trim().length === 0) return;
    setFolderActionPending(true); setOrganizeError(null);
    try { await onRenameFolder(renamingFolder, renameName.trim()); closeFolderDialog("rename"); }
    catch (error) { setOrganizeError(error instanceof Error ? error.message : t("catalog.errors.renameFolder")); }
    finally { setFolderActionPending(false); }
  }

  async function deleteFolder(): Promise<void> {
    if (deletingFolder === null || folderActionPending) return;
    setFolderActionPending(true); setOrganizeError(null);
    try { await onDeleteFolder(deletingFolder); closeFolderDialog("delete"); }
    catch (error) { setOrganizeError(error instanceof Error ? error.message : t("catalog.errors.deleteFolder")); }
    finally { setFolderActionPending(false); }
  }

  function dragStart(event: DragEvent<HTMLLIElement>, tool: CatalogToolSummary): void {
    if (tool.status === "removed" ||
      (event.target as HTMLElement).closest(".tool-move-control, .tool-favorite") !== null) {
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
    return <li key={tool.name} className="tool-row"
      draggable={tool.status !== "removed" && movingToolName !== tool.name}
      onDragStart={(event) => dragStart(event, tool)}
      onDragEnd={() => { draggedTool.current = null; setDragTarget(undefined); }}>
      <button type="button" className={`tool-item${active ? " tool-item--selected" : ""}`}
        aria-current={active ? "true" : undefined}
        aria-label={tool.status === "current" ? tool.name : t("catalog.toolAria", { name: tool.name, status: statusLabels[tool.status] })}
        onClick={(event) => select(tool, event)} onDoubleClick={() => open(tool)}>
        <span className="tool-item__copy"><strong>{tool.name}</strong></span>
        {tool.status !== "current" && <span className={`tool-status tool-status--${tool.status}`}>
          {statusLabels[tool.status]}
        </span>}
      </button>
      <button type="button" className={`tool-favorite${tool.favorite ? " tool-favorite--active" : ""}`}
        aria-label={tool.favorite ? t("catalog.unfavoriteAria", { name: tool.name }) : t("catalog.favoriteAria", { name: tool.name })}
        aria-pressed={tool.favorite} disabled={favoritePending !== null}
        onClick={() => void toggleFavorite(tool)}>
        <Star size={16} weight={tool.favorite ? "fill" : "regular"} aria-hidden="true" />
      </button>
      {tool.status !== "removed" && activeFolders.length > 0 && <ToolFolderSelect
        ariaLabel={t("catalog.moveAria", { name: tool.name })} disabled={movingToolName !== null}
        folderId={tool.folderId} folders={activeFolders} title={t("catalog.moveTitle")}
        unfiledLabel={t("catalog.unfiled")} onChange={(folderId) => void move(tool, folderId)} />}
    </li>;
  }

  const refreshing = connection !== null && refreshingConnectionIds.has(connection.id);

  return <section className="tool-tree-panel" aria-labelledby="tool-tree-title">
    <div className="tool-tree-panel__heading">
      <p className="eyebrow" id="tool-tree-title">{t("catalog.title")}</p>
      <div className="tool-catalog-actions">
        <button type="button" className="button-secondary" aria-label={t("catalog.createFolder")} title={t("catalog.createFolder")}
          onClick={() => { setCreatingFolder(true); setOrganizeError(null); }}>
          <FolderPlus size={16} weight="bold" aria-hidden="true" />
        </button>
        {connection !== null && <button type="button" className="button-secondary tool-refresh-button"
          aria-label={t("catalog.refreshAria", { name: connection.name })} title={t("catalog.refreshTitle")}
          disabled={refreshing || connection.status !== "connected"} onClick={() => onRefresh(connection.id)}>
          <ArrowClockwise size={16} aria-hidden="true" />
          <span className="sr-only">{refreshing ? t("catalog.refreshing") : t("catalog.refresh")}</span>
        </button>}
      </div>
      <div className="tool-search-wrap">
        <MagnifyingGlass size={15} weight="bold" aria-hidden="true" />
        <input className="tool-search" type="search" aria-label={t("catalog.searchAria")} value={query}
          onChange={(event) => { setQuery(event.target.value); setCatalogPage(0); }} placeholder={t("catalog.searchPlaceholder")} />
        {query !== "" && <button type="button" aria-label={t("catalog.clearSearch")} onClick={() => {
          setQuery(""); setCatalogPage(0);
        }}>
          <X size={14} weight="bold" aria-hidden="true" />
        </button>}
      </div>
      <div className="tool-catalog-filters" role="group" aria-label={t("catalog.filterLabel")}>
        {(["all", "favorite", "recent", "changed", "removed"] as const).map((value) =>
          <button key={value} type="button" aria-pressed={filter === value}
            onClick={() => { setFilter(value); setCatalogPage(0); }}>{t(`catalog.filters.${value}`)}</button>)}
      </div>
    </div>

    {creatingFolder && <form className="tool-folder-create" onSubmit={(event) => void createFolder(event)}>
      <FolderSimple size={16} weight="fill" aria-hidden="true" />
      <input autoFocus aria-label={t("catalog.folderName")} value={folderName} maxLength={80}
        onChange={(event) => setFolderName(event.target.value)} placeholder={t("catalog.folderName")} />
      <button type="submit" disabled={folderPending || folderName.trim().length === 0}>{t("catalog.create")}</button>
      <button type="button" className="button-secondary" disabled={folderPending}
        onClick={() => { setCreatingFolder(false); setFolderName(""); }}>{t("catalog.cancel")}</button>
    </form>}
    {organizeError !== null && renamingFolder === null && deletingFolder === null &&
      <p className="tool-organize-error" role="alert">{organizeError}</p>}

    <ul ref={treeRef} className="tool-tree" aria-label={t("catalog.treeLabel")}>
      {normalizedQuery.length > 0 || filter !== "all" ? visibleTools.map(renderTool) : <>
        {activeFolders.map((folder) => {
          const folderTools = tools.filter((tool) => tool.folderId === folder.id);
          const visibleFolderTools = visibleTools.filter((tool) => tool.folderId === folder.id);
          const collapsed = collapsedFolderIds.has(folder.id);
          return <li key={folder.id}
            className={`tool-folder-group${dragTarget === folder.id ? " tool-folder-group--dragover" : ""}`}
            onDragEnter={(event) => { event.preventDefault(); setDragTarget(folder.id); }}
            onDragOver={(event) => event.preventDefault()} onDrop={(event) => drop(event, folder.id)}>
            <div className="tool-folder-heading-row">
            <button type="button" className="tool-folder-heading"
              aria-expanded={!collapsed} aria-label={t("catalog.folderAria", { name: folder.name, count: folderTools.length })}
              onClick={() => {
                setCatalogPage(0);
                setCollapsedFolderIds((current) => {
                const next = new Set(current);
                if (next.has(folder.id)) next.delete(folder.id); else next.add(folder.id);
                return next;
                });
              }}>
              <CaretRight className="tool-folder-caret" size={13} weight="bold" aria-hidden="true" />
              <FolderSimple size={16} weight="fill" aria-hidden="true" />
              <strong>{folder.name}</strong><span>{folderTools.length}</span>
            </button>
            <div className="tool-folder-menu-wrap" ref={folderMenuId === folder.id ? folderMenuRef : undefined}>
              <button type="button" className="tool-folder-actions" aria-label={t("catalog.folderActions", { name: folder.name })}
                aria-haspopup="menu" aria-expanded={folderMenuId === folder.id}
                onClick={(event) => {
                  folderMenuTriggerRef.current = event.currentTarget;
                  setFolderMenuId((current) => current === folder.id ? null : folder.id);
                  queueMicrotask(() => folderMenuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus());
                }}>
                <DotsThree size={18} weight="bold" aria-hidden="true" />
              </button>
              {folderMenuId === folder.id && <div className="tool-folder-menu" role="menu"
                onKeyDown={(event) => {
                  if (event.key === "Tab") {
                    queueMicrotask(() => setFolderMenuId(null));
                    return;
                  }
                  if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
                  const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')];
                  const current = items.indexOf(document.activeElement as HTMLButtonElement);
                  const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1
                    : event.key === "ArrowDown" ? (current + 1) % items.length : (current - 1 + items.length) % items.length;
                  event.preventDefault(); items[next]?.focus();
                }}>
                <button type="button" role="menuitem" onClick={() => {
                  setFolderMenuId(null); setRenameName(folder.name); setRenamingFolder(folder); setOrganizeError(null);
                }}><PencilSimple size={15} aria-hidden="true" />{t("catalog.rename")}</button>
                <button type="button" role="menuitem" className="tool-folder-menu__danger" onClick={() => {
                  setFolderMenuId(null); setDeletingFolder(folder); setOrganizeError(null);
                }}><Trash size={15} aria-hidden="true" />{t("catalog.deleteFolder")}</button>
              </div>}
            </div>
            </div>
            {!collapsed && <ul className="tool-items">
              {visibleFolderTools.map(renderTool)}
              {folderTools.length === 0 && <li className="tool-folder-empty">{t("catalog.dropHere")}</li>}
            </ul>}
          </li>;
        })}
        <li className={`tool-unfiled${dragTarget === null ? " tool-unfiled--dragover" : ""}`}
          onDragEnter={(event) => { event.preventDefault(); setDragTarget(null); }}
          onDragOver={(event) => event.preventDefault()} onDrop={(event) => drop(event, null)}>
          {activeFolders.length > 0 && <div className="tool-unfiled-heading">{t("catalog.unfiled")} <span>{unfiled.length}</span></div>}
          <ul className="tool-items">
            {visibleTools.filter((tool) => tool.folderId === null || !knownFolderIds.has(tool.folderId)).map(renderTool)}
            {tools.length === 0 && <li className="tool-empty">{t("catalog.empty")}</li>}
          </ul>
        </li>
      </>}
      {(normalizedQuery.length > 0 || filter !== "all") && filteredTools.length === 0 &&
        <li className="tool-empty">{t("catalog.noMatches")}</li>}
    </ul>
    {hasBoundedPages && <nav className="tool-catalog-pagination" aria-label={t("catalog.pagination.label")}>
      <span aria-live="polite">{t("catalog.pagination.summary", {
        start: numberFormat.format(pageStart + 1),
        end: numberFormat.format(Math.min(pageStart + TOOL_PAGE_SIZE, pageSource.length)),
        total: numberFormat.format(pageSource.length),
      })}</span>
      <div>
        <button type="button" aria-label={t("catalog.pagination.previous")} disabled={currentPage === 0}
          onClick={() => setCatalogPage((page) => Math.max(0, page - 1))}>
          <CaretLeft size={15} weight="bold" aria-hidden="true" />
        </button>
        <button type="button" aria-label={t("catalog.pagination.next")} disabled={currentPage >= pageCount - 1}
          onClick={() => setCatalogPage((page) => Math.min(pageCount - 1, page + 1))}>
          <CaretRight size={15} weight="bold" aria-hidden="true" />
        </button>
      </div>
    </nav>}

    {renamingFolder !== null && <Dialog titleId="rename-folder-title" initialFocusRef={renameInputRef}
      closeDisabled={folderActionPending} onClose={() => closeFolderDialog("rename")}>
      <form onSubmit={(event) => void renameFolder(event)}>
      <div className="dialog-header dialog-header--compact"><div>
        <p className="dialog-kicker">{t("catalog.folderKicker")}</p><h3 id="rename-folder-title">{t("catalog.renameTitle")}</h3>
      </div></div>
      <label className="tool-folder-dialog-field">{t("catalog.folderName")}
        <input ref={renameInputRef} aria-label={t("catalog.folderName")} maxLength={80} value={renameName}
          onChange={(event) => setRenameName(event.target.value)} />
      </label>
      {organizeError !== null && <p className="connection-error dialog-error" role="alert">{organizeError}</p>}
      <div className="dialog-actions">
        <button type="button" className="button-secondary" disabled={folderActionPending}
          onClick={() => closeFolderDialog("rename")}>{t("catalog.cancel")}</button>
        <button type="submit" disabled={folderActionPending || renameName.trim().length === 0}>{t("catalog.saveChanges")}</button>
      </div>
    </form></Dialog>}

    {deletingFolder !== null && <Dialog titleId="delete-folder-title" initialFocusRef={deleteFolderButtonRef}
      closeDisabled={folderActionPending} onClose={() => closeFolderDialog("delete")}>
      <div className="dialog-header dialog-header--compact"><div>
        <p className="dialog-kicker dialog-kicker--danger">{t("catalog.folderKicker")}</p>
        <h3 id="delete-folder-title">{t("catalog.deleteFolder")}</h3>
        <p>{t("catalog.deleteFolderDescription", { name: deletingFolder.name,
          count: tools.filter((tool) => tool.folderId === deletingFolder.id).length })}</p>
      </div></div>
      {organizeError !== null && <p className="connection-error dialog-error" role="alert">{organizeError}</p>}
      <div className="dialog-actions">
        <button type="button" className="button-secondary" disabled={folderActionPending}
          onClick={() => closeFolderDialog("delete")}>{t("catalog.cancel")}</button>
        <button ref={deleteFolderButtonRef} type="button" className="button-danger" disabled={folderActionPending}
          aria-label={t("catalog.confirmDeleteFolder")} onClick={() => void deleteFolder()}>{t("catalog.confirmDelete")}</button>
      </div>
    </Dialog>}

    {pendingDelete !== null && <Dialog titleId="delete-tool-title" descriptionId="delete-tool-description"
      initialFocusRef={deleteToolButtonRef} closeDisabled={deleting} onClose={() => {
        setPendingDelete(null); queueMicrotask(() => deleteTrigger.current?.focus());
      }}>
        <div className="dialog-header dialog-header--compact"><div>
          <p className="dialog-kicker dialog-kicker--danger">{t("catalog.localCatalogKicker")}</p>
          <h3 id="delete-tool-title">{t("catalog.deleteRemovedTitle")}</h3>
          <p id="delete-tool-description">{t("catalog.deleteRemovedDescription", { name: pendingDelete.name })}</p>
        </div></div>
        {deleteError !== null && <p role="alert" className="connection-error dialog-error">{deleteError}</p>}
        <div className="dialog-actions">
          <button type="button" className="button-secondary" disabled={deleting} onClick={() => {
            setPendingDelete(null); queueMicrotask(() => deleteTrigger.current?.focus());
          }}>{t("catalog.cancel")}</button>
          <button ref={deleteToolButtonRef} type="button" className="button-danger" disabled={deleting}
            aria-label={t("catalog.confirmDeleteTool", { name: pendingDelete.name })} onClick={() => void confirmDelete()}>
            {deleting ? t("catalog.deleting") : t("catalog.confirmDelete")}
          </button>
        </div>
    </Dialog>}
  </section>;
}
