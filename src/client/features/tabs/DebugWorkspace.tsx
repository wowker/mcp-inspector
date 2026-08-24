import { useCallback, useEffect, useRef, useState } from "react";
import type { CatalogToolSummary, DebugTabSummary, InspectorApiClient, ToolDetailSummary } from "../../api/api-client.js";
import { ParameterEditor } from "./ParameterEditor.js";
import { TabStrip } from "./TabStrip.js";

export interface ToolOpenIntent { sequence: number; tool: CatalogToolSummary; newTab: boolean }
interface Props {
  api: InspectorApiClient; projectId: string; toolIntent?: ToolOpenIntent | null;
  onExecute?: (tab: DebugTabSummary) => void;
}

type WorkspaceView = "debug" | "definition" | "history";
const PERSIST_DELAY = 300;
interface PendingSave { revision: number; patch: Partial<DebugTabSummary> }
interface BoundToolDetail { tabId: string; connectionId: string; toolName: string; value: ToolDetailSummary }
interface SubtreeDraft { text: string; base: string }

function SchemaPanel({ title, schema }: { title: string; schema: unknown }) {
  const record = typeof schema === "object" && schema !== null && !Array.isArray(schema)
    ? schema as Record<string, unknown> : {};
  const properties = typeof record.properties === "object" && record.properties !== null && !Array.isArray(record.properties)
    ? record.properties as Record<string, unknown> : {};
  return <section><h3>{title}</h3>
    <details open><summary>树形视图</summary>
      <ul className="schema-tree">{Object.entries(properties).map(([name, value]) => {
        const field = typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
        return <li key={name}><strong>{name}</strong> · {Array.isArray(field.type) ? field.type.join(" | ") : String(field.type ?? "复杂结构")}
          {typeof field.description === "string" && <span> — {field.description}</span>}</li>;
      })}</ul>
    </details>
    <details><summary>Raw JSON</summary><pre>{JSON.stringify(schema ?? {}, null, 2)}</pre></details>
  </section>;
}

export function DebugWorkspace(props: Props) {
  return <ProjectWorkspace key={props.projectId} {...props} />;
}

function ProjectWorkspace({ api, projectId, toolIntent = null, onExecute }: Props) {
  const [tabs, setTabs] = useState<DebugTabSummary[] | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [boundDetail, setBoundDetail] = useState<BoundToolDetail | null>(null);
  const [view, setView] = useState<WorkspaceView>("debug");
  const [message, setMessage] = useState<string | null>(null);
  const [subtreeDrafts, setSubtreeDrafts] = useState<Record<string, Record<string, SubtreeDraft>>>({});
  const tabsRef = useRef<DebugTabSummary[]>([]);
  const activeRef = useRef<string | null>(null);
  const pending = useRef(new Map<string, PendingSave>());
  const revisions = useRef(new Map<string, number>());
  const queues = useRef(new Map<string, Promise<void>>());
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const [, renderDirtyState] = useState(0);
  const loadGeneration = useRef(0);
  const handledIntent = useRef(0);
  const intentQueue = useRef<Promise<void>>(Promise.resolve());
  const workspaceGeneration = useRef(0);

  function assign(next: DebugTabSummary[]): void {
    tabsRef.current = next; setTabs(next);
    setSubtreeDrafts((current) => {
      const retained: Record<string, Record<string, SubtreeDraft>> = {};
      for (const [tabId, drafts] of Object.entries(current)) {
        const tab = next.find((item) => item.id === tabId); if (tab === undefined) continue;
        const valid = Object.fromEntries(Object.entries(drafts).filter(([path, draft]) => {
          const key = path.slice(1).replaceAll("~1", "/").replaceAll("~0", "~");
          const canonical = path === "" ? tab.arguments : tab.arguments[key];
          return draft.base === (canonical === undefined ? "" : JSON.stringify(canonical, null, 2));
        }));
        if (Object.keys(valid).length > 0) retained[tabId] = valid;
      }
      return retained;
    });
  }
  function activate(id: string | null): void { activeRef.current = id; setActiveId(id); }

  const flush = useCallback(async (tabId?: string): Promise<boolean> => {
    async function drain(id: string): Promise<boolean> {
      const activeQueue = queues.current.get(id);
      if (activeQueue !== undefined) { try { await activeQueue; } catch { /* retry pending below */ } }
      while (true) {
        const captured = pending.current.get(id); if (captured === undefined) return true;
        if (pending.current.get(id) === captured) pending.current.delete(id);
        renderDirtyState((value) => value + 1);
        const previous = queues.current.get(id);
        const request = (previous?.catch(() => undefined) ?? Promise.resolve()).then(async () => {
          try {
            const saved = await api.updateTab(projectId, id, captured.patch);
            if (!pending.current.has(id)) {
              assign(tabsRef.current.map((tab) => tab.id === id ? saved : tab));
            }
          } catch (error) {
            const newer = pending.current.get(id);
            pending.current.set(id, { revision: Math.max(captured.revision, newer?.revision ?? 0),
              patch: { ...captured.patch, ...(newer?.patch ?? {}) } });
            renderDirtyState((value) => value + 1);
            setMessage(error instanceof Error ? error.message : "保存 Tab 失败");
            throw error;
          }
        });
        queues.current.set(id, request);
        void request.then(() => { if (queues.current.get(id) === request) queues.current.delete(id); },
          () => { if (queues.current.get(id) === request) queues.current.delete(id); });
        try { await request; } catch { return false; }
      }
    }
    const ids = tabId === undefined ? [...new Set([...pending.current.keys(), ...queues.current.keys()])] : [tabId];
    return (await Promise.all(ids.map(drain))).every(Boolean);
  }, [api, projectId]);

  function schedule(tabId: string, patch: Partial<DebugTabSummary>): void {
    const tab = tabsRef.current.find(({ id }) => id === tabId); if (tab === undefined) return;
    const nextTab = { ...tab, ...patch };
    if (patch.arguments !== undefined) setSubtreeDrafts((current) => {
      const next = { ...current }; delete next[tabId]; return next;
    });
    assign(tabsRef.current.map((item) => item.id === tabId ? nextTab : item));
    const revision = (revisions.current.get(tabId) ?? 0) + 1; revisions.current.set(tabId, revision);
    pending.current.set(tabId, { revision, patch: { ...(pending.current.get(tabId)?.patch ?? {}), ...patch } });
    renderDirtyState((value) => value + 1);
    const old = timers.current.get(tabId); if (old !== undefined) clearTimeout(old);
    timers.current.set(tabId, setTimeout(() => void flush(tabId), PERSIST_DELAY));
  }

  useEffect(() => {
    const generation = ++loadGeneration.current; setTabs(null); setMessage(null);
    void api.listTabs(projectId).then((loaded) => {
      if (loadGeneration.current !== generation) return;
      assign(loaded); activate(loaded[0]?.id ?? null);
    }).catch((error: unknown) => { if (loadGeneration.current === generation) setMessage(error instanceof Error ? error.message : "加载 Tabs 失败"); });
    const scope = ++workspaceGeneration.current;
    return () => { loadGeneration.current += 1; if (workspaceGeneration.current === scope) workspaceGeneration.current += 1;
      void flush(); for (const timer of timers.current.values()) clearTimeout(timer); timers.current.clear(); };
  }, [api, flush, projectId]);

  const active = tabs?.find(({ id }) => id === activeId) ?? null;
  useEffect(() => {
    setBoundDetail(null);
    if (active === null) return;
    const generation = ++loadGeneration.current;
    void api.getTool(projectId, active.connectionId, active.toolName).then((value) => {
      if (loadGeneration.current === generation && activeRef.current === active.id) setBoundDetail({
        tabId: active.id, connectionId: active.connectionId, toolName: active.toolName, value,
      });
    }).catch((error: unknown) => { if (loadGeneration.current === generation) { setBoundDetail(null); setMessage(error instanceof Error ? error.message : "加载 Tool 失败"); } });
  }, [active?.connectionId, active?.id, active?.toolName, api, projectId]);

  useEffect(() => {
    if (toolIntent === null || toolIntent.sequence === handledIntent.current || tabs === null || toolIntent.tool.projectId !== projectId) return;
    handledIntent.current = toolIntent.sequence;
    const intent = toolIntent; const scope = workspaceGeneration.current;
    intentQueue.current = intentQueue.current.catch(() => undefined).then(async () => {
      if (workspaceGeneration.current !== scope || !(await flush()) || workspaceGeneration.current !== scope) return;
      if (handledIntent.current > intent.sequence) return;
      const current = tabsRef.current.find(({ id }) => id === activeRef.current);
      const opened = intent.newTab || current === undefined || current.pinned
        ? await api.openTab(projectId, intent.tool.connectionId, intent.tool.name)
        : await api.replaceTabTool(projectId, current.id, intent.tool.connectionId, intent.tool.name);
      if (workspaceGeneration.current !== scope) return;
      const next = current !== undefined && !intent.newTab && !current.pinned
        ? tabsRef.current.map((item) => item.id === current.id ? opened : item)
        : [...tabsRef.current, opened];
      setSubtreeDrafts((drafts) => { const updated = { ...drafts }; if (current !== undefined) delete updated[current.id]; return updated; });
      assign(next.sort((left, right) => left.position - right.position)); activate(opened.id); setView("debug");
    }).catch((error: unknown) => { if (workspaceGeneration.current === scope) setMessage(error instanceof Error ? error.message : "无法打开 Tool Tab"); });
  }, [api, flush, projectId, tabs, toolIntent]);

  async function select(id: string): Promise<void> { if (!(await flush(activeRef.current ?? undefined))) return; activate(id); setView("debug"); }
  function actionError(error: unknown): void { setMessage(error instanceof Error ? error.message : "Tab 操作失败"); }
  async function close(id: string): Promise<void> {
    try {
      if (tabsRef.current.find((tab) => tab.id === id)?.pinned === true) return;
      if (!(await flush(id))) return; await api.closeTab(projectId, id); const previous = tabsRef.current; const closedIndex = previous.findIndex((tab) => tab.id === id);
      const next = previous.filter((tab) => tab.id !== id); assign(next);
      if (activeRef.current === id) activate(next[Math.max(0, closedIndex - 1)]?.id ?? null);
    } catch (error) { actionError(error); }
  }
  async function duplicate(id: string): Promise<void> { try {
    if (!(await flush(id))) return; const copy = await api.duplicateTab(projectId, id); assign([...tabsRef.current, copy]); activate(copy.id);
  } catch (error) { actionError(error); } }
  async function bulk(id: string, side: "others" | "right"): Promise<void> {
    try {
      if (!(await flush())) return; const next = side === "others" ? await api.closeOtherTabs(projectId, id) : await api.closeTabsRight(projectId, id);
      assign(next); if (!next.some((tab) => tab.id === activeRef.current)) activate(next.find((tab) => tab.id === id)?.id ?? next[0]?.id ?? null);
    } catch (error) { actionError(error); }
  }
  async function move(id: string, offset: -1 | 1): Promise<void> {
    try {
      if (!(await flush())) return; const ordered = [...tabsRef.current]; const index = ordered.findIndex((tab) => tab.id === id);
      const target = index + offset; if (index < 0 || target < 0 || target >= ordered.length) return;
      [ordered[index], ordered[target]] = [ordered[target], ordered[index]];
      assign(await api.reorderTabs(projectId, ordered.map((tab) => tab.id)));
    } catch (error) { actionError(error); }
  }
  async function execute(): Promise<void> {
    if (active === null || !(await flush(active.id))) return;
    const latest = tabsRef.current.find(({ id }) => id === active.id); if (latest !== undefined) onExecute?.(latest);
  }

  const detail = active !== null && boundDetail?.tabId === active.id && boundDetail.connectionId === active.connectionId &&
    boundDetail.toolName === active.toolName ? boundDetail.value : null;

  if (tabs === null) return <p role="status">正在恢复调试 Tabs…</p>;
  return <section className="debug-workspace" aria-label="Tool 调试工作台">
    {message !== null && <p role="alert">{message}</p>}
    <TabStrip tabs={tabs} activeId={activeId} dirtyIds={new Set([...pending.current.keys(), ...queues.current.keys()])} onSelect={(id) => void select(id)} onClose={(id) => void close(id)}
      onDuplicate={(id) => void duplicate(id)} onPin={(id, pinned) => schedule(id, { pinned })}
      onMove={(id, offset) => void move(id, offset)}
      onCloseOthers={(id) => void bulk(id, "others")} onCloseRight={(id) => void bulk(id, "right")} />
    {active === null ? <div className="workspace-empty"><h2>选择一个 Tool 开始调试</h2><p>单击复用当前未固定 Tab，双击打开新 Tab。</p></div> : <div id={`tabpanel-${active.id}`} role="tabpanel" aria-labelledby={`tab-${active.id}`}>
      <nav className="workspace-nav" aria-label="当前 Tab 视图">
        {(["debug", "definition", "history"] as const).map((item) => <button type="button" key={item}
          aria-current={view === item ? "page" : undefined} onClick={() => setView(item)}>
          {item === "debug" ? "调试" : item === "definition" ? "Tool 定义" : "当前 Tab 历史"}</button>)}
      </nav>
      {view === "debug" && detail === null && <p role="status">正在加载 Tool 定义…</p>}
      {view === "debug" && detail !== null && <div className="request-result-split" style={{ gridTemplateRows: `${active.viewState.splitRatio * 100}% 8px 1fr` }}>
        <div className="request-pane" ref={(node) => { if (node !== null && node.scrollTop !== active.viewState.editorScrollTop) node.scrollTop = active.viewState.editorScrollTop; }}
          onScroll={(event) => schedule(active.id, { viewState: { ...active.viewState, editorScrollTop: event.currentTarget.scrollTop } })}>
          <ParameterEditor tab={active} schema={detail.tool.currentSnapshot.definition.inputSchema}
            subtreeDrafts={subtreeDrafts[active.id]}
            onSubtreeDraftChange={(path, text, base) => setSubtreeDrafts((current) => ({ ...current,
              [active.id]: { ...(current[active.id] ?? {}), [path]: { text, base } } }))}
            onChange={(patch) => schedule(active.id, patch)} onExecute={() => void execute()} />
        </div>
        <label className="split-control">请求区高度
          <input aria-label="请求区高度" type="range" min="20" max="80" value={active.viewState.splitRatio * 100}
            onChange={(event) => schedule(active.id, { viewState: { ...active.viewState, splitRatio: Number(event.target.value) / 100 } })} />
        </label>
        <div className="result-placeholder" ref={(node) => { if (node !== null && node.scrollTop !== active.viewState.resultScrollTop) node.scrollTop = active.viewState.resultScrollTop; }}
          onScroll={(event) => schedule(active.id, { viewState: { ...active.viewState, resultScrollTop: event.currentTarget.scrollTop } })}>
          <h3>调用结果</h3><p>执行与结果将在下一阶段接入。</p></div>
      </div>}
      {view === "definition" && detail !== null && <article className="tool-definition">
        <h2>{detail.tool.name}</h2><p>{detail.tool.currentSnapshot.definition.description ?? "暂无描述"}</p>
        <dl><div><dt>Schema 哈希</dt><dd>{detail.tool.currentSnapshot.contentHash}</dd></div>
          <div><dt>快照时间</dt><dd>{detail.tool.currentSnapshot.createdAt}</dd></div></dl>
        <h3>Annotations</h3><pre>{JSON.stringify(detail.tool.currentSnapshot.definition.annotations ?? {}, null, 2)}</pre>
        <SchemaPanel title="Input Schema" schema={detail.tool.currentSnapshot.definition.inputSchema} />
        <SchemaPanel title="Output Schema" schema={detail.tool.currentSnapshot.definition.outputSchema ?? {}} />
        <button type="button" onClick={() => void navigator.clipboard?.writeText(JSON.stringify(detail.tool.currentSnapshot.definition, null, 2))}>复制原始 Tool 定义</button>
        <h3>历史快照</h3><ul>{detail.snapshots.map((snapshot) => <li key={snapshot.id}>{snapshot.createdAt} · {snapshot.contentHash}</li>)}</ul>
      </article>}
      {view === "history" && <div className="history-placeholder"><h2>当前 Tab 历史</h2><p>运行历史将在下一阶段接入。</p></div>}
    </div>}
    <span className="sr-only" role="status" aria-live="polite">{queues.current.size > 0 ? "正在保存 Tab" : pending.current.size > 0 ? "Tab 有待保存更改" : "Tab 已保存"}</span>
  </section>;
}
