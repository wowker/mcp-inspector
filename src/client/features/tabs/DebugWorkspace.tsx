import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { X } from "@phosphor-icons/react";
import type { CatalogToolSummary, DebugTabSummary, InspectorApiClient, RunDetail, RunSummary, ToolDetailSummary } from "../../api/api-client.js";
import { formatRawArguments, parseRawArguments } from "../../../shared/json.js";
import { RunHistory } from "../runs/RunHistory.js";
import { EmptyRunResultPanel, RunResultPanel } from "../runs/RunResultPanel.js";
import { useRunEvents, useRunPolling } from "../runs/use-run-events.js";
import { ParameterEditor } from "./ParameterEditor.js";
import { TabStrip } from "./TabStrip.js";
import { ToolDefinitionView } from "./ToolDefinitionView.js";
import { SavedItemDialog } from "../saved-items/SavedItemDialog.js";
import { SavedItemsView } from "../saved-items/SavedItemsView.js";
import { schemaHasEditableArguments } from "./schema-form.js";

export interface ToolOpenIntent {
  sequence: number;
  tool: CatalogToolSummary;
  newTab: boolean;
  restoreRun?: RunDetail;
}
interface Props {
  api: InspectorApiClient; projectId: string; toolIntent?: ToolOpenIntent | null;
  onExecute?: (tab: DebugTabSummary) => void;
  onActiveToolChange?: (tool: { connectionId: string; name: string } | null) => void;
}

type WorkspaceView = "debug" | "definition" | "history" | "saved";
const PERSIST_DELAY = 300;
const ACTIVE_TAB_KEY_PREFIX = "mcp-inspector-active-tab:";
interface PendingSave { revision: number; patch: Partial<DebugTabSummary> }
interface BoundToolDetail { tabId: string; connectionId: string; toolName: string; value: ToolDetailSummary }
interface SubtreeDraft { text: string; base: string }
interface ActiveObservation { run: RunDetail | null; error: string | null }
interface SaveIntent {
  tabId: string; connectionId: string; toolName: string;
  kind: "request" | "response"; payload: unknown; sourceRunId: string | null;
}
const terminalRunStatuses = new Set(["succeeded", "failed", "cancelled", "interrupted"]);

function ActiveRunObserver({ api, projectId, tabId, runId, selected, onUpdate }: {
  api: InspectorApiClient; projectId: string; tabId: string; runId: string; selected: boolean;
  onUpdate: (tabId: string, runId: string, observation: ActiveObservation) => void;
}) {
  const streamed = useRunEvents(api, projectId, selected ? runId : null);
  const polled = useRunPolling(api, projectId, tabId, selected ? null : runId);
  const observation = selected ? streamed : polled;
  useEffect(() => { onUpdate(tabId, runId, { run: observation.run, error: observation.error }); },
    [observation.error, observation.run, onUpdate, runId, tabId]);
  return null;
}

export function DebugWorkspace(props: Props) {
  return <ProjectWorkspace key={props.projectId} {...props} />;
}

function ProjectWorkspace({ api, projectId, toolIntent = null, onExecute, onActiveToolChange }: Props) {
  const [tabs, setTabs] = useState<DebugTabSummary[] | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [boundDetail, setBoundDetail] = useState<BoundToolDetail | null>(null);
  const [view, setView] = useState<WorkspaceView>("debug");
  const [message, setMessage] = useState<string | null>(null);
  const [subtreeDrafts, setSubtreeDrafts] = useState<Record<string, Record<string, SubtreeDraft>>>({});
  const [selectedRuns, setSelectedRuns] = useState<Record<string, string>>({});
  const [readOnlyTabs, setReadOnlyTabs] = useState<RunSummary[]>([]);
  const [activeReadOnlyId, setActiveReadOnlyId] = useState<string | null>(null);
  const [startingIds, setStartingIds] = useState<ReadonlySet<string>>(new Set());
  const [activeObservations, setActiveObservations] = useState<Record<string, ActiveObservation>>({});
  const [saveIntent, setSaveIntent] = useState<SaveIntent | null>(null);
  const [saveNotice, setSaveNotice] = useState<{ sequence: number; message: string } | null>(null);
  const [savedRevision, setSavedRevision] = useState(0);
  const [parameterExpansion, setParameterExpansion] = useState<Record<string, boolean>>({});
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
  const starts = useRef(new Set<string>());
  const activeRuns = useRef(new Map<string, string>());
  const settledLastRuns = useRef(new Map<string, string>());
  const requestPaneRef = useRef<HTMLDivElement>(null);
  const resultPaneRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (saveNotice === null) return;
    const timer = window.setTimeout(() => setSaveNotice((current) => current?.sequence === saveNotice.sequence ? null : current), 2_000);
    return () => window.clearTimeout(timer);
  }, [saveNotice]);

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
  function activate(id: string | null): void {
    activeRef.current = id; setActiveId(id); if (id !== null) setActiveReadOnlyId(null);
    try {
      if (id === null) sessionStorage.removeItem(`${ACTIVE_TAB_KEY_PREFIX}${projectId}`);
      else sessionStorage.setItem(`${ACTIVE_TAB_KEY_PREFIX}${projectId}`, id);
    } catch { /* The workspace remains usable when browser storage is unavailable. */ }
  }

  async function copyToolName(toolName: string): Promise<void> {
    try {
      if (navigator.clipboard === undefined) throw new Error("Clipboard is unavailable");
      await navigator.clipboard.writeText(toolName);
      setMessage(null);
      setSaveNotice((current) => ({ sequence: (current?.sequence ?? 0) + 1, message: "Tool 名称已复制" }));
    } catch {
      setMessage("无法复制 Tool 名称，请检查浏览器剪贴板权限。");
    }
  }

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
      let stored: string | null = null;
      try { stored = sessionStorage.getItem(`${ACTIVE_TAB_KEY_PREFIX}${projectId}`); } catch { /* Ignore unavailable storage. */ }
      assign(loaded); activate(loaded.some(({ id }) => id === stored) ? stored : loaded[0]?.id ?? null);
    }).catch((error: unknown) => { if (loadGeneration.current === generation) setMessage(error instanceof Error ? error.message : "加载 Tabs 失败"); });
    const scope = ++workspaceGeneration.current;
    return () => { loadGeneration.current += 1; if (workspaceGeneration.current === scope) workspaceGeneration.current += 1;
      void flush(); for (const timer of timers.current.values()) clearTimeout(timer); timers.current.clear(); };
  }, [api, flush, projectId]);

  const active = tabs?.find(({ id }) => id === activeId) ?? null;
  const selectedRunId = activeReadOnlyId ?? (active === null ? null : selectedRuns[active.id] ?? active.lastRunId);
  const activeSelectedRunId = active === null ? undefined
    : activeRuns.current.get(active.id) ?? (active.lastRunId !== null && settledLastRuns.current.get(active.id) !== active.lastRunId
      ? active.lastRunId : undefined);
  const selectedUsesActiveObserver = selectedRunId !== null && selectedRunId === activeSelectedRunId;
  const inspected = useRunEvents(api, projectId, selectedUsesActiveObserver ? null : selectedRunId);
  const observed = selectedUsesActiveObserver && active !== null
    ? activeObservations[active.id] ?? { run: null, error: null } : inspected;
  useEffect(() => {
    onActiveToolChange?.(active === null ? null : { connectionId: active.connectionId, name: active.toolName });
  }, [active?.connectionId, active?.toolName, onActiveToolChange]);
  const handleActiveObservation = useCallback((tabId: string, runId: string, observation: ActiveObservation) => {
    if (activeRuns.current.get(tabId) !== runId) return;
    if (observation.run !== null && terminalRunStatuses.has(observation.run.status)) {
      settledLastRuns.current.set(tabId, runId);
      activeRuns.current.delete(tabId);
      setStartingIds((current) => { const next = new Set(current); next.delete(tabId); return next; });
      setActiveObservations((current) => { const next = { ...current }; delete next[tabId]; return next; });
      return;
    }
    setActiveObservations((current) => current[tabId]?.run === observation.run && current[tabId]?.error === observation.error
      ? current : { ...current, [tabId]: observation });
  }, []);
  useEffect(() => {
    if (tabs === null) return;
    const persisted = new Map(tabs.filter((tab) => tab.lastRunId !== null && settledLastRuns.current.get(tab.id) !== tab.lastRunId)
      .map((tab) => [tab.id, tab.lastRunId!]));
    for (const [tabId, runId] of [...settledLastRuns.current]) {
      if (!tabs.some((tab) => tab.id === tabId && tab.lastRunId === runId)) settledLastRuns.current.delete(tabId);
    }
    for (const [tabId, runId] of [...activeRuns.current]) {
      if (persisted.get(tabId) !== runId) activeRuns.current.delete(tabId);
    }
    for (const [tabId, runId] of persisted) activeRuns.current.set(tabId, runId);
    setStartingIds(new Set([...persisted.keys(), ...starts.current]));
    setActiveObservations((current) => Object.fromEntries(Object.entries(current)
      .filter(([tabId, observation]) => persisted.get(tabId) === observation.run?.id)));
  }, [tabs === null ? null : tabs.map(({ id, lastRunId }) => `${id}:${lastRunId ?? ""}`).join("|")]);
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
      const restoreRun = intent.restoreRun;
      if (restoreRun !== undefined && (restoreRun.projectId !== projectId ||
        restoreRun.connectionId !== intent.tool.connectionId || restoreRun.toolName !== intent.tool.name)) {
        throw new Error("历史记录与目标 Tool 不匹配");
      }
      const current = tabsRef.current.find(({ id }) => id === activeRef.current);
      let opened = intent.newTab || current === undefined || current.pinned
        ? await api.openTab(projectId, intent.tool.connectionId, intent.tool.name)
        : await api.replaceTabTool(projectId, current.id, intent.tool.connectionId, intent.tool.name);
      if (restoreRun !== undefined) {
        opened = await api.updateTab(projectId, opened.id, {
          arguments: restoreRun.request.arguments,
          rawText: formatRawArguments(restoreRun.request.arguments),
        });
      }
      if (workspaceGeneration.current !== scope) return;
      const next = current !== undefined && !intent.newTab && !current.pinned
        ? tabsRef.current.map((item) => item.id === current.id ? opened : item)
        : [...tabsRef.current, opened];
      setSubtreeDrafts((drafts) => { const updated = { ...drafts }; if (current !== undefined) delete updated[current.id]; return updated; });
      assign(next.sort((left, right) => left.position - right.position));
      if (restoreRun !== undefined) {
        setSelectedRuns((selected) => ({ ...selected, [opened.id]: restoreRun.id }));
      }
      activate(opened.id); setView("debug");
    }).catch((error: unknown) => { if (workspaceGeneration.current === scope) setMessage(error instanceof Error ? error.message : "无法打开 Tool Tab"); });
  }, [api, flush, projectId, tabs, toolIntent]);

  async function reconcileLaunch(id: string): Promise<boolean> {
    const persistedRunId = tabsRef.current.find((tab) => tab.id === id)?.lastRunId ?? null;
    const runId = activeRuns.current.get(id) ?? (persistedRunId !== null && settledLastRuns.current.get(id) !== persistedRunId
      ? persistedRunId : undefined);
    if (runId === undefined) return true;
    try {
      const run = await api.getRun(projectId, runId);
      if (!terminalRunStatuses.has(run.status)) return false;
      if (activeRuns.current.get(id) === run.id) {
        settledLastRuns.current.set(id, run.id); activeRuns.current.delete(id);
        setStartingIds((current) => { const next = new Set(current); next.delete(id); return next; });
      }
      return true;
    } catch (error) { setMessage(error instanceof Error ? error.message : "检查运行状态失败"); return false; }
  }
  async function select(id: string): Promise<void> {
    if (!(await flush(activeRef.current ?? undefined))) return; await reconcileLaunch(id); activate(id); setView("debug");
  }
  async function openHistory(run: RunSummary): Promise<void> {
    if (!(await flush(activeRef.current ?? undefined))) return;
    const origin = tabsRef.current.find(({ id }) => id === run.tabId);
    if (origin !== undefined) {
      const scope = workspaceGeneration.current;
      try {
        const detail = await api.getRun(projectId, run.id);
        if (workspaceGeneration.current !== scope) return;
        const currentOrigin = tabsRef.current.find(({ id }) => id === origin.id);
        if (currentOrigin === undefined || detail.tabId !== currentOrigin.id || detail.connectionId !== currentOrigin.connectionId
          || detail.toolName !== currentOrigin.toolName) {
          setMessage("历史记录与当前 Tool 不匹配"); return;
        }
        schedule(currentOrigin.id, { arguments: detail.request.arguments, rawText: formatRawArguments(detail.request.arguments) });
        setSelectedRuns((current) => ({ ...current, [currentOrigin.id]: detail.id }));
        activate(currentOrigin.id); setView("debug");
      } catch (error) {
        if (workspaceGeneration.current === scope) setMessage(error instanceof Error ? error.message : "加载运行历史失败");
      }
      return;
    }
    setReadOnlyTabs((current) => current.some(({ id }) => id === run.id) ? current : [...current, run]);
    activeRef.current = null; setActiveId(null); setActiveReadOnlyId(run.id); setView("debug");
  }
  function closeReadOnly(runId: string): void {
    setReadOnlyTabs((current) => current.filter(({ id }) => id !== runId));
    if (activeReadOnlyId === runId) { const fallback = tabsRef.current[0]?.id ?? null; setActiveReadOnlyId(null); activate(fallback); }
  }
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
    if (active === null || starts.current.has(active.id)) return;
    // Acquire the per-Tab lock before the first await so rapid clicks cannot
    // both pass the gate while launch reconciliation is in flight.
    starts.current.add(active.id);
    let launched = false; let markedStarting = false;
    try {
      if (!(await reconcileLaunch(active.id))) return;
      markedStarting = true; setStartingIds((current) => new Set(current).add(active.id)); setMessage(null);
      if (!(await flush(active.id))) return;
      const latest = tabsRef.current.find(({ id }) => id === active.id); if (latest === undefined) return;
      const parsed = latest.inputMode === "raw" ? parseRawArguments(latest.rawText) : { ok: true as const, value: latest.arguments };
      if (!parsed.ok) { setMessage(parsed.message); return; }
      if (onExecute !== undefined) { onExecute(latest); return; }
      const run = await api.startRun(projectId, latest.id, crypto.randomUUID(), parsed.value);
      launched = true;
      activeRuns.current.set(latest.id, run.id);
      setSelectedRuns((current) => ({ ...current, [latest.id]: run.id }));
      schedule(latest.id, { lastRunId: run.id }); setView("debug");
    } catch (error) { setMessage(error instanceof Error ? error.message : "启动运行失败"); }
    finally { starts.current.delete(active.id); if (markedStarting && !launched) setStartingIds((current) => { const next = new Set(current); next.delete(active.id); return next; }); }
  }

  const detail = active !== null && boundDetail?.tabId === active.id && boundDetail.connectionId === active.connectionId &&
    boundDetail.toolName === active.toolName ? boundDetail.value : null;
  const noEditableParameters = active !== null && detail !== null && active.inputMode === "form" &&
    !schemaHasEditableArguments(detail.tool.currentSnapshot.definition.inputSchema, active.arguments);
  const parametersExpanded = active === null ? true : parameterExpansion[active.id] ?? true;

  useLayoutEffect(() => {
    if (view !== "debug" || detail === null) return;
    const tabId = activeRef.current;
    const tab = tabId === null ? undefined : tabsRef.current.find(({ id }) => id === tabId);
    if (tab === undefined) return;
    if (requestPaneRef.current !== null) requestPaneRef.current.scrollTop = tab.viewState.editorScrollTop;
    if (resultPaneRef.current !== null) resultPaneRef.current.scrollTop = tab.viewState.resultScrollTop;
  }, [activeId, detail, view]);

  function resizeSplit(event: ReactPointerEvent<HTMLLabelElement>): void {
    if (active === null) return;
    const split = event.currentTarget.parentElement;
    if (split === null) return;
    const bounds = split.getBoundingClientRect();
    if (bounds.height <= 0) return;
    const ratio = Math.min(0.8, Math.max(0.2, (event.clientY - bounds.top) / bounds.height));
    schedule(active.id, { viewState: { ...active.viewState, splitRatio: Math.round(ratio * 1000) / 1000 } });
  }

  if (tabs === null) return <p role="status">正在恢复调试 Tabs…</p>;
  return <section className="debug-workspace" aria-label="Tool 调试工作台">
    {[...startingIds].map((tabId) => { const runId = activeRuns.current.get(tabId); return runId === undefined ? null
      : <ActiveRunObserver key={`${tabId}:${runId}`} api={api} projectId={projectId} tabId={tabId} runId={runId}
          selected={tabId === activeId} onUpdate={handleActiveObservation} />; })}
    {message !== null && <p role="alert">{message}</p>}
    <div className="workspace-tabbar">
      <TabStrip tabs={tabs} activeId={activeReadOnlyId === null ? activeId : null} dirtyIds={new Set([...pending.current.keys(), ...queues.current.keys()])}
        runningIds={startingIds} onSelect={(id) => void select(id)} onClose={(id) => void close(id)}
        onCopyName={(toolName) => void copyToolName(toolName)}
        onDuplicate={(id) => void duplicate(id)} onPin={(id, pinned) => schedule(id, { pinned })}
        onMove={(id, offset) => void move(id, offset)}
        onCloseOthers={(id) => void bulk(id, "others")} onCloseRight={(id) => void bulk(id, "right")} />
      {activeReadOnlyId === null && active !== null && <nav className="workspace-nav" aria-label="当前 Tab 视图">
        {(["debug", "definition", "saved", "history"] as const).map((item) => <button type="button" key={item}
          aria-current={view === item ? "page" : undefined} onClick={() => setView(item)}>
          {item === "debug" ? "调试" : item === "definition" ? "Tool 定义" : item === "saved" ? "已保存" : "当前 Tab 历史"}</button>)}
      </nav>}
    </div>
    {readOnlyTabs.length > 0 && <div className="history-tabs" role="tablist" aria-label="只读运行 Tabs" onKeyDown={(event) => {
      if (!(event.target instanceof HTMLElement) || event.target.getAttribute("role") !== "tab" ||
          !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')]; const index = buttons.indexOf(event.target as HTMLButtonElement);
      const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : event.key === "ArrowRight"
        ? (index + 1) % buttons.length : (index - 1 + buttons.length) % buttons.length;
      const target = buttons[next]; if (target !== undefined) { event.preventDefault(); target.focus(); target.click(); }
    }}>{readOnlyTabs.map((run, index) => <span key={run.id}>
      <button id={`history-tab-${run.id}`} aria-controls={`history-panel-${run.id}`} type="button" role="tab"
        tabIndex={activeReadOnlyId === run.id || (activeReadOnlyId === null && index === 0) ? 0 : -1}
        aria-selected={activeReadOnlyId === run.id} onClick={() => { activeRef.current = null; setActiveId(null); setActiveReadOnlyId(run.id); setView("debug"); }}>只读 · {run.toolName} · {run.id.slice(0, 8)}</button>
      <button type="button" aria-label={`关闭只读运行 ${run.id}`} onClick={() => closeReadOnly(run.id)}><X size={15} aria-hidden="true" /></button></span>)}</div>}
    {activeReadOnlyId !== null ? <section id={`history-panel-${activeReadOnlyId}`} role="tabpanel" aria-labelledby={`history-tab-${activeReadOnlyId}`} className="read-only-run"><p role="status">只读历史结果，不会重新调用 Tool。</p>
        {observed.error !== null && <p role="alert">{observed.error}</p>}{observed.run === null ? <p role="status">正在加载运行详情…</p> : <RunResultPanel run={observed.run} />}</section>
      : active === null ? <div className="workspace-empty"><h2>选择一个 Tool 开始调试</h2><p>单击复用当前未固定 Tab，双击打开新 Tab。</p></div> : <div className="workspace-tab-panel" id={`tabpanel-${active.id}`} role="tabpanel" aria-labelledby={`tab-${active.id}`}>
      {view === "debug" && detail === null && <p role="status">正在加载 Tool 定义…</p>}
      {view === "debug" && detail !== null && <div className={`request-result-split${selectedRunId === null ? " request-result-split--empty" : ""}${noEditableParameters ? " request-result-split--no-parameters" : ""}`}
        style={{ gridTemplateRows: noEditableParameters || !parametersExpanded
          ? "auto 10px minmax(0, 1fr)" : `${active.viewState.splitRatio * 100}% 10px 1fr` }}>
        <div className="request-pane" ref={requestPaneRef}
          onScroll={(event) => schedule(active.id, { viewState: { ...active.viewState, editorScrollTop: event.currentTarget.scrollTop } })}>
          <ParameterEditor tab={active} schema={detail.tool.currentSnapshot.definition.inputSchema} executing={startingIds.has(active.id)}
            expanded={parametersExpanded} onExpandedChange={(expanded) => setParameterExpansion((current) => ({ ...current, [active.id]: expanded }))}
            subtreeDrafts={subtreeDrafts[active.id]}
            onSubtreeDraftChange={(path, text, base) => setSubtreeDrafts((current) => ({ ...current,
              [active.id]: { ...(current[active.id] ?? {}), [path]: { text, base } } }))}
            onChange={(patch) => schedule(active.id, patch)} onExecute={() => void execute()}
            onSaveRequest={(payload) => setSaveIntent({ tabId: active.id, connectionId: active.connectionId,
              toolName: active.toolName, kind: "request", payload, sourceRunId: null })} />
        </div>
        <label className="split-control" onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); resizeSplit(event); }}
          onPointerMove={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) resizeSplit(event); }}>
          <span className="sr-only">请求区高度</span>
          <input aria-label="请求区高度" type="range" min="20" max="80" value={active.viewState.splitRatio * 100}
            onChange={(event) => schedule(active.id, { viewState: { ...active.viewState, splitRatio: Number(event.target.value) / 100 } })} />
        </label>
        <div className="result-placeholder" ref={resultPaneRef}
          onScroll={(event) => schedule(active.id, { viewState: { ...active.viewState, resultScrollTop: event.currentTarget.scrollTop } })}>
          {observed.error !== null && <p role="alert">{observed.error}</p>}
          {selectedRunId === null ? <EmptyRunResultPanel />
            : observed.run === null ? <p role="status">正在加载运行详情…</p> : <RunResultPanel run={observed.run}
              onSaveResponse={(payload) => setSaveIntent({ tabId: active.id, connectionId: active.connectionId,
                toolName: active.toolName, kind: "response", payload, sourceRunId: observed.run!.id })} />}</div>
      </div>}
      {view === "definition" && detail !== null && <ToolDefinitionView detail={detail} />}
      {view === "saved" && <SavedItemsView api={api} projectId={projectId} connectionId={active.connectionId} toolName={active.toolName}
        refreshKey={savedRevision} onLoadRequest={(payload) => { schedule(active.id, { arguments: payload, rawText: formatRawArguments(payload) }); setView("debug"); }} />}
      {view === "history" && <RunHistory api={api} projectId={projectId} tabId={active.id} connectionId={active.connectionId}
        toolName={active.toolName} hideHeading onOpen={(run) => void openHistory(run)} />}
    </div>}
    {saveIntent !== null && <SavedItemDialog api={api} projectId={projectId} connectionId={saveIntent.connectionId}
      toolName={saveIntent.toolName} kind={saveIntent.kind} payload={saveIntent.payload} sourceRunId={saveIntent.sourceRunId}
      onClose={() => setSaveIntent(null)} onSaved={() => { const saved = saveIntent; setSaveIntent(null); setSavedRevision((value) => value + 1);
        setSaveNotice((current) => ({ sequence: (current?.sequence ?? 0) + 1, message: `${saved.kind === "request" ? "请求" : "响应"}保存成功` })); }} />}
    {saveNotice !== null && <div className="copy-toast" role="status" aria-live="polite">{saveNotice.message}</div>}
    <span className="sr-only" role="status" aria-live="polite">{queues.current.size > 0 ? "正在保存 Tab" : pending.current.size > 0 ? "Tab 有待保存更改" : "Tab 已保存"}</span>
  </section>;
}
