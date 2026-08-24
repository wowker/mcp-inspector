import { useEffect, useRef, useState, type FormEvent } from "react";
import type {
  ConnectionSummary,
  InspectorApiClient,
} from "../../api/api-client.js";

interface ConnectionPanelProps {
  api: InspectorApiClient;
  projectId: string;
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

export function ConnectionPanel({ api, projectId }: ConnectionPanelProps) {
  return <ProjectScopedConnectionPanel key={projectId} api={api} projectId={projectId} />;
}

function ProjectScopedConnectionPanel({ api, projectId }: ConnectionPanelProps) {
  const mounted = useRef(false);
  const [connections, setConnections] = useState<ConnectionSummary[] | null>(null);
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
    setError(null);
    void api.listConnections(projectId)
      .then((items) => {
        if (active) setConnections(items);
      })
      .catch((cause: unknown) => {
        if (active) setError(errorMessage(cause));
      });
    return () => {
      active = false;
    };
  }, [api, projectId, loadAttempt]);

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
    setDeleting(true);
    try {
      await api.deleteConnection(projectId, connection.id);
      if (!mounted.current) return;
      setConnections((current) => current?.filter(({ id }) => id !== connection.id) ?? []);
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
            </li>
          ))}
        </ul>
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
