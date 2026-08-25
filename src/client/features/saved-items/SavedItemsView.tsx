import { useEffect, useId, useRef, useState } from "react";
import { Copy, FileArrowDown, Trash } from "@phosphor-icons/react";
import type { InspectorApiClient, SavedItemDetail, SavedItemKind, SavedItemSummary } from "../../api/api-client.js";
import { JsonViewer } from "../runs/JsonViewer.js";

function date(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

export function SavedItemsView({ api, projectId, connectionId, toolName, refreshKey = 0, onLoadRequest }: {
  api: InspectorApiClient; projectId: string; connectionId: string; toolName: string; refreshKey?: number;
  onLoadRequest: (argumentsValue: Record<string, unknown>) => void;
}) {
  const tabsId = useId();
  const [items, setItems] = useState<SavedItemSummary[] | null>(null); const [kind, setKind] = useState<SavedItemKind>("request");
  const [nextCursor, setNextCursor] = useState<string | null>(null); const [loadingMore, setLoadingMore] = useState(false);
  const [selected, setSelected] = useState<SavedItemDetail | null>(null); const [loadingId, setLoadingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null); const [confirmId, setConfirmId] = useState<string | null>(null);
  const scope = useRef(0); const detailRequest = useRef(0);
  useEffect(() => {
    const current = ++scope.current; detailRequest.current += 1; setItems(null); setSelected(null); setNextCursor(null); setError(null);
    void api.listSavedItems(projectId, connectionId, toolName).then((value) => { if (scope.current === current) { setItems(value.items); setNextCursor(value.nextCursor); } })
      .catch((reason: unknown) => { if (scope.current === current) setError(reason instanceof Error ? reason.message : "加载已保存项目失败"); });
    return () => { if (scope.current === current) scope.current += 1; };
  }, [api, connectionId, projectId, refreshKey, toolName]);
  const visible = items?.filter((item) => item.kind === kind) ?? [];
  async function open(item: SavedItemSummary): Promise<void> {
    const current = scope.current; const request = ++detailRequest.current; setLoadingId(item.id); setError(null);
    try { const value = await api.getSavedItem(projectId, connectionId, toolName, item.id);
      if (scope.current === current && detailRequest.current === request) setSelected(value); }
    catch (reason) { if (scope.current === current && detailRequest.current === request) setError(reason instanceof Error ? reason.message : "加载保存内容失败"); }
    finally { if (scope.current === current && detailRequest.current === request) setLoadingId(null); }
  }
  async function more(): Promise<void> {
    if (nextCursor === null || loadingMore) return; const current = scope.current; setLoadingMore(true);
    try { const page = await api.listSavedItems(projectId, connectionId, toolName, nextCursor);
      if (scope.current === current) { setItems((value) => [...(value ?? []), ...page.items]); setNextCursor(page.nextCursor); }
    } catch (reason) { if (scope.current === current) setError(reason instanceof Error ? reason.message : "加载更多失败"); }
    finally { if (scope.current === current) setLoadingMore(false); }
  }
  async function remove(item: SavedItemSummary): Promise<void> {
    const current = scope.current;
    try { await api.deleteSavedItem(projectId, connectionId, toolName, item.id);
      if (scope.current === current) { setItems((value) => value?.filter(({ id }) => id !== item.id) ?? null);
        if (selected?.id === item.id) setSelected(null); setConfirmId(null); }
    } catch (reason) { if (scope.current === current) setError(reason instanceof Error ? reason.message : "删除失败"); }
  }
  async function copy(value: unknown): Promise<void> {
    try { await navigator.clipboard.writeText(JSON.stringify(value, null, 2)); }
    catch { setError("复制失败，请手动选择内容"); }
  }
  return <section className="saved-items-view" aria-label={`${toolName} 已保存的请求与响应`}>
    <header className="saved-items-header"><div><h2>已保存</h2><p>当前 Tool 的请求样例与响应基线。</p></div>
      <div role="tablist" aria-label="保存内容类型" onKeyDown={(event) => {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        event.preventDefault(); const next = kind === "request" ? "response" : "request"; detailRequest.current += 1;
        setKind(next); setSelected(null); setLoadingId(null); setConfirmId(null);
        document.getElementById(`${tabsId}-${next}`)?.focus();
      }}>
        {(["request", "response"] as const).map((value) => <button key={value} id={`${tabsId}-${value}`}
          aria-controls={`${tabsId}-panel`} type="button" role="tab" tabIndex={kind === value ? 0 : -1} aria-selected={kind === value}
          onClick={() => { detailRequest.current += 1; setKind(value); setSelected(null); setLoadingId(null); setConfirmId(null); }}>{value === "request" ? "请求" : "响应"} {items?.filter((item) => item.kind === value).length ?? 0}</button>)}
      </div></header>
    {error !== null && <p role="alert" className="saved-items-error">{error}</p>}
    {items === null && error === null ? <p role="status" className="saved-items-status">正在加载已保存内容…</p>
      : <div id={`${tabsId}-panel`} role="tabpanel" aria-labelledby={`${tabsId}-${kind}`} className="saved-items-layout"><div className="saved-items-list" aria-label={kind === "request" ? "保存的请求" : "保存的响应"}>
        {visible.length === 0 ? <div className="saved-items-empty"><strong>还没有保存的{kind === "request" ? "请求" : "响应"}</strong><p>回到调试视图，从参数区或结果区保存。</p></div>
          : visible.map((item) => <div className={`saved-item-row${selected?.id === item.id ? " is-selected" : ""}`} key={item.id}>
            <button type="button" className="saved-item-main" onClick={() => void open(item)} aria-label={`${item.name}，${item.description || "无描述"}`}>
              <span><strong>{item.name}</strong><small>{item.description || "无描述"}</small></span><time>{date(item.createdAt)}</time>
            </button><div className="saved-item-actions">{confirmId === item.id ? <><button type="button" className="button-danger" onClick={() => void remove(item)} aria-label={`确认删除 ${item.name}`}>确认删除</button>
              <button type="button" className="button-secondary" onClick={() => setConfirmId(null)}>取消</button></>
              : <button type="button" className="icon-button" aria-label={`删除 ${item.name}`} onClick={() => setConfirmId(item.id)}><Trash size={15} /></button>}</div>
          </div>)}{nextCursor !== null && <button type="button" className="saved-items-more" disabled={loadingMore} onClick={() => void more()}>{loadingMore ? "加载中…" : "加载更多"}</button>}</div>
        <section className="saved-item-detail" aria-live="polite">
          {loadingId !== null ? <p role="status">正在读取保存内容…</p> : selected === null ? <div className="saved-items-empty"><strong>选择一项查看内容</strong><p>完整 JSON 按需读取，不影响列表性能。</p></div>
            : <><header><div><span>{selected.kind === "request" ? "请求" : "响应"}</span><h3>{selected.name}</h3><p>{selected.description || "无描述"}</p></div>
              <div>{selected.kind === "request" && <button type="button" onClick={() => onLoadRequest(selected.payload as Record<string, unknown>)}><FileArrowDown size={16} />加载到当前 Tab</button>}
                <button type="button" className="button-secondary" onClick={() => void copy(selected.payload)}><Copy size={16} />复制 JSON</button></div></header>
              <JsonViewer value={selected.payload} label={`保存的${selected.kind === "request" ? "请求" : "响应"} JSON`} /></>}
        </section></div>}
  </section>;
}
