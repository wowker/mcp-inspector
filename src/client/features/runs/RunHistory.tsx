import { useEffect, useRef, useState } from "react";
import type { InspectorApiClient, RunSummary } from "../../api/api-client.js";

interface Props { api: InspectorApiClient; projectId: string; tabId?: string; onOpen: (run: RunSummary) => void }
const statusLabel: Record<string, string> = { queued: "排队中", connecting: "连接中", authorizing: "授权中", running: "运行中",
  succeeded: "成功", failed: "失败", cancelled: "已取消", interrupted: "已中断" };

export function RunHistory({ api, projectId, tabId, onOpen }: Props) {
  const [runs, setRuns] = useState<RunSummary[]>([]); const [cursor, setCursor] = useState<string | null | undefined>(undefined);
  const [loading, setLoading] = useState(true); const [error, setError] = useState<string | null>(null); const generation = useRef(0);
  useEffect(() => {
    const current = ++generation.current; setRuns([]); setCursor(undefined); setLoading(true); setError(null);
    void api.listRuns(projectId, undefined, tabId).then((page) => { if (generation.current !== current) return;
      setRuns(page.runs); setCursor(page.nextCursor); setLoading(false);
    }).catch((cause: unknown) => { if (generation.current === current) { setError(cause instanceof Error ? cause.message : "加载运行历史失败"); setLoading(false); } });
    return () => { generation.current += 1; };
  }, [api, projectId, tabId]);
  async function more(): Promise<void> {
    if (cursor === null || cursor === undefined || loading) return; const current = generation.current; const requested = cursor; setLoading(true);
    try { const page = await api.listRuns(projectId, requested, tabId); if (generation.current !== current) return;
      setRuns((items) => [...items, ...page.runs.filter((candidate) => !items.some(({ id }) => id === candidate.id))]); setCursor(page.nextCursor);
    } catch (cause) { if (generation.current === current) setError(cause instanceof Error ? cause.message : "加载运行历史失败"); }
    finally { if (generation.current === current) setLoading(false); }
  }
  const visible = runs;
  return <section className="run-history" aria-label={tabId === undefined ? "项目运行历史" : "当前 Tab 历史"}>
    <h2>{tabId === undefined ? "运行历史" : "当前 Tab 历史"}</h2>{error !== null && <p role="alert">{error}</p>}
    {visible.length === 0 && !loading && <p>暂无运行记录</p>}
    <ol>{visible.map((run) => <li key={run.id}><button type="button" className="history-run" aria-label={`打开运行 ${run.id}`} onClick={() => onOpen(run)}>
      <span>{run.id}</span><strong>{run.toolName}</strong><span className={`status-chip status-chip--${run.status}`}>{statusLabel[run.status] ?? run.status}</span>
      <time>{run.createdAt}</time><span>{run.durationMs === null ? "未记录" : `${run.durationMs} ms`}</span></button></li>)}</ol>
    {loading && <p role="status">正在加载运行历史…</p>}
    {cursor !== null && cursor !== undefined && <button type="button" disabled={loading} onClick={() => void more()}>加载更多</button>}
  </section>;
}
