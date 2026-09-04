import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState,
  type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { X } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import type {
  CatalogToolSummary,
  DebugTabSummary,
  InspectorApiClient,
  RunDetail,
  RunSummary,
  ToolDetailSummary,
  ToolWorkflow,
  WorkflowExecutionDetail,
} from "../../api/api-client.js";
import { formatRawArguments, parseRawArguments } from "../../../shared/json.js";
import { confirmToast } from "../../app/AppToaster.js";
import { Button } from "../../components/actions/Button.js";
import type { SplitPanePreset } from "../../components/layout/SplitPanePresets.js";
import { RunHistory } from "../runs/RunHistory.js";
import { EmptyRunResultPanel, RunResultPanel } from "../runs/RunResultPanel.js";
import { useRunEvents, useRunPolling } from "../runs/use-run-events.js";
import { ParameterEditor } from "./ParameterEditor.js";
import { TabStrip } from "./TabStrip.js";
import { SavedItemDialog } from "../saved-items/SavedItemDialog.js";
import { SavedItemsView } from "../saved-items/SavedItemsView.js";
import { schemaHasEditableArguments, valueAtJsonPointer } from "./schema-form.js";
import { sanitizeTestCaseArguments } from "../../../shared/testing/creation-preview.js";
import { DebugSettingsPopover } from "./DebugSettingsPopover.js";

const ToolDefinitionView = lazy(async () => {
  const module = await import("./ToolDefinitionView.js");
  return { default: module.ToolDefinitionView };
});
const ScriptWorkflowView = lazy(async () => {
  const module = await import("./ScriptWorkflowView.js");
  return { default: module.ScriptWorkflowView };
});

export interface ToolOpenIntent {
  sequence: number;
  tool: CatalogToolSummary;
  newTab: boolean;
  restoreRun?: RunDetail;
}
interface Props {
  api: InspectorApiClient; projectId: string; connectionId?: string; toolIntent?: ToolOpenIntent | null;
  onExecute?: (tab: DebugTabSummary) => void;
  onActiveToolChange?: (tool: { connectionId: string; name: string } | null) => void;
  onCreateTestFromSaved?: (item: import("../../api/api-client.js").SavedItemDetail) => void;
  onToolIntentHandled?: (sequence: number) => void;
}

type WorkspaceView = "debug" | "definition" | "script" | "history" | "saved";
const PERSIST_DELAY = 300;
const ACTIVE_TAB_KEY_PREFIX = "mcp-inspector-active-tab:";
interface PendingSave { revision: number; patch: Partial<DebugTabSummary> }
interface BoundToolDetail { tabId: string; connectionId: string; toolName: string; value: ToolDetailSummary }
interface BoundWorkflow { tabId: string; connectionId: string; toolName: string; value: ToolWorkflow }
interface SubtreeDraft { text: string; base: string }
interface ActiveObservation { run: RunDetail | null; error: string | null }
interface SaveIntent {
  tabId: string; connectionId: string; toolName: string;
  kind: "request" | "response"; payload: unknown; sourceRunId: string | null;
}
const terminalRunStatuses = new Set(["succeeded", "failed", "cancelled", "interrupted"]);
const splitPaneRatios: Record<SplitPanePreset, number> = {
  request: 0.65,
  balanced: 0.5,
  result: 0.35,
};

function splitPanePreset(ratio: number): SplitPanePreset | "custom" {
  return (Object.entries(splitPaneRatios) as Array<[SplitPanePreset, number]>)
    .find(([, presetRatio]) => Math.abs(presetRatio - ratio) < 0.001)?.[0] ?? "custom";
}

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
  return <ProjectWorkspace key={`${props.projectId}:${props.connectionId ?? "test"}`} {...props} />;
}

function ProjectWorkspace({ api, projectId, connectionId = "", toolIntent = null, onExecute, onActiveToolChange,
  onCreateTestFromSaved, onToolIntentHandled }: Props) {
  const { t } = useTranslation("tools");
  const [tabs, setTabs] = useState<DebugTabSummary[] | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [boundDetail, setBoundDetail] = useState<BoundToolDetail | null>(null);
  const [boundWorkflow, setBoundWorkflow] = useState<BoundWorkflow | null>(null);
  const [view, setView] = useState<WorkspaceView>("debug");
  const [message, setMessage] = useState<string | null>(null);
  const [subtreeDrafts, setSubtreeDrafts] = useState<Record<string, Record<string, SubtreeDraft>>>({});
  const [selectedRuns, setSelectedRuns] = useState<Record<string, string>>({});
  const [readOnlyTabs, setReadOnlyTabs] = useState<RunSummary[]>([]);
  const [activeReadOnlyId, setActiveReadOnlyId] = useState<string | null>(null);
  const [startingIds, setStartingIds] = useState<ReadonlySet<string>>(new Set());
  const [activeObservations, setActiveObservations] = useState<Record<string, ActiveObservation>>({});
  const [saveIntent, setSaveIntent] = useState<SaveIntent | null>(null);
  const [savedRevision, setSavedRevision] = useState(0);
  const [savingTestCaseIds, setSavingTestCaseIds] = useState<ReadonlySet<string>>(new Set());
  const [historyDetail, setHistoryDetail] = useState<RunDetail | null>(null);
  const [historyDetailState, setHistoryDetailState] = useState<"idle" | "loading" | "error">("idle");
  const [historyRefreshKey, setHistoryRefreshKey] = useState(0);
  const [historyMutating, setHistoryMutating] = useState(false);
  const [workflowExecutions, setWorkflowExecutions] = useState<Record<string, WorkflowExecutionDetail>>({});
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
  const activeWorkflows = useRef(new Map<string, string>());
  const workflowControllers = useRef(new Map<string, AbortController>());
  const savingTestCases = useRef(new Set<string>());
  const settledLastRuns = useRef(new Map<string, string>());
  const requestPaneRef = useRef<HTMLDivElement>(null);
  const resultPaneRef = useRef<HTMLDivElement>(null);
  const saveTabFallbackRef = useRef(t("workspace.errors.saveTab"));
  saveTabFallbackRef.current = t("workspace.errors.saveTab");

  function assign(next: DebugTabSummary[]): void {
    tabsRef.current = next; setTabs(next);
    setSubtreeDrafts((current) => {
      const retained: Record<string, Record<string, SubtreeDraft>> = {};
      for (const [tabId, drafts] of Object.entries(current)) {
        const tab = next.find((item) => item.id === tabId); if (tab === undefined) continue;
        const valid = Object.fromEntries(Object.entries(drafts).filter(([path, draft]) => {
          const canonical = valueAtJsonPointer(tab.arguments, path);
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
      if (id === null) sessionStorage.removeItem(`${ACTIVE_TAB_KEY_PREFIX}${projectId}:${connectionId}`);
      else sessionStorage.setItem(`${ACTIVE_TAB_KEY_PREFIX}${projectId}:${connectionId}`, id);
    } catch { /* The workspace remains usable when browser storage is unavailable. */ }
  }

  async function copyToolName(toolName: string): Promise<void> {
    try {
      if (navigator.clipboard === undefined) throw new Error("Clipboard is unavailable");
      await navigator.clipboard.writeText(toolName);
      setMessage(null);
      toast.success(t("workspace.copiedName"));
    } catch {
      setMessage(t("workspace.copyNameFailed"));
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
            setMessage(error instanceof Error ? error.message : saveTabFallbackRef.current);
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
    void api.listTabs(projectId, connectionId).then((loaded) => {
      if (loadGeneration.current !== generation) return;
      if (connectionId !== "" && loaded.some((tab) => tab.connectionId !== connectionId)) {
        throw new Error(t("workspace.errors.tabConnectionMismatch"));
      }
      let stored: string | null = null;
      try { stored = sessionStorage.getItem(`${ACTIVE_TAB_KEY_PREFIX}${projectId}:${connectionId}`); } catch { /* Ignore unavailable storage. */ }
      assign(loaded); activate(loaded.some(({ id }) => id === stored) ? stored : loaded[0]?.id ?? null);
    }).catch((error: unknown) => { if (loadGeneration.current === generation) setMessage(error instanceof Error ? error.message : t("workspace.errors.loadTabs")); });
    const scope = ++workspaceGeneration.current;
    return () => { loadGeneration.current += 1; if (workspaceGeneration.current === scope) workspaceGeneration.current += 1;
      for (const controller of workflowControllers.current.values()) controller.abort(); workflowControllers.current.clear(); activeWorkflows.current.clear();
      void flush(); for (const timer of timers.current.values()) clearTimeout(timer); timers.current.clear(); };
  }, [api, connectionId, flush, projectId]);

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
      if (!activeWorkflows.current.has(tabId)) {
        setStartingIds((current) => { const next = new Set(current); next.delete(tabId); return next; });
      }
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
    setBoundDetail(null); setBoundWorkflow(null);
    if (active === null) return;
    const generation = ++loadGeneration.current;
    void api.getTool(projectId, active.connectionId, active.toolName).then((value) => {
      if (loadGeneration.current === generation && activeRef.current === active.id) {
        setBoundDetail({ tabId: active.id, connectionId: active.connectionId, toolName: active.toolName, value });
      }
    }).catch((error: unknown) => { if (loadGeneration.current === generation) { setBoundDetail(null); setMessage(error instanceof Error ? error.message : t("workspace.errors.loadTool")); } });
    if (typeof api.getToolWorkflow === "function") {
      void Promise.resolve(api.getToolWorkflow(projectId, active.connectionId, active.toolName)).then((workflow) => {
        if (workflow === undefined) return;
        if (loadGeneration.current === generation && activeRef.current === active.id) {
          setBoundWorkflow({ tabId: active.id, connectionId: active.connectionId, toolName: active.toolName, value: workflow });
        }
      }).catch((error: unknown) => { if (loadGeneration.current === generation) setMessage(error instanceof Error ? error.message : t("workspace.errors.loadWorkflow")); });
    }
  }, [active?.connectionId, active?.id, active?.toolName, api, projectId]);

  useEffect(() => {
    if (active === null || typeof api.getActiveWorkflowExecution !== "function" || activeWorkflows.current.has(active.id)) return;
    const tabId = active.id; const scope = workspaceGeneration.current; const query = new AbortController();
    setStartingIds((current) => new Set(current).add(tabId));
    void api.getActiveWorkflowExecution(projectId, tabId, query.signal).then((execution) => {
      if (query.signal.aborted || workspaceGeneration.current !== scope || activeRef.current !== tabId) return;
      if (execution === null) {
        if (!starts.current.has(tabId) && !activeRuns.current.has(tabId)) {
          setStartingIds((current) => { const next = new Set(current); next.delete(tabId); return next; });
        }
        return;
      }
      activeWorkflows.current.set(tabId, execution.id);
      setWorkflowExecutions((current) => ({ ...current, [tabId]: execution }));
      const observer = new AbortController(); workflowControllers.current.set(tabId, observer);
      void observeWorkflow(tabId, execution.id, scope, observer.signal);
    }).catch((error: unknown) => {
      if (query.signal.aborted || workspaceGeneration.current !== scope) return;
      setStartingIds((current) => { const next = new Set(current); next.delete(tabId); return next; });
      setMessage(error instanceof Error ? error.message : t("workspace.errors.restoreWorkflow"));
    });
    return () => {
      query.abort();
      if (!activeWorkflows.current.has(tabId) && !starts.current.has(tabId) && !activeRuns.current.has(tabId)) {
        setStartingIds((current) => { const next = new Set(current); next.delete(tabId); return next; });
      }
    };
  }, [active?.id, api, projectId]);

  useEffect(() => {
    if (toolIntent === null || toolIntent.sequence === handledIntent.current || tabs === null ||
      toolIntent.tool.projectId !== projectId || (connectionId !== "" && toolIntent.tool.connectionId !== connectionId)) return;
    handledIntent.current = toolIntent.sequence;
    onToolIntentHandled?.(toolIntent.sequence);
    const intent = toolIntent; const scope = workspaceGeneration.current;
    intentQueue.current = intentQueue.current.catch(() => undefined).then(async () => {
      if (workspaceGeneration.current !== scope || !(await flush()) || workspaceGeneration.current !== scope) return;
      if (handledIntent.current > intent.sequence) return;
      const restoreRun = intent.restoreRun;
      if (restoreRun !== undefined && (restoreRun.projectId !== projectId ||
        restoreRun.connectionId !== intent.tool.connectionId || restoreRun.toolName !== intent.tool.name)) {
        throw new Error(t("workspace.errors.historyTargetMismatch"));
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
    }).catch((error: unknown) => { if (workspaceGeneration.current === scope) setMessage(error instanceof Error ? error.message : t("workspace.errors.openTab")); });
  }, [api, connectionId, flush, onToolIntentHandled, projectId, tabs, toolIntent]);

  async function saveAsTestCase(tab: DebugTabSummary, argumentsValue: Record<string, unknown>): Promise<void> {
    if (savingTestCases.current.has(tab.id)) return;
    savingTestCases.current.add(tab.id);
    setSavingTestCaseIds((current) => new Set(current).add(tab.id));
    const sanitized = sanitizeTestCaseArguments(argumentsValue);
    try {
      const saved = await api.createTestCase(projectId, {
        kind: "tool",
        name: t("parameter.defaultTestCaseName", { toolName: tab.toolName }).slice(0, 120),
        description: "",
        tags: [],
        isEnabled: true,
        target: { connectionId: tab.connectionId, toolName: tab.toolName },
        arguments: sanitized.arguments,
        assertions: [],
        timeoutMs: 30_000,
      });
      if (saved.projectId !== projectId || saved.kind !== "tool" || saved.target.connectionId !== tab.connectionId ||
          saved.target.toolName !== tab.toolName) throw new Error("Invalid test case response");
      toast.success(t(sanitized.omittedSensitiveValues
        ? "parameter.testCaseSavedSensitiveOmitted"
        : "parameter.testCaseSaved"));
    } catch {
      setMessage(t("parameter.testCaseSaveFailed"));
    } finally {
      savingTestCases.current.delete(tab.id);
      setSavingTestCaseIds((current) => { const next = new Set(current); next.delete(tab.id); return next; });
    }
  }

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
    } catch (error) { setMessage(error instanceof Error ? error.message : t("workspace.errors.checkRun")); return false; }
  }
  async function select(id: string): Promise<void> {
    if (!(await flush(activeRef.current ?? undefined))) return; await reconcileLaunch(id); activate(id); setView("debug");
  }
  async function inspectHistory(run: RunSummary): Promise<void> {
    const scope = workspaceGeneration.current;
    setHistoryDetailState("loading"); setHistoryDetail(null); setMessage(null);
    try {
      const detail = await api.getRun(projectId, run.id);
      if (workspaceGeneration.current !== scope || detail.projectId !== projectId) return;
      setHistoryDetail(detail); setHistoryDetailState("idle");
    } catch (error) {
      if (workspaceGeneration.current === scope) {
        setHistoryDetailState("error"); setMessage(error instanceof Error ? error.message : t("workspace.errors.loadHistory"));
      }
    }
  }

  async function loadHistory(run: RunSummary): Promise<void> {
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
          setMessage(t("workspace.errors.historyToolMismatch")); return;
        }
        schedule(currentOrigin.id, { arguments: detail.request.arguments, rawText: formatRawArguments(detail.request.arguments) });
        setSelectedRuns((current) => ({ ...current, [currentOrigin.id]: detail.id }));
        activate(currentOrigin.id); setView("debug");
      } catch (error) {
        if (workspaceGeneration.current === scope) setMessage(error instanceof Error ? error.message : t("workspace.errors.loadHistory"));
      }
      return;
    }
    setReadOnlyTabs((current) => current.some(({ id }) => id === run.id) ? current : [...current, run]);
    activeRef.current = null; setActiveId(null); setActiveReadOnlyId(run.id); setView("debug");
  }
  function deleteHistory(run: RunSummary): void {
    confirmToast({
      message: t("workspace.history.deleteTitle"), description: t("workspace.history.deleteDescription"),
      actionLabel: t("workspace.history.deleteConfirm"), cancelLabel: t("workspace.cancel"),
      onAction: () => {
        setHistoryMutating(true);
        void api.deleteRun(projectId, run.id).then(() => {
          if (historyDetail?.id === run.id) { setHistoryDetail(null); setHistoryDetailState("idle"); }
          setSelectedRuns((current) => Object.fromEntries(Object.entries(current).filter(([, runId]) => runId !== run.id)));
          if (tabsRef.current.some((tab) => tab.lastRunId === run.id)) {
            assign(tabsRef.current.map((tab) => tab.lastRunId === run.id ? { ...tab, lastRunId: null } : tab));
          }
          setHistoryRefreshKey((value) => value + 1); toast.success(t("workspace.history.deleted"));
        }).catch((error: unknown) => setMessage(error instanceof Error ? error.message : t("workspace.history.deleteFailed")))
          .finally(() => setHistoryMutating(false));
      },
    });
  }
  function clearHistory(tab: DebugTabSummary): void {
    confirmToast({
      message: t("workspace.history.clearTitle"), description: t("workspace.history.clearDescription"),
      actionLabel: t("workspace.history.clearConfirm"), cancelLabel: t("workspace.cancel"),
      onAction: () => {
        setHistoryMutating(true);
        void api.clearRunHistory(projectId, { tabId: tab.id, connectionId: tab.connectionId, toolName: tab.toolName })
          .then((result) => {
            setHistoryDetail(null); setHistoryDetailState("idle");
            setSelectedRuns((current) => { const next = { ...current }; delete next[tab.id]; return next; });
            assign(tabsRef.current.map((item) => item.id === tab.id ? { ...item, lastRunId: null } : item));
            setHistoryRefreshKey((value) => value + 1);
            toast.success(t(result.retained > 0 ? "workspace.history.clearedRetained" : "workspace.history.cleared",
              { deleted: result.deleted, retained: result.retained }));
          }).catch((error: unknown) => setMessage(error instanceof Error ? error.message : t("workspace.history.clearFailed")))
          .finally(() => setHistoryMutating(false));
      },
    });
  }
  function closeReadOnly(runId: string): void {
    setReadOnlyTabs((current) => current.filter(({ id }) => id !== runId));
    if (activeReadOnlyId === runId) { const fallback = tabsRef.current[0]?.id ?? null; setActiveReadOnlyId(null); activate(fallback); }
  }
  function actionError(error: unknown): void { setMessage(error instanceof Error ? error.message : t("workspace.errors.tabAction")); }
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
      if (!(await flush())) return; const next = side === "others" ? await api.closeOtherTabs(projectId, connectionId, id) : await api.closeTabsRight(projectId, connectionId, id);
      assign(next); if (!next.some((tab) => tab.id === activeRef.current)) activate(next.find((tab) => tab.id === id)?.id ?? next[0]?.id ?? null);
    } catch (error) { actionError(error); }
  }
  async function move(id: string, offset: -1 | 1): Promise<void> {
    try {
      if (!(await flush())) return; const ordered = [...tabsRef.current]; const index = ordered.findIndex((tab) => tab.id === id);
      const target = index + offset; if (index < 0 || target < 0 || target >= ordered.length) return;
      [ordered[index], ordered[target]] = [ordered[target], ordered[index]];
      assign(await api.reorderTabs(projectId, connectionId, ordered.map((tab) => tab.id)));
    } catch (error) { actionError(error); }
  }
  async function execute(destructiveHelpersApproved = false): Promise<void> {
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
      if (connectionId !== "" && latest.connectionId !== connectionId) {
        setMessage(t("workspace.errors.activeConnectionMismatch")); return;
      }
      const parsed = latest.inputMode === "raw" ? parseRawArguments(latest.rawText) : { ok: true as const, value: latest.arguments };
      if (!parsed.ok) { setMessage(parsed.message); return; }
      if (onExecute !== undefined) { onExecute(latest); return; }
      const workflow = destructiveHelpersApproved && typeof api.getToolWorkflow === "function"
        ? await api.getToolWorkflow(projectId, latest.connectionId, latest.toolName)
        : boundWorkflow?.tabId === latest.id ? boundWorkflow.value
          : typeof api.getToolWorkflow === "function" ? await api.getToolWorkflow(projectId, latest.connectionId, latest.toolName) : null;
      if (workflow?.before.enabled === true || workflow?.after.enabled === true) {
        const sources = `${workflow.before.source}\n${workflow.after.source}`;
        const callsHelpers = sources.includes("tools.call");
        if (callsHelpers && !destructiveHelpersApproved) {
          confirmToast({
            message: t("workspace.destructiveMessage"),
            description: t("workspace.destructiveDescription"),
            actionLabel: t("workspace.allowExecution"),
            cancelLabel: t("workspace.cancel"),
            onAction: () => void execute(true),
          });
          return;
        }
        const allowDestructiveHelpers = callsHelpers && destructiveHelpersApproved;
        const execution = await api.startWorkflowExecution(projectId, connectionId, latest.id, crypto.randomUUID(), parsed.value, allowDestructiveHelpers);
        launched = true;
        activeWorkflows.current.set(latest.id, execution.id);
        setWorkflowExecutions((current) => ({ ...current, [latest.id]: execution }));
        const controller = new AbortController(); workflowControllers.current.set(latest.id, controller);
        const scope = workspaceGeneration.current;
        void observeWorkflow(latest.id, execution.id, scope, controller.signal);
      } else {
        const run = await api.startRun(projectId, connectionId, latest.id, crypto.randomUUID(), parsed.value);
        launched = true;
        activeRuns.current.set(latest.id, run.id);
        setSelectedRuns((current) => ({ ...current, [latest.id]: run.id }));
        schedule(latest.id, { lastRunId: run.id });
      }
      setView("debug");
    } catch (error) { setMessage(error instanceof Error ? error.message : t("workspace.errors.startRun")); }
    finally { starts.current.delete(active.id); if (markedStarting && !launched) setStartingIds((current) => { const next = new Set(current); next.delete(active.id); return next; }); }
  }

  async function observeWorkflow(tabId: string, executionId: string, scope: number, signal: AbortSignal): Promise<void> {
    try {
      while (!signal.aborted && workspaceGeneration.current === scope && activeWorkflows.current.get(tabId) === executionId) {
        const execution = await api.getWorkflowExecution(projectId, executionId, signal);
        if (execution.tabId !== tabId) throw new Error(t("workspace.errors.workflowTabMismatch"));
        setWorkflowExecutions((current) => ({ ...current, [tabId]: execution }));
        const mainRunId = execution.runs.find(({ phase }) => phase === "main")?.runId;
        if (mainRunId !== undefined && activeRuns.current.get(tabId) !== mainRunId) {
          activeRuns.current.set(tabId, mainRunId);
          setSelectedRuns((current) => ({ ...current, [tabId]: mainRunId }));
          schedule(tabId, { lastRunId: mainRunId });
        }
        if (["succeeded", "failed", "cancelled", "interrupted"].includes(execution.status)) {
          activeWorkflows.current.delete(tabId); workflowControllers.current.delete(tabId);
          // A terminal workflow may already own a terminal main Run whose detail
          // request is still in flight. Keep its observer mounted until that Run
          // becomes authoritative; otherwise the result pane waits forever.
          if (!activeRuns.current.has(tabId)) {
            setStartingIds((current) => { const next = new Set(current); next.delete(tabId); return next; });
          }
          return;
        }
        await new Promise<void>((resolve, reject) => {
          const aborted = () => { window.clearTimeout(timer); reject(new DOMException("Aborted", "AbortError")); };
          const timer = window.setTimeout(() => { signal.removeEventListener("abort", aborted); resolve(); }, 350);
          signal.addEventListener("abort", aborted, { once: true });
        });
      }
    } catch (error) {
      if (signal.aborted || workspaceGeneration.current !== scope) return;
      activeWorkflows.current.delete(tabId); workflowControllers.current.delete(tabId);
      setStartingIds((current) => { const next = new Set(current); next.delete(tabId); return next; });
      setMessage(error instanceof Error ? error.message : t("workspace.errors.observeWorkflow"));
    }
  }

  const detail = active !== null && boundDetail?.tabId === active.id && boundDetail.connectionId === active.connectionId &&
    boundDetail.toolName === active.toolName ? boundDetail.value : null;
  const activeWorkflowExecution = active === null ? null : workflowExecutions[active.id] ?? null;
  const activeWorkflowEnabled = active !== null && boundWorkflow?.tabId === active.id &&
    (boundWorkflow.value.before.enabled || boundWorkflow.value.after.enabled);
  const resultWorkflowExecution = activeWorkflowEnabled ? activeWorkflowExecution : undefined;
  const noEditableParameters = active !== null && detail !== null && active.inputMode === "form" &&
    !schemaHasEditableArguments(detail.tool.currentSnapshot.definition.inputSchema, active.arguments);
  const parametersExpanded = active?.viewState.requestExpanded ?? true;
  const responseExpanded = active?.viewState.responseExpanded ?? true;

  useLayoutEffect(() => {
    if (view !== "debug" || detail === null) return;
    const tabId = activeRef.current;
    const tab = tabId === null ? undefined : tabsRef.current.find(({ id }) => id === tabId);
    if (tab === undefined) return;
    if (requestPaneRef.current !== null) requestPaneRef.current.scrollTop = tab.viewState.editorScrollTop;
    if (resultPaneRef.current !== null) resultPaneRef.current.scrollTop = tab.viewState.resultScrollTop;
  }, [activeId, detail, view]);

  function updateSplitRatio(ratio: number, expandBoth = false): void {
    if (active === null) return;
    schedule(active.id, { viewState: { ...active.viewState, splitRatio: Math.round(ratio * 1000) / 1000,
      ...(expandBoth ? { requestExpanded: true, responseExpanded: true } : {}) } });
  }

  function resizeSplit(event: ReactPointerEvent<HTMLDivElement>): void {
    if (active === null) return;
    event.preventDefault();
    const split = event.currentTarget.parentElement;
    if (split === null) return;
    const bounds = split.getBoundingClientRect();
    if (bounds.height <= 0) return;
    const ratio = Math.min(0.8, Math.max(0.2, (event.clientY - bounds.top) / bounds.height));
    updateSplitRatio(ratio);
  }

  function resizeSplitByKeyboard(event: ReactKeyboardEvent<HTMLDivElement>): void {
    if (active === null || !["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const ratio = event.key === "Home" ? 0.2 : event.key === "End" ? 0.8
      : Math.min(0.8, Math.max(0.2, active.viewState.splitRatio + (event.key === "ArrowDown" ? 0.02 : -0.02)));
    updateSplitRatio(ratio);
  }

  function cancelWorkflow(execution: WorkflowExecutionDetail): void {
    void api.cancelWorkflowExecution(projectId, execution.id).catch((error: unknown) =>
      setMessage(error instanceof Error ? error.message : t("workspace.errors.cancelWorkflow")));
  }

  if (tabs === null) return <p role="status">{t("workspace.loadingTabs")}</p>;
  return <section className="debug-workspace" aria-label={t("workspace.label")}>
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
      {activeReadOnlyId === null && active !== null && <nav className="workspace-nav" aria-label={t("workspace.currentViews")}>
        {(["debug", "definition", "saved", "script", "history"] as const).map((item) => <button type="button" key={item}
          aria-current={view === item ? "page" : undefined} onClick={() => setView(item)}>
          {t(`workspace.views.${item}`)}</button>)}
      </nav>}
      {activeReadOnlyId === null && active !== null && <DebugSettingsPopover
        value={active.viewState.requestExpanded && active.viewState.responseExpanded
          ? splitPanePreset(active.viewState.splitRatio) : "custom"}
        onChange={(preset) => updateSplitRatio(splitPaneRatios[preset], true)} />}
    </div>
    {readOnlyTabs.length > 0 && <div className="history-tabs" role="tablist" aria-label={t("workspace.readOnlyTabs")} onKeyDown={(event) => {
      if (!(event.target instanceof HTMLElement) || event.target.getAttribute("role") !== "tab" ||
          !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')]; const index = buttons.indexOf(event.target as HTMLButtonElement);
      const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : event.key === "ArrowRight"
        ? (index + 1) % buttons.length : (index - 1 + buttons.length) % buttons.length;
      const target = buttons[next]; if (target !== undefined) { event.preventDefault(); target.focus(); target.click(); }
    }}>{readOnlyTabs.map((run, index) => <span key={run.id}>
      <button id={`history-tab-${run.id}`} aria-controls={`history-panel-${run.id}`} type="button" role="tab"
        tabIndex={activeReadOnlyId === run.id || (activeReadOnlyId === null && index === 0) ? 0 : -1}
        aria-selected={activeReadOnlyId === run.id} onClick={() => { activeRef.current = null; setActiveId(null); setActiveReadOnlyId(run.id); setView("debug"); }}>{t("workspace.readOnlyTab", { toolName: run.toolName, runId: run.id.slice(0, 8) })}</button>
      <button type="button" aria-label={t("workspace.closeReadOnly", { runId: run.id })} onClick={() => closeReadOnly(run.id)}><X size={15} aria-hidden="true" /></button></span>)}</div>}
    {activeReadOnlyId !== null ? <section id={`history-panel-${activeReadOnlyId}`} role="tabpanel" aria-labelledby={`history-tab-${activeReadOnlyId}`} className="read-only-run"><p role="status">{t("workspace.readOnlyNotice")}</p>
        {observed.error !== null && <p role="alert">{observed.error}</p>}{observed.run === null ? <p role="status">{t("workspace.loadingRun")}</p> : <RunResultPanel run={observed.run} />}</section>
      : active === null ? <div className="workspace-empty"><h2>{t("workspace.emptyTitle")}</h2><p>{t("workspace.emptyHint")}</p></div> : <div className="workspace-tab-panel" id={`tabpanel-${active.id}`} role="tabpanel" aria-labelledby={`tab-${active.id}`}>
      {view === "debug" && detail === null && <p role="status">{t("workspace.loadingTool")}</p>}
      {view === "debug" && detail !== null && <div className={`request-result-split${selectedRunId === null ? " request-result-split--empty" : ""}${noEditableParameters ? " request-result-split--no-parameters" : ""}`}
        style={{ gridTemplateRows: !responseExpanded
          ? "minmax(0, 1fr) 10px auto"
          : noEditableParameters || !parametersExpanded
            ? "auto 10px minmax(0, 1fr)" : `${active.viewState.splitRatio * 100}% 10px 1fr` }}>
        <div className="request-pane" ref={requestPaneRef}
          onScroll={(event) => schedule(active.id, { viewState: { ...active.viewState, editorScrollTop: event.currentTarget.scrollTop } })}>
          <ParameterEditor tab={active} schema={detail.tool.currentSnapshot.definition.inputSchema} executing={startingIds.has(active.id)}
            workflowEnabled={boundWorkflow?.tabId === active.id && (boundWorkflow.value.before.enabled || boundWorkflow.value.after.enabled)}
            deferRequiredValidation={boundWorkflow?.tabId === active.id && boundWorkflow.value.before.enabled}
            expanded={parametersExpanded} onExpandedChange={(expanded) => schedule(active.id, {
              viewState: { ...active.viewState, requestExpanded: expanded },
            })}
            subtreeDrafts={subtreeDrafts[active.id]}
            onSubtreeDraftChange={(path, text, base) => setSubtreeDrafts((current) => ({ ...current,
              [active.id]: { ...(current[active.id] ?? {}), [path]: { text, base } } }))}
            onChange={(patch) => schedule(active.id, patch)} onExecute={() => void execute()}
            onSaveRequest={(payload) => setSaveIntent({ tabId: active.id, connectionId: active.connectionId,
              toolName: active.toolName, kind: "request", payload, sourceRunId: null })}
            savingTestCase={savingTestCaseIds.has(active.id)}
            onSaveAsTestCase={(payload) => void saveAsTestCase(active, payload)} />
        </div>
        <div className="split-control" role="separator" aria-orientation="horizontal"
          aria-label={t("workspace.requestHeight")} aria-valuemin={20} aria-valuemax={80}
          aria-valuenow={Math.round(active.viewState.splitRatio * 100)} tabIndex={0}
          onKeyDown={resizeSplitByKeyboard}
          onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); resizeSplit(event); }}
          onPointerMove={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) resizeSplit(event); }}>
          <span className="sr-only">{t("workspace.requestHeight")}</span>
        </div>
        <div className={`result-placeholder${responseExpanded ? "" : " result-placeholder--collapsed"}`} ref={resultPaneRef}
          onScroll={(event) => schedule(active.id, { viewState: { ...active.viewState, resultScrollTop: event.currentTarget.scrollTop } })}>
          {observed.error !== null && <p role="alert">{observed.error}</p>}
          {selectedRunId === null ? <EmptyRunResultPanel expanded={responseExpanded}
              workflowExecution={resultWorkflowExecution} onCancelWorkflow={cancelWorkflow}
              onExpandedChange={(expanded) => schedule(active.id, {
                viewState: { ...active.viewState, responseExpanded: expanded },
              })} />
            : observed.run === null ? resultWorkflowExecution !== undefined
              ? <EmptyRunResultPanel expanded={responseExpanded} workflowExecution={resultWorkflowExecution}
                  onCancelWorkflow={cancelWorkflow}
                  onExpandedChange={(expanded) => schedule(active.id, {
                    viewState: { ...active.viewState, responseExpanded: expanded },
                  })} />
              : <p role="status">{t("workspace.loadingRun")}</p> : <RunResultPanel run={observed.run}
              workflowExecution={resultWorkflowExecution} onCancelWorkflow={cancelWorkflow}
              expanded={responseExpanded}
              onExpandedChange={(expanded) => schedule(active.id, {
                viewState: { ...active.viewState, responseExpanded: expanded },
              })}
              onSaveResponse={(payload) => setSaveIntent({ tabId: active.id, connectionId: active.connectionId,
                toolName: active.toolName, kind: "response", payload, sourceRunId: observed.run!.id })} />}</div>
      </div>}
      {view === "definition" && detail !== null && <Suspense fallback={<p role="status">{t("view.loadingDefinition")}</p>}>
        <ToolDefinitionView detail={detail} />
      </Suspense>}
      {view === "script" && <Suspense fallback={<p role="status">{t("view.loadingScript")}</p>}>
        <ScriptWorkflowView api={api} projectId={projectId} connectionId={active.connectionId}
          toolName={active.toolName} argumentsValue={active.arguments}
          onApplyArguments={(argumentsValue) => schedule(active.id, { arguments: argumentsValue, rawText: formatRawArguments(argumentsValue) })}
          onWorkflowChange={(value) => setBoundWorkflow({ tabId: active.id,
            connectionId: active.connectionId, toolName: active.toolName, value })} />
      </Suspense>}
      {view === "saved" && <SavedItemsView api={api} projectId={projectId} connectionId={active.connectionId} toolName={active.toolName}
        refreshKey={savedRevision} onCreateTest={onCreateTestFromSaved}
        onLoadRequest={(payload) => { schedule(active.id, { arguments: payload, rawText: formatRawArguments(payload) }); setView("debug"); }} />}
      {view === "history" && <div className="tool-history-workspace">
        <RunHistory api={api} projectId={projectId} tabId={active.id} connectionId={active.connectionId}
          toolName={active.toolName} hideHeading selectedId={historyDetail?.id} refreshKey={historyRefreshKey}
          actionsDisabled={historyMutating} onOpen={(run) => void inspectHistory(run)}
          onDelete={deleteHistory} onClear={() => clearHistory(active)} />
        <section className="tool-history-detail" aria-label={t("workspace.history.detail")}>
          {historyDetailState === "loading" ? <p role="status">{t("workspace.loadingRun")}</p>
            : historyDetailState === "error" ? <p role="alert">{t("workspace.errors.loadHistory")}</p>
              : historyDetail === null ? <div className="tool-history-detail__empty"><strong>{t("workspace.history.selectTitle")}</strong>
                <p>{t("workspace.history.selectDescription")}</p></div>
                : <><header className="tool-history-detail__actions"><Button variant="primary"
                  onClick={() => void loadHistory(historyDetail)}>{t("workspace.history.load")}</Button></header>
                  <RunResultPanel run={historyDetail} /></>}
        </section>
      </div>}
    </div>}
    {saveIntent !== null && <SavedItemDialog api={api} projectId={projectId} connectionId={saveIntent.connectionId}
      toolName={saveIntent.toolName} kind={saveIntent.kind} payload={saveIntent.payload} sourceRunId={saveIntent.sourceRunId}
      onClose={() => setSaveIntent(null)} onSaved={() => { const saved = saveIntent; setSaveIntent(null); setSavedRevision((value) => value + 1);
        toast.success(t("workspace.saveSuccess", { kind: t(saved.kind === "request" ? "workspace.request" : "workspace.response") })); }} />}
    <span className="sr-only" role="status" aria-live="polite">{queues.current.size > 0 ? t("workspace.savingTab") : pending.current.size > 0 ? t("workspace.tabPending") : t("workspace.tabSaved")}</span>
  </section>;
}
