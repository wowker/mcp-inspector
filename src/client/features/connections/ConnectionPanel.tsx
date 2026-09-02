import { useEffect, useRef, useState, type FormEvent } from "react";
import { Plus } from "@phosphor-icons/react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import type {
  CatalogToolSummary,
  ConnectionSummary,
  InspectorApiClient,
  ToolFolderSummary,
} from "../../api/api-client.js";
import { ToolTree } from "../tools/ToolTree.js";
import { ConnectionFormDialog, DeleteConnectionDialog } from "./ConnectionDialogs.js";
import type { ConnectionAuthMode } from "../../../shared/connection-auth.js";

interface ConnectionPanelProps {
  api: InspectorApiClient;
  projectId: string;
  onSelectTool?: (tool: CatalogToolSummary) => void;
  onOpenTool?: (tool: CatalogToolSummary) => void;
  mode?: "combined" | "servers" | "tools";
  connectionFilterId?: string | null;
  onConnectionConnected?: (connection: ConnectionSummary) => void;
  onConnectionDisconnected?: (connectionId: string) => void;
  onConnectionsLoaded?: (connections: ConnectionSummary[]) => void;
  connectionUpdate?: ConnectionSummary | null;
  selectedTool?: { connectionId: string; name: string } | null;
}

interface CatalogToast {
  connectionId: string;
  kind: "loading" | "success" | "error";
  message: string;
}

export interface ConnectionHeaderDraft {
  id: number;
  name: string;
  value: string;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export function ConnectionPanel(props: ConnectionPanelProps) {
  return <ProjectScopedConnectionPanel key={props.projectId} {...props} />;
}

function ProjectScopedConnectionPanel({
  api, projectId, onSelectTool = () => undefined, onOpenTool = () => undefined,
  mode = "combined", connectionFilterId = null,
  onConnectionConnected = () => undefined,
  onConnectionDisconnected = () => undefined,
  onConnectionsLoaded = () => undefined,
  connectionUpdate = null,
  selectedTool = null,
}: ConnectionPanelProps) {
  const { t } = useTranslation("servers");
  const mounted = useRef(false);
  const submitLock = useRef(false);
  const dialogTrigger = useRef<HTMLButtonElement | null>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  const catalogGenerations = useRef(new Map<string, number>());
  const catalogSnapshotsRequested = useRef(new Set<string>());
  const catalogToastIds = useRef(new Set<string>());
  const nextHeaderId = useRef(1);
  const [connections, setConnections] = useState<ConnectionSummary[] | null>(null);
  const [catalogs, setCatalogs] = useState<Record<string, CatalogToolSummary[]>>({});
  const [folders, setFolders] = useState<Record<string, ToolFolderSummary[]>>({});
  const [refreshingConnectionIds, setRefreshingConnectionIds] = useState<ReadonlySet<string>>(new Set());
  const [pendingConnectionIds, setPendingConnectionIds] = useState<ReadonlySet<string>>(new Set());
  const [exportingConnectionIds, setExportingConnectionIds] = useState<ReadonlySet<string>>(new Set());
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [timeoutMs, setTimeoutMs] = useState("10000");
  const [authMode, setAuthMode] = useState<ConnectionAuthMode>("none");
  const [bearerToken, setBearerToken] = useState("");
  const [headers, setHeaders] = useState<ConnectionHeaderDraft[]>([]);
  const [redactSensitiveInfo, setRedactSensitiveInfo] = useState(true);
  const [formMode, setFormMode] = useState<"create" | "edit" | null>(null);
  const [editingConnectionId, setEditingConnectionId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);

  useEffect(() => {
    if (connectionUpdate === null || connectionUpdate.projectId !== projectId) return;
    updateConnection(connectionUpdate);
  }, [connectionUpdate, projectId]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      for (const id of catalogToastIds.current) toast.dismiss(id);
      catalogToastIds.current.clear();
    };
  }, []);

  useEffect(() => {
    let active = true;
    setConnections(null);
    setCatalogs({});
    setFolders({});
    setRefreshingConnectionIds(new Set());
    setPendingConnectionIds(new Set());
    setExportingConnectionIds(new Set());
    catalogGenerations.current.clear();
    catalogSnapshotsRequested.current.clear();
    clearCatalogToast();
    setError(null);
    void api.listConnections(projectId)
      .then((items) => {
        if (!active) return;
        setConnections(items);
        onConnectionsLoaded(items);
        for (const connection of items) {
          if (mode === "servers" || (
            connectionFilterId !== null && connection.id !== connectionFilterId
          )) continue;
          if (catalogSnapshotsRequested.current.has(connection.id)) continue;
          catalogSnapshotsRequested.current.add(connection.id);
          const generation = (catalogGenerations.current.get(connection.id) ?? 0) + 1;
          catalogGenerations.current.set(connection.id, generation);
          void Promise.all([
            api.listTools(projectId, connection.id),
            api.listToolFolders(projectId, connection.id),
          ]).then(([tools, toolFolders]) => {
              if (active && catalogGenerations.current.get(connection.id) === generation) {
                setCatalogs((current) => ({ ...current, [connection.id]: tools }));
                setFolders((current) => ({ ...current, [connection.id]: toolFolders }));
              }
            })
            .catch(() => {
              // A passive snapshot miss is superseded by the explicit refresh performed
              // when the Tools workspace opens. User-facing refresh failures are toasted.
            });
        }
      })
      .catch((cause: unknown) => {
        if (active) setError(errorMessage(cause, t("errors.manage")));
      });
    return () => {
      active = false;
    };
  }, [api, projectId, loadAttempt]);

  useEffect(() => {
    if (mode !== "tools" || connections === null || connectionFilterId === null ||
      catalogSnapshotsRequested.current.has(connectionFilterId)) return;
    if (!connections.some(({ id }) => id === connectionFilterId)) return;
    catalogSnapshotsRequested.current.add(connectionFilterId);
    const generation = (catalogGenerations.current.get(connectionFilterId) ?? 0) + 1;
    catalogGenerations.current.set(connectionFilterId, generation);
    void Promise.all([
      api.listTools(projectId, connectionFilterId),
      api.listToolFolders(projectId, connectionFilterId),
    ]).then(([tools, toolFolders]) => {
      if (!mounted.current || catalogGenerations.current.get(connectionFilterId) !== generation) return;
      setCatalogs((current) => ({ ...current, [connectionFilterId]: tools }));
      setFolders((current) => ({ ...current, [connectionFilterId]: toolFolders }));
    }).catch(() => {
      // The remote catalog is refreshed only after connection or by the manual
      // refresh action. A missing local snapshot leaves the catalog empty.
    });
  }, [api, connectionFilterId, connections, mode, projectId]);

  function setPending(connectionId: string, pending: boolean): void {
    setPendingConnectionIds((current) => {
      const next = new Set(current);
      if (pending) next.add(connectionId); else next.delete(connectionId);
      return next;
    });
  }

  function clearCatalogToast(connectionId?: string): void {
    if (connectionId !== undefined) {
      const id = `catalog:${projectId}:${connectionId}`;
      toast.dismiss(id);
      catalogToastIds.current.delete(id);
      return;
    }
    for (const id of catalogToastIds.current) toast.dismiss(id);
    catalogToastIds.current.clear();
  }

  function showCatalogToast(value: CatalogToast, dismissAfterMs?: number): void {
    const id = `catalog:${projectId}:${value.connectionId}`;
    catalogToastIds.current.add(id);
    const options = { id, duration: dismissAfterMs ?? (value.kind === "loading" ? Infinity : undefined) };
    if (value.kind === "loading") toast.loading(value.message, options);
    else if (value.kind === "success") toast.success(value.message, options);
    else toast.error(value.message, options);
  }

  function invalidateConnection(connectionId: string): number {
    const generation = (catalogGenerations.current.get(connectionId) ?? 0) + 1;
    catalogGenerations.current.set(connectionId, generation);
    setRefreshingConnectionIds((current) => {
      const next = new Set(current); next.delete(connectionId); return next;
    });
    clearCatalogToast(connectionId);
    return generation;
  }

  function updateConnection(updated: ConnectionSummary): void {
    setConnections((current) => current?.map((item) => item.id === updated.id ? updated : item) ?? []);
  }

  function closeForm(restoreFocus = true): void {
    setFormMode(null);
    setEditingConnectionId(null);
    setName("");
    setUrl("");
    setTimeoutMs("10000");
    setAuthMode("none");
    setBearerToken("");
    setHeaders([]);
    setRedactSensitiveInfo(true);
    setError(null);
    if (restoreFocus) queueMicrotask(() => dialogTrigger.current?.focus());
  }

  function beginCreate(trigger: HTMLButtonElement): void {
    dialogTrigger.current = trigger;
    setError(null);
    setEditingConnectionId(null);
    setName("");
    setUrl("");
    setTimeoutMs("10000");
    setAuthMode("none");
    setBearerToken("");
    setHeaders([]);
    setRedactSensitiveInfo(true);
    setFormMode("create");
  }

  function beginEdit(connection: ConnectionSummary, trigger: HTMLButtonElement): void {
    dialogTrigger.current = trigger;
    setError(null);
    setPendingDelete(null);
    setEditingConnectionId(connection.id);
    setName(connection.name);
    setUrl(connection.url);
    setTimeoutMs(String(connection.timeoutMs));
    setAuthMode(connection.authMode);
    setBearerToken(connection.bearerToken ?? "");
    setRedactSensitiveInfo(connection.redactSensitiveInfo);
    setHeaders(Object.entries(connection.headers).map(([headerName, value]) => ({
      id: nextHeaderId.current++,
      name: headerName,
      value,
    })));
    setFormMode("edit");
  }

  function buildHeaders(): Record<string, string> {
    const result: Record<string, string> = {};
    const seen = new Set<string>();
    for (const header of headers) {
      const headerName = header.name.trim();
      if (headerName === "" && header.value === "") continue;
      if (headerName === "") throw new Error(t("errors.headerNameRequired"));
      const normalizedName = headerName.toLowerCase();
      if (seen.has(normalizedName)) throw new Error(t("errors.duplicateHeader", { name: headerName }));
      if (authMode !== "none" && normalizedName === "authorization") {
        throw new Error(t("errors.managedAuthorization", { mode: authMode === "oauth" ? "OAuth" : "Bearer Token" }));
      }
      seen.add(normalizedName);
      result[headerName] = header.value;
    }
    return result;
  }

  async function refresh(connectionId: string): Promise<void> {
    const connectionName = connections?.find(({ id }) => id === connectionId)?.name ?? t("catalog.defaultServerName");
    const generation = (catalogGenerations.current.get(connectionId) ?? 0) + 1;
    catalogGenerations.current.set(connectionId, generation);
    setRefreshingConnectionIds((current) => new Set(current).add(connectionId));
    showCatalogToast({
      connectionId,
      kind: "loading",
      message: t("catalog.refreshing", { name: connectionName }),
    });
    try {
      const tools = await api.refreshTools(projectId, connectionId);
      const toolFolders = await api.listToolFolders(projectId, connectionId);
      if (!mounted.current || catalogGenerations.current.get(connectionId) !== generation) return;
      setCatalogs((current) => ({ ...current, [connectionId]: tools }));
      setFolders((current) => ({ ...current, [connectionId]: toolFolders }));
      showCatalogToast({
        connectionId,
        kind: "success",
        message: t("catalog.refreshed", { name: connectionName }),
      }, 2_000);
    } catch (cause) {
      if (!mounted.current || catalogGenerations.current.get(connectionId) !== generation) return;
      showCatalogToast({
        connectionId,
        kind: "error",
        message: t("catalog.refreshFailed", { name: connectionName, error: errorMessage(cause, t("errors.manage")) }),
      }, 4_000);
    } finally {
      if (mounted.current && catalogGenerations.current.get(connectionId) === generation) {
        setRefreshingConnectionIds((current) => {
          const next = new Set(current); next.delete(connectionId); return next;
        });
      }
    }
  }

  async function deleteTool(tool: CatalogToolSummary): Promise<void> {
    const generation = (catalogGenerations.current.get(tool.connectionId) ?? 0) + 1;
    catalogGenerations.current.set(tool.connectionId, generation);
    await api.deleteTool(projectId, tool.connectionId, tool.name);
    if (!mounted.current || catalogGenerations.current.get(tool.connectionId) !== generation) return;
    setCatalogs((current) => ({
      ...current,
      [tool.connectionId]: (current[tool.connectionId] ?? []).filter(({ name }) => name !== tool.name),
    }));
  }

  async function createFolder(connectionId: string, name: string): Promise<void> {
    const folder = await api.createToolFolder(projectId, connectionId, name);
    if (!mounted.current) return;
    setFolders((current) => ({
      ...current,
      [connectionId]: [...(current[connectionId] ?? []), folder],
    }));
  }

  async function renameFolder(folder: ToolFolderSummary, name: string): Promise<void> {
    const updated = await api.renameToolFolder(projectId, folder.connectionId, folder.id, name);
    if (!mounted.current) return;
    setFolders((current) => ({
      ...current,
      [folder.connectionId]: (current[folder.connectionId] ?? []).map((item) =>
        item.id === updated.id ? updated : item),
    }));
  }

  async function deleteFolder(folder: ToolFolderSummary): Promise<void> {
    await api.deleteToolFolder(projectId, folder.connectionId, folder.id);
    if (!mounted.current) return;
    setFolders((current) => ({
      ...current,
      [folder.connectionId]: (current[folder.connectionId] ?? []).filter(({ id }) => id !== folder.id),
    }));
    setCatalogs((current) => ({
      ...current,
      [folder.connectionId]: (current[folder.connectionId] ?? []).map((tool) =>
        tool.folderId === folder.id ? { ...tool, folderId: null } : tool),
    }));
  }

  async function moveTool(tool: CatalogToolSummary, folderId: string | null): Promise<void> {
    const generation = invalidateConnection(tool.connectionId);
    const updated = await api.moveToolToFolder(projectId, tool.connectionId, tool.name, folderId);
    if (!mounted.current || catalogGenerations.current.get(tool.connectionId) !== generation) return;
    setCatalogs((current) => ({
      ...current,
      [tool.connectionId]: (current[tool.connectionId] ?? []).map((item) =>
        item.name === updated.name ? updated : item),
    }));
  }

  function replaceCatalogTool(updated: CatalogToolSummary): void {
    if (!mounted.current) return;
    setCatalogs((current) => ({
      ...current,
      [updated.connectionId]: (current[updated.connectionId] ?? []).map((item) =>
        item.name === updated.name ? updated : item),
    }));
  }

  async function toggleFavorite(tool: CatalogToolSummary): Promise<void> {
    replaceCatalogTool(await api.setToolFavorite(projectId, tool.connectionId, tool.name, !tool.favorite));
  }

  function noteToolUsed(tool: CatalogToolSummary): void {
    void api.markToolUsed(projectId, tool.connectionId, tool.name).then(replaceCatalogTool).catch(() => {
      // Recent-use metadata is supplementary and must never block opening a Tool.
    });
  }

  async function connect(connection: ConnectionSummary): Promise<void> {
    setError(null);
    const generation = invalidateConnection(connection.id);
    setPending(connection.id, true);
    try {
      const connected = await api.connectConnection(projectId, connection.id);
      if (!mounted.current || catalogGenerations.current.get(connection.id) !== generation) return;
      updateConnection(connected);
      if (connected.status === "connected") {
        // Catalog discovery belongs to the successful connection transition. The
        // Tools page only reads the persisted snapshot and never refreshes on mount.
        await refresh(connection.id);
        if (mounted.current) onConnectionConnected(connected);
      }
    } catch (cause) {
      if (mounted.current && catalogGenerations.current.get(connection.id) === generation) {
        const message = errorMessage(cause, t("errors.manage"));
        updateConnection({
          ...connection,
          status: "failed",
          lastError: { code: "MCP_CONNECT_FAILED", message },
        });
        setError(message);
      }
    } finally {
      if (mounted.current) setPending(connection.id, false);
    }
  }

  async function disconnect(connection: ConnectionSummary): Promise<void> {
    setError(null);
    const generation = invalidateConnection(connection.id);
    setPending(connection.id, true);
    try {
      const disconnected = await api.disconnectConnection(projectId, connection.id);
      if (!mounted.current || catalogGenerations.current.get(connection.id) !== generation) return;
      updateConnection(disconnected);
      onConnectionDisconnected(connection.id);
    } catch (cause) {
      if (mounted.current) setError(errorMessage(cause, t("errors.manage")));
    } finally {
      if (mounted.current) setPending(connection.id, false);
    }
  }

  async function save(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (submitLock.current) return;
    submitLock.current = true;
    setError(null);
    setSubmitting(true);
    const editingId = formMode === "edit" ? editingConnectionId : null;
    let generation: number | undefined;
    if (editingId !== null) {
      generation = invalidateConnection(editingId);
      setPending(editingId, true);
    }
    try {
      const customHeaders = buildHeaders();
      if (editingId === null) {
        const created = await api.createConnection(projectId, {
          name: name.trim(),
          url: url.trim(),
          transport: "streamable-http",
          authMode,
          ...(authMode === "bearer" ? { bearerToken } : {}),
          redactSensitiveInfo,
          timeoutMs: Number(timeoutMs),
          ...(Object.keys(customHeaders).length === 0 ? {} : { headers: customHeaders }),
        });
        if (!mounted.current) return;
        setConnections((current) => [
          ...(current ?? []).filter(({ id }) => id !== created.id),
          created,
        ]);
        closeForm();
      } else {
        const updated = await api.updateConnection(projectId, editingId, {
          name: name.trim(),
          url: url.trim(),
          authMode,
          ...(authMode === "bearer" ? { bearerToken } : {}),
          redactSensitiveInfo,
          timeoutMs: Number(timeoutMs),
          headers: customHeaders,
        });
        if (!mounted.current || catalogGenerations.current.get(editingId) !== generation) return;
        updateConnection(updated);
        closeForm();
      }
    } catch (cause) {
      if (mounted.current) setError(errorMessage(cause, t("errors.manage")));
    } finally {
      submitLock.current = false;
      if (mounted.current) {
        setSubmitting(false);
        if (editingId !== null) setPending(editingId, false);
      }
    }
  }

  async function remove(connection: ConnectionSummary): Promise<void> {
    setError(null);
    const generation = invalidateConnection(connection.id);
    setDeleting(true);
    try {
      await api.deleteConnection(projectId, connection.id);
      if (!mounted.current || catalogGenerations.current.get(connection.id) !== generation) return;
      setConnections((current) => current?.filter(({ id }) => id !== connection.id) ?? []);
      onConnectionDisconnected(connection.id);
      setCatalogs((current) => {
        const next = { ...current }; delete next[connection.id]; return next;
      });
      catalogGenerations.current.delete(connection.id);
      if (editingConnectionId === connection.id) closeForm(false);
      setPendingDelete(null);
      queueMicrotask(() => addButton.current?.focus());
    } catch (cause) {
      if (mounted.current) setError(errorMessage(cause, t("errors.manage")));
    } finally {
      if (mounted.current) setDeleting(false);
    }
  }

  function exportFilename(connection: ConnectionSummary): string {
    const name = connection.name.normalize("NFKC")
      .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-")
      .replace(/\s+/g, " ").trim().slice(0, 80);
    return `${name || t("panel.defaultExportName")}-mcp-inspector.json`;
  }

  async function exportConnection(connection: ConnectionSummary): Promise<void> {
    setError(null);
    setExportingConnectionIds((current) => new Set(current).add(connection.id));
    try {
      const blob = await api.exportConnection(projectId, connection.id);
      if (!mounted.current) return;
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = exportFilename(connection);
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
      showCatalogToast({ connectionId: connection.id, kind: "success", message: t("panel.exported", { name: connection.name }) }, 2_000);
    } catch (cause) {
      if (mounted.current) setError(errorMessage(cause, t("errors.manage")));
    } finally {
      if (mounted.current) setExportingConnectionIds((current) => {
        const next = new Set(current); next.delete(connection.id); return next;
      });
    }
  }

  const visibleConnections = connectionFilterId === null
    ? connections
    : connections?.filter(({ id }) => id === connectionFilterId) ?? null;

  return (
    <section
      className={`connection-panel connection-panel--${mode}`}
      aria-label={mode === "tools" ? t("panel.ariaTools") : undefined}
      aria-labelledby={mode === "tools" ? undefined : "connection-panel-title"}
    >
      {mode !== "tools" && <div className="connection-panel__heading">
        <div>
          <h2 id="connection-panel-title">{t("panel.title")}</h2>
          <p>{t("panel.description")}</p>
        </div>
        <button
          ref={addButton}
          type="button"
          className="connection-add-button"
          disabled={connections === null}
          onClick={(event) => beginCreate(event.currentTarget)}
        ><Plus size={16} weight="bold" aria-hidden="true" />{t("panel.add")}</button>
      </div>}

      {error !== null && formMode === null && pendingDelete === null && (
        <div className="connection-load-error">
          <p role="alert" className="connection-error">{error}</p>
          {connections === null && (
            <button
              type="button"
              className="button-secondary"
              aria-label={t("panel.retryAria")}
              onClick={() => setLoadAttempt((attempt) => attempt + 1)}
            >
              {t("panel.retry")}
            </button>
          )}
        </div>
      )}

      {mode !== "tools" && (connections === null && error === null ? (
        <p role="status" className="connection-loading">{t("panel.loading")}</p>
      ) : (
        <div className="connection-table-wrap">
          <table className="connection-table" aria-label={t("panel.tableAria")}>
            <thead>
              <tr>
                <th scope="col">{t("panel.columns.name")}</th>
                <th scope="col">{t("panel.columns.url")}</th>
                <th scope="col">{t("panel.columns.status")}</th>
                <th scope="col" aria-label={t("panel.columns.timeoutAria")}>{t("panel.columns.timeout")}</th>
                <th scope="col" className="connection-table__actions-heading">{t("panel.columns.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {connections?.length === 0 && (
                <tr>
                  <td colSpan={5} className="connection-empty">
                    <span>{t("panel.empty")}</span>
                    <small>{t("panel.emptyHint")}</small>
                  </td>
                </tr>
              )}
              {connections?.map((connection) => (
                <tr key={connection.id}>
                  <td data-label={t("panel.columns.name")}>
                    <strong>{connection.name}</strong>
                    <span className="connection-meta">
                      <span>Streamable HTTP</span><span aria-hidden="true"> · </span><span>{
                        connection.authMode === "oauth" ? "OAuth" :
                          connection.authMode === "bearer" ? "Bearer Token" : t("panel.noAuth")
                      }</span>
                    </span>
                  </td>
                  <td data-label={t("panel.columns.url")}><span className="connection-url" title={connection.url}>{connection.url}</span></td>
                  <td data-label={t("panel.columns.status")}>
                    {connection.authMode === "oauth" && connection.status === "disconnected" ? (
                      <span className="connection-authorization-state">
                        <span className={`connection-status connection-status--${connection.authorizationStatus}`}>
                          {connection.authorizationStatus === "authorized" ? t("panel.authorization.authorized") :
                            connection.authorizationStatus === "authorizing" ? t("panel.authorization.authorizing") : t("panel.authorization.unauthorized")}
                        </span>
                        {connection.authorizationStatus === "authorized" && <span>{t("panel.authorization.pendingConnection")}</span>}
                      </span>
                    ) : (
                      <span className={`connection-status connection-status--${connection.status}`}>
                        {t(`panel.status.${connection.status}`)}
                      </span>
                    )}
                    {connection.lastError !== null && (
                      <span className="connection-last-error">{connection.lastError.message}</span>
                    )}
                  </td>
                  <td data-label={t("panel.columns.timeoutAria")}><span className="connection-timeout">{connection.timeoutMs.toLocaleString()} ms</span></td>
                  <td data-label={t("panel.columns.actions")}>
                    <div className="connection-actions">
                      {connection.status === "connected" ? (
                        <button
                          type="button"
                          className="button-secondary"
                          disabled={pendingConnectionIds.has(connection.id)}
                          aria-label={t("panel.actions.disconnectAria", { name: connection.name })}
                          onClick={() => void disconnect(connection)}
                        >{t("panel.actions.disconnect")}</button>
                      ) : (
                        <button
                          type="button"
                          disabled={pendingConnectionIds.has(connection.id)}
                          aria-label={t("panel.actions.connectAria", { name: connection.name })}
                          onClick={() => void connect(connection)}
                        >{pendingConnectionIds.has(connection.id)
                          ? connection.authMode === "oauth" && connection.authorizationStatus !== "authorized" ? t("panel.actions.authorizing") : t("panel.actions.connecting")
                          : t("panel.actions.connect")}</button>
                      )}
                      <button
                        type="button"
                        className="button-secondary"
                        disabled={pendingConnectionIds.has(connection.id) || deleting}
                        aria-label={t("panel.actions.editAria", { name: connection.name })}
                        onClick={(event) => beginEdit(connection, event.currentTarget)}
                      >{t("panel.actions.edit")}</button>
                      <button
                        type="button"
                        className="button-secondary"
                        disabled={pendingConnectionIds.has(connection.id) || exportingConnectionIds.has(connection.id) || deleting}
                        aria-label={t("panel.actions.exportAria", { name: connection.name })}
                        onClick={() => void exportConnection(connection)}
                      >{exportingConnectionIds.has(connection.id) ? t("panel.actions.exporting") : t("panel.actions.export")}</button>
                      <button
                        type="button"
                        className="button-quiet-danger"
                        aria-label={t("panel.actions.deleteAria", { name: connection.name })}
                        onClick={(event) => {
                          dialogTrigger.current = event.currentTarget;
                          setError(null);
                          setPendingDelete(connection.id);
                        }}
                      >{t("panel.actions.delete")}</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}

      {mode !== "servers" && visibleConnections !== null && visibleConnections.length > 0 && (
        <ToolTree
          connections={visibleConnections}
          catalogs={catalogs}
          folders={visibleConnections.length === 1 ? folders[visibleConnections[0]!.id] ?? [] : []}
          refreshingConnectionIds={refreshingConnectionIds}
          onRefresh={(connectionId) => void refresh(connectionId)}
          onSelectTool={(tool) => { noteToolUsed(tool); onSelectTool(tool); }}
          onOpenTool={(tool) => { noteToolUsed(tool); onOpenTool(tool); }}
          onDeleteTool={deleteTool}
          onCreateFolder={(name) => createFolder(visibleConnections[0]!.id, name)}
          onRenameFolder={renameFolder}
          onDeleteFolder={deleteFolder}
          onMoveTool={moveTool}
          onToggleFavorite={toggleFavorite}
          selectedTool={selectedTool}
        />
      )}

      {formMode !== null && (
        <ConnectionFormDialog
          mode={formMode}
          name={name}
          url={url}
          timeoutMs={timeoutMs}
          authMode={authMode}
          bearerToken={bearerToken}
          headers={headers}
          redactSensitiveInfo={redactSensitiveInfo}
          submitting={submitting}
          error={error}
          onNameChange={setName}
          onUrlChange={setUrl}
          onTimeoutChange={setTimeoutMs}
          onAuthModeChange={setAuthMode}
          onBearerTokenChange={setBearerToken}
          onRedactSensitiveInfoChange={setRedactSensitiveInfo}
          onAddHeader={() => setHeaders((current) => [...current, {
            id: nextHeaderId.current++, name: "", value: "",
          }])}
          onHeaderChange={(id, field, value) => setHeaders((current) => current.map((header) =>
            header.id === id ? { ...header, [field]: value } : header))}
          onRemoveHeader={(id) => setHeaders((current) => current.filter((header) => header.id !== id))}
          onSubmit={(event) => void save(event)}
          onClose={() => closeForm()}
        />
      )}

      {pendingDelete !== null && connections !== null && (() => {
        const connection = connections.find(({ id }) => id === pendingDelete);
        return connection === undefined ? null : (
          <DeleteConnectionDialog
            connectionName={connection.name}
            deleting={deleting}
            error={error}
            onConfirm={() => void remove(connection)}
            onClose={() => {
              setPendingDelete(null);
              setError(null);
              queueMicrotask(() => dialogTrigger.current?.focus());
            }}
          />
        );
      })()}
    </section>
  );
}
