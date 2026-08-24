import { useEffect, useRef, useState, type FormEvent } from "react";
import type {
  CatalogToolSummary,
  ConnectionSummary,
  InspectorApiClient,
} from "../../api/api-client.js";
import { ToolTree } from "../tools/ToolTree.js";
import { ConnectionFormDialog, DeleteConnectionDialog } from "./ConnectionDialogs.js";

interface ConnectionPanelProps {
  api: InspectorApiClient;
  projectId: string;
  onSelectTool?: (tool: CatalogToolSummary) => void;
  onOpenTool?: (tool: CatalogToolSummary) => void;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "无法管理连接配置";
}

const connectionStatusLabels: Record<ConnectionSummary["status"], string> = {
  disconnected: "未连接",
  connecting: "连接中",
  connected: "已连接",
  failed: "失败",
};

export function ConnectionPanel(props: ConnectionPanelProps) {
  return <ProjectScopedConnectionPanel key={props.projectId} {...props} />;
}

function ProjectScopedConnectionPanel({
  api, projectId, onSelectTool = () => undefined, onOpenTool = () => undefined,
}: ConnectionPanelProps) {
  const mounted = useRef(false);
  const submitLock = useRef(false);
  const dialogTrigger = useRef<HTMLButtonElement | null>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  const catalogGenerations = useRef(new Map<string, number>());
  const [connections, setConnections] = useState<ConnectionSummary[] | null>(null);
  const [catalogs, setCatalogs] = useState<Record<string, CatalogToolSummary[]>>({});
  const [catalogErrors, setCatalogErrors] = useState<Record<string, string>>({});
  const [readyConnectionIds, setReadyConnectionIds] = useState<ReadonlySet<string>>(new Set());
  const [refreshingConnectionIds, setRefreshingConnectionIds] = useState<ReadonlySet<string>>(new Set());
  const [pendingConnectionIds, setPendingConnectionIds] = useState<ReadonlySet<string>>(new Set());
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [timeoutMs, setTimeoutMs] = useState("10000");
  const [authMode, setAuthMode] = useState<"none" | "oauth">("none");
  const [formMode, setFormMode] = useState<"create" | "edit" | null>(null);
  const [editingConnectionId, setEditingConnectionId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    setConnections(null);
    setCatalogs({});
    setCatalogErrors({});
    setReadyConnectionIds(new Set());
    setRefreshingConnectionIds(new Set());
    setPendingConnectionIds(new Set());
    catalogGenerations.current.clear();
    setError(null);
    void api.listConnections(projectId)
      .then((items) => {
        if (!active) return;
        setConnections(items);
        for (const connection of items) {
          const generation = 1;
          catalogGenerations.current.set(connection.id, generation);
          void api.listTools(projectId, connection.id)
            .then((tools) => {
              if (active && catalogGenerations.current.get(connection.id) === generation) {
                setCatalogs((current) => ({ ...current, [connection.id]: tools }));
              }
            })
            .catch((cause: unknown) => {
              if (active && catalogGenerations.current.get(connection.id) === generation) {
                setCatalogErrors((current) => ({ ...current, [connection.id]: errorMessage(cause) }));
              }
            });
        }
      })
      .catch((cause: unknown) => {
        if (active) setError(errorMessage(cause));
      });
    return () => {
      active = false;
    };
  }, [api, projectId, loadAttempt]);

  function setPending(connectionId: string, pending: boolean): void {
    setPendingConnectionIds((current) => {
      const next = new Set(current);
      if (pending) next.add(connectionId); else next.delete(connectionId);
      return next;
    });
  }

  function invalidateConnection(connectionId: string): number {
    const generation = (catalogGenerations.current.get(connectionId) ?? 0) + 1;
    catalogGenerations.current.set(connectionId, generation);
    setRefreshingConnectionIds((current) => {
      const next = new Set(current); next.delete(connectionId); return next;
    });
    setReadyConnectionIds((current) => {
      const next = new Set(current); next.delete(connectionId); return next;
    });
    setCatalogErrors((current) => {
      const next = { ...current }; delete next[connectionId]; return next;
    });
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
    setFormMode("edit");
  }

  async function refresh(connectionId: string): Promise<void> {
    const generation = (catalogGenerations.current.get(connectionId) ?? 0) + 1;
    catalogGenerations.current.set(connectionId, generation);
    setRefreshingConnectionIds((current) => new Set(current).add(connectionId));
    setCatalogErrors((current) => {
      const next = { ...current }; delete next[connectionId]; return next;
    });
    try {
      const tools = await api.refreshTools(projectId, connectionId);
      if (!mounted.current || catalogGenerations.current.get(connectionId) !== generation) return;
      setCatalogs((current) => ({ ...current, [connectionId]: tools }));
      setReadyConnectionIds((current) => new Set(current).add(connectionId));
    } catch (cause) {
      if (!mounted.current || catalogGenerations.current.get(connectionId) !== generation) return;
      setReadyConnectionIds((current) => {
        const next = new Set(current); next.delete(connectionId); return next;
      });
      setCatalogErrors((current) => ({ ...current, [connectionId]: errorMessage(cause) }));
    } finally {
      if (mounted.current && catalogGenerations.current.get(connectionId) === generation) {
        setRefreshingConnectionIds((current) => {
          const next = new Set(current); next.delete(connectionId); return next;
        });
      }
    }
  }

  async function connect(connection: ConnectionSummary): Promise<void> {
    setError(null);
    const generation = invalidateConnection(connection.id);
    setPending(connection.id, true);
    try {
      const connected = await api.connectConnection(projectId, connection.id);
      if (!mounted.current || catalogGenerations.current.get(connection.id) !== generation) return;
      updateConnection(connected);
      await refresh(connection.id);
    } catch (cause) {
      if (mounted.current && catalogGenerations.current.get(connection.id) === generation) {
        const message = errorMessage(cause);
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
      setReadyConnectionIds((current) => {
        const next = new Set(current); next.delete(connection.id); return next;
      });
    } catch (cause) {
      if (mounted.current) setError(errorMessage(cause));
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
      if (editingId === null) {
        const created = await api.createConnection(projectId, {
          name: name.trim(),
          url: url.trim(),
          transport: "streamable-http",
          authMode,
          timeoutMs: Number(timeoutMs),
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
          timeoutMs: Number(timeoutMs),
        });
        if (!mounted.current || catalogGenerations.current.get(editingId) !== generation) return;
        updateConnection(updated);
        closeForm();
      }
    } catch (cause) {
      if (mounted.current) setError(errorMessage(cause));
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
      setCatalogs((current) => {
        const next = { ...current }; delete next[connection.id]; return next;
      });
      catalogGenerations.current.delete(connection.id);
      if (editingConnectionId === connection.id) closeForm(false);
      setPendingDelete(null);
      queueMicrotask(() => addButton.current?.focus());
    } catch (cause) {
      if (mounted.current) setError(errorMessage(cause));
    } finally {
      if (mounted.current) setDeleting(false);
    }
  }

  return (
    <section className="connection-panel" aria-labelledby="connection-panel-title">
      <div className="connection-panel__heading">
        <div>
          <p className="eyebrow">本地配置</p>
          <h2 id="connection-panel-title">连接管理</h2>
          <p>集中管理 MCP Server，保存配置后再手动连接。</p>
        </div>
        <button
          ref={addButton}
          type="button"
          className="connection-add-button"
          disabled={connections === null}
          onClick={(event) => beginCreate(event.currentTarget)}
        ><span aria-hidden="true">＋</span> 添加连接</button>
      </div>

      {error !== null && formMode === null && pendingDelete === null && (
        <div className="connection-load-error">
          <p role="alert" className="connection-error">{error}</p>
          {connections === null && (
            <button
              type="button"
              className="button-secondary"
              aria-label="重试加载连接配置"
              onClick={() => setLoadAttempt((attempt) => attempt + 1)}
            >
              重试
            </button>
          )}
        </div>
      )}

      {connections === null && error === null ? (
        <p role="status" className="connection-loading">正在加载连接配置…</p>
      ) : (
        <div className="connection-table-wrap">
          <table className="connection-table" aria-label="连接列表">
            <thead>
              <tr>
                <th scope="col">连接名称</th>
                <th scope="col">MCP URL</th>
                <th scope="col">状态</th>
                <th scope="col" aria-label="请求超时">超时</th>
                <th scope="col" className="connection-table__actions-heading">操作</th>
              </tr>
            </thead>
            <tbody>
              {connections?.length === 0 && (
                <tr>
                  <td colSpan={5} className="connection-empty">
                    <span>还没有连接配置。</span>
                    <small>点击“添加连接”开始。</small>
                  </td>
                </tr>
              )}
              {connections?.map((connection) => (
                <tr key={connection.id}>
                  <td data-label="连接名称">
                    <strong>{connection.name}</strong>
                    <span className="connection-meta">
                      <span>Streamable HTTP</span><span aria-hidden="true"> · </span><span>{connection.authMode === "oauth" ? "OAuth" : "无认证"}</span>
                    </span>
                  </td>
                  <td data-label="MCP URL"><span className="connection-url" title={connection.url}>{connection.url}</span></td>
                  <td data-label="状态">
                    <span className={`connection-status connection-status--${connection.status}`}>
                      {connectionStatusLabels[connection.status]}
                    </span>
                    {connection.lastError !== null && (
                      <span className="connection-last-error">{connection.lastError.message}</span>
                    )}
                  </td>
                  <td data-label="请求超时"><span className="connection-timeout">{connection.timeoutMs.toLocaleString()} ms</span></td>
                  <td data-label="操作">
                    <div className="connection-actions">
                      {connection.status === "connected" ? (
                        <button
                          type="button"
                          className="button-secondary"
                          disabled={pendingConnectionIds.has(connection.id)}
                          aria-label={`断开 ${connection.name}`}
                          onClick={() => void disconnect(connection)}
                        >断开</button>
                      ) : (
                        <button
                          type="button"
                          disabled={pendingConnectionIds.has(connection.id)}
                          aria-label={`连接 ${connection.name}`}
                          onClick={() => void connect(connection)}
                        >{pendingConnectionIds.has(connection.id) ? "连接中…" : "连接"}</button>
                      )}
                      <button
                        type="button"
                        className="button-secondary"
                        disabled={pendingConnectionIds.has(connection.id) || deleting}
                        aria-label={`编辑 ${connection.name}`}
                        onClick={(event) => beginEdit(connection, event.currentTarget)}
                      >编辑</button>
                      <button
                        type="button"
                        className="button-quiet-danger"
                        aria-label={`删除 ${connection.name}`}
                        onClick={(event) => {
                          dialogTrigger.current = event.currentTarget;
                          setError(null);
                          setPendingDelete(connection.id);
                        }}
                      >删除</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {connections !== null && connections.length > 0 && (
        <ToolTree
          connections={connections}
          catalogs={catalogs}
          errors={catalogErrors}
          refreshingConnectionIds={refreshingConnectionIds}
          readyConnectionIds={readyConnectionIds}
          onRefresh={(connectionId) => void refresh(connectionId)}
          onSelectTool={onSelectTool}
          onOpenTool={onOpenTool}
        />
      )}

      {formMode !== null && (
        <ConnectionFormDialog
          mode={formMode}
          name={name}
          url={url}
          timeoutMs={timeoutMs}
          authMode={authMode}
          submitting={submitting}
          error={error}
          onNameChange={setName}
          onUrlChange={setUrl}
          onTimeoutChange={setTimeoutMs}
          onAuthModeChange={setAuthMode}
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
