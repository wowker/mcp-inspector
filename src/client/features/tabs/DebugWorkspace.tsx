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
  const [detail, setDetail] = useState<ToolDetailSummary | null>(null);
  const [view, setView] = useState<WorkspaceView>("debug");
  const [message, setMessage] = useState<string | null>(null);
  const tabsRef = useRef<DebugTabSummary[]>([]);
  const activeRef = useRef<string | null>(null);
  const pending = useRef(new Map<string, Partial<DebugTabSummary>>());
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const loadGeneration = useRef(0);
  const handledIntent = useRef(0);

  function assign(next: DebugTabSummary[]): void { tabsRef.current = next; setTabs(next); }
  function activate(id: string | null): void { activeRef.current = id; setActiveId(id); }

  const flush = useCallback(async (tabId?: string): Promise<void> => {
    const ids = tabId === undefined ? [...pending.current.keys()] : [tabId];
    for (const id of ids) {
      const patch = pending.current.get(id); if (patch === undefined) continue;
      pending.current.delete(id); const timer = timers.current.get(id); if (timer !== undefined) clearTimeout(timer);
      timers.current.delete(id);
      try {
        const saved = await api.updateTab(projectId, id, patch);
        if (pending.current.has(id)) continue;
        assign(tabsRef.current.map((tab) => tab.id === id ? saved : tab));
      } catch (error) { setMessage(error instanceof Error ? error.message : "保存 Tab 失败"); }
    }
  }, [api, projectId]);

  function schedule(tabId: string, patch: Partial<DebugTabSummary>): void {
    const tab = tabsRef.current.find(({ id }) => id === tabId); if (tab === undefined) return;
    const nextTab = { ...tab, ...patch };
    assign(tabsRef.current.map((item) => item.id === tabId ? nextTab : item));
    pending.current.set(tabId, { ...pending.current.get(tabId), ...patch });
    const old = timers.current.get(tabId); if (old !== undefined) clearTimeout(old);
    timers.current.set(tabId, setTimeout(() => void flush(tabId), PERSIST_DELAY));
  }

  useEffect(() => {
    const generation = ++loadGeneration.current; setTabs(null); setMessage(null);
    void api.listTabs(projectId).then((loaded) => {
      if (loadGeneration.current !== generation) return;
      assign(loaded); activate(loaded[0]?.id ?? null);
    }).catch((error: unknown) => { if (loadGeneration.current === generation) setMessage(error instanceof Error ? error.message : "加载 Tabs 失败"); });
    return () => { loadGeneration.current += 1; void flush(); for (const timer of timers.current.values()) clearTimeout(timer); timers.current.clear(); };
  }, [api, flush, projectId]);

  const active = tabs?.find(({ id }) => id === activeId) ?? null;
  useEffect(() => {
    if (active === null) { setDetail(null); return; }
    const generation = ++loadGeneration.current;
    void api.getTool(projectId, active.connectionId, active.toolName).then((value) => {
      if (loadGeneration.current === generation && activeRef.current === active.id) setDetail(value);
    }).catch((error: unknown) => { if (loadGeneration.current === generation) setMessage(error instanceof Error ? error.message : "加载 Tool 失败"); });
  }, [active?.connectionId, active?.id, active?.toolName, api, projectId]);

  useEffect(() => {
    if (toolIntent === null || toolIntent.sequence === handledIntent.current || tabs === null || toolIntent.tool.projectId !== projectId) return;
    handledIntent.current = toolIntent.sequence;
    void (async () => {
      await flush(); const current = tabsRef.current.find(({ id }) => id === activeRef.current);
      const opened = toolIntent.newTab || current === undefined || current.pinned
        ? await api.openTab(projectId, toolIntent.tool.connectionId, toolIntent.tool.name)
        : await api.replaceTabTool(projectId, current.id, toolIntent.tool.connectionId, toolIntent.tool.name);
      const next = current !== undefined && !toolIntent.newTab && !current.pinned
        ? tabsRef.current.map((item) => item.id === current.id ? opened : item)
        : [...tabsRef.current, opened];
      assign(next.sort((left, right) => left.position - right.position)); activate(opened.id); setView("debug");
    })().catch((error: unknown) => setMessage(error instanceof Error ? error.message : "无法打开 Tool Tab"));
  }, [api, flush, projectId, tabs, toolIntent]);

  async function select(id: string): Promise<void> { await flush(activeRef.current ?? undefined); activate(id); setView("debug"); }
  async function close(id: string): Promise<void> {
    await flush(id); await api.closeTab(projectId, id); const previous = tabsRef.current; const closedIndex = previous.findIndex((tab) => tab.id === id);
    const next = previous.filter((tab) => tab.id !== id); assign(next);
    if (activeRef.current === id) activate(next[Math.max(0, closedIndex - 1)]?.id ?? null);
  }
  async function duplicate(id: string): Promise<void> { await flush(id); const copy = await api.duplicateTab(projectId, id); assign([...tabsRef.current, copy]); activate(copy.id); }
  async function bulk(id: string, side: "others" | "right"): Promise<void> {
    await flush(); const next = side === "others" ? await api.closeOtherTabs(projectId, id) : await api.closeTabsRight(projectId, id);
    assign(next); if (!next.some((tab) => tab.id === activeRef.current)) activate(next.find((tab) => tab.id === id)?.id ?? next[0]?.id ?? null);
  }
  async function move(id: string, offset: -1 | 1): Promise<void> {
    await flush(); const ordered = [...tabsRef.current]; const index = ordered.findIndex((tab) => tab.id === id);
    const target = index + offset; if (index < 0 || target < 0 || target >= ordered.length) return;
    [ordered[index], ordered[target]] = [ordered[target], ordered[index]];
    assign(await api.reorderTabs(projectId, ordered.map((tab) => tab.id)));
  }
  async function execute(): Promise<void> {
    if (active === null) return; await flush(active.id);
    const latest = tabsRef.current.find(({ id }) => id === active.id); if (latest !== undefined) onExecute?.(latest);
  }

  if (tabs === null) return <p role="status">正在恢复调试 Tabs…</p>;
  return <section className="debug-workspace" aria-label="Tool 调试工作台">
    {message !== null && <p role="alert">{message}</p>}
    <TabStrip tabs={tabs} activeId={activeId} dirtyIds={new Set(pending.current.keys())} onSelect={(id) => void select(id)} onClose={(id) => void close(id)}
      onDuplicate={(id) => void duplicate(id)} onPin={(id, pinned) => schedule(id, { pinned })}
      onMove={(id, offset) => void move(id, offset)}
      onCloseOthers={(id) => void bulk(id, "others")} onCloseRight={(id) => void bulk(id, "right")} />
    {active === null ? <div className="workspace-empty"><h2>选择一个 Tool 开始调试</h2><p>单击复用当前未固定 Tab，双击打开新 Tab。</p></div> : <>
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
    </>}
    <span className="sr-only" role="status" aria-live="polite">{pending.current.size > 0 ? "Tab 有待保存更改" : "Tab 已保存"}</span>
  </section>;
}
