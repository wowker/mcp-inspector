import { useEffect, useRef, useState, type FormEvent } from "react";
import type {
  CatalogToolSummary,
  ConnectionSummary,
  InspectorApiClient,
} from "../../api/api-client.js";
import { ToolTree } from "../tools/ToolTree.js";

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
      if (mounted.current) setError(errorMessage(cause));
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

  async function create(event: FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const created = await api.createConnection(projectId, {
        name: name.trim(),
        url: url.trim(),
        transport: "streamable-http",
        authMode: "none",
        timeoutMs: Number(timeoutMs),
      });
      if (!mounted.current) return;
      setConnections((current) => [
        ...(current ?? []).filter(({ id }) => id !== created.id),
        created,
      ]);
      setName("");
      setUrl("");
      setTimeoutMs("10000");
    } catch (cause) {
      if (mounted.current) setError(errorMessage(cause));
    } finally {
      if (mounted.current) setSubmitting(false);
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
      setPendingDelete(null);
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
        </div>
        <p>保存配置不会连接 MCP Server。</p>
      </div>

      {error !== null && (
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
      ) : connections !== null && connections.length === 0 ? (
        <p className="connection-empty">还没有连接配置。</p>
      ) : (
        <ul className="connection-list" aria-label="连接配置列表">
          {connections?.map((connection) => (
            <li key={connection.id}>
              <div className="connection-list__details">
                <strong>{connection.name}</strong>
                <span className="connection-url">{connection.url}</span>
                <span className="connection-status">
                  {connection.status}（{connectionStatusLabels[connection.status]}）
                </span>
              </div>
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
              {pendingDelete === connection.id ? (
                <div className="connection-delete-confirmation" role="group" aria-label={`确认删除 ${connection.name}`}>
                  <span>确认删除 {connection.name}？</span>
                  <button
                    type="button"
                    className="button-danger"
                    disabled={deleting}
                    aria-label={`确认删除 ${connection.name}`}
                    onClick={() => void remove(connection)}
                  >
                    {deleting ? "正在删除…" : "确认删除"}
                  </button>
                  <button type="button" className="button-secondary" onClick={() => setPendingDelete(null)}>
                    取消
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  className="button-secondary"
                  aria-label={`删除 ${connection.name}`}
                  onClick={() => setPendingDelete(connection.id)}
                >
                  删除
                </button>
              )}
              </div>
            </li>
          ))}
        </ul>
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

      <form className="connection-create-form" onSubmit={(event) => void create(event)}>
        <h3>新建连接配置</h3>
        <div className="connection-fields">
          <label>
            <span>连接名称</span>
            <input value={name} onChange={(event) => setName(event.target.value)} maxLength={120} required />
          </label>
          <label>
            <span>MCP URL</span>
            <input value={url} onChange={(event) => setUrl(event.target.value)} type="url" placeholder="https://example.com/mcp" required />
          </label>
          <label>
            <span>请求超时（毫秒）</span>
            <input
              value={timeoutMs}
              onChange={(event) => setTimeoutMs(event.target.value)}
              type="number"
              min={100}
              max={600000}
              step={1}
              required
            />
          </label>
        </div>
        <dl className="connection-fixed-options">
          <div><dt>传输方式</dt><dd>Streamable HTTP</dd></div>
          <div><dt>认证方式</dt><dd>无认证</dd></div>
        </dl>
        <button type="submit" disabled={submitting || connections === null}>
          {submitting ? "正在保存…" : "保存配置"}
        </button>
      </form>
    </section>
  );
}
