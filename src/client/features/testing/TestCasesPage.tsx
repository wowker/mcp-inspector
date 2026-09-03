import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { InspectorApiError, type CatalogToolSummary, type ConnectionSummary, type InspectorApiClient,
  type RunDetail, type SavedItemDetail } from "../../api/api-client.js";
import type { TestCaseSummary } from "../../../shared/testing/test-case.js";
import type { TestExecutionDetail } from "../../../shared/testing/test-execution.js";
import { jsonValueSchema, type JsonObject } from "../../../shared/tool-definition.js";
import { Button } from "../../components/actions/Button.js";
import { Disclosure } from "../../components/layout/Disclosure.js";
import { Dialog } from "../../components/overlays/Dialog.js";
import { ModuleHelpPopover } from "../../components/overlays/ModuleHelpPopover.js";
import { TestCaseList } from "./TestCaseList.js";
import { ToolTestCaseEditor } from "./ToolTestCaseEditor.js";
import { TestExecutionPanel } from "./TestExecutionPanel.js";
import { TestExecutionWorkspace } from "./TestExecutionWorkspace.js";
import { draftFromDefinition, draftFromPreview, mutationFromDraft, newToolTestCaseDraft, type ToolTestCaseDraft } from "./test-case-draft.js";
import { ScenarioTestCaseEditor } from "./ScenarioTestCaseEditor.js";
import { draftFromScenarioDefinition, newScenarioTestCaseDraft, scenarioMutationFromDraft,
  type ScenarioTestCaseDraft } from "./scenario-test-case-draft.js";
import "./testing.css";

export interface TestCaseSourceIntent {
  sequence: number;
  source: { kind: "run"; run: RunDetail } | { kind: "saved-item"; item: SavedItemDetail };
}

interface Props { api: InspectorApiClient; projectId: string; sourceIntent?: TestCaseSourceIntent | null }

export function TestCasesPage({ api, projectId, sourceIntent = null }: Props) {
  const { t } = useTranslation("testing");
  const listVersion = useRef(0);
  const detailVersion = useRef(0);
  const toolVersion = useRef(0);
  const [refreshKey, setRefreshKey] = useState(0);
  const [items, setItems] = useState<TestCaseSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [connections, setConnections] = useState<ConnectionSummary[]>([]);
  const [draft, setDraft] = useState<ToolTestCaseDraft | null>(null);
  const [scenarioDraft, setScenarioDraft] = useState<ScenarioTestCaseDraft | null>(null);
  const [tools, setTools] = useState<CatalogToolSummary[]>([]);
  const [selectedTool, setSelectedTool] = useState<CatalogToolSummary | null>(null);
  const [loadingTools, setLoadingTools] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [destructiveOpen, setDestructiveOpen] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [execution, setExecution] = useState<TestExecutionDetail | null>(null);
  const [executionRuns, setExecutionRuns] = useState<Record<string, RunDetail>>({});
  const [responseState, setResponseState] = useState<"loading" | "ready" | "error">("ready");
  const [scenarioInputTexts, setScenarioInputTexts] = useState<Record<string, string>>({});
  const [resultExpanded, setResultExpanded] = useState(false);
  const [historyExpanded, setHistoryExpanded] = useState(false);
  const executionVersion = useRef(0);

  function saveFailure(error: unknown): string {
    if (error instanceof InspectorApiError) {
      if (error.code === "TEST_CASE_REVISION_CONFLICT") return t("editor.saveFailedRevision");
      if (error.code === "TEST_CASE_INVALID") return t("editor.saveFailedInvalid");
      if (error.code === "TEST_TARGET_NOT_AVAILABLE") return t("editor.saveFailedTarget");
    }
    return t("editor.saveFailedUnknown");
  }

  const loadList = useCallback(() => {
    const version = ++listVersion.current;
    setLoading(true); setListError(null);
    void Promise.all([api.listTestCases(projectId, { limit: 100 }), api.listConnections(projectId)])
      .then(([page, loadedConnections]) => {
        if (version !== listVersion.current) return;
        setItems(page.items); setConnections(loadedConnections); setLoading(false);
      }).catch((error: unknown) => {
        if (version !== listVersion.current) return;
        setListError(t("list.loadFailed")); setLoading(false);
      });
  }, [api, projectId, t]);

  useEffect(() => {
    setDraft(null); setScenarioDraft(null); setItems([]); setConnections([]); setTools([]); setSelectedTool(null); setExecution(null);
    setExecutionRuns({}); setResponseState("ready");
    setScenarioInputTexts({}); setDirty(false); setResultExpanded(false); setHistoryExpanded(false);
    loadList();
    return () => { listVersion.current += 1; detailVersion.current += 1; toolVersion.current += 1; executionVersion.current += 1; };
  }, [loadList, refreshKey]);

  useEffect(() => {
    if (sourceIntent === null) return;
    const version = ++detailVersion.current;
    const source = sourceIntent.source;
    if (source.kind === "run" && source.run.projectId !== projectId) return;
    if (source.kind === "saved-item" && source.item.projectId !== projectId) return;
    const preview = source.kind === "run"
      ? api.previewTestCaseFromRun(projectId, source.run.id)
      : api.previewTestCaseFromSavedItem(projectId, source.item.id);
    void preview.then((value) => { if (version === detailVersion.current) { setScenarioDraft(null); setDraft(draftFromPreview(value)); } })
      .catch(() => { if (version === detailVersion.current) toast.error(t("list.loadFailed")); });
  }, [api, projectId, sourceIntent?.sequence]);

  useEffect(() => {
    const connectionId = draft?.connectionId ?? "";
    if (connectionId === "") { setTools([]); setSelectedTool(null); return; }
    const version = ++toolVersion.current;
    setLoadingTools(true);
    void api.listTools(projectId, connectionId).then((loadedTools) => {
      if (version !== toolVersion.current) return;
      setTools(loadedTools);
      const toolName = draft?.toolName ?? "";
      setSelectedTool(loadedTools.find(({ name }) => name === toolName) ?? null);
      setLoadingTools(false);
    }).catch((error: unknown) => {
      if (version !== toolVersion.current) return;
      setTools([]); setSelectedTool(null); setLoadingTools(false);
      toast.error(t("list.loadFailed"));
    });
    return () => { toolVersion.current += 1; };
  }, [api, draft?.connectionId, draft?.toolName, projectId, t]);

  const filteredItems = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return needle === "" ? items : items.filter((item) => `${item.name} ${item.description} ${item.tags.join(" ")}`.toLocaleLowerCase().includes(needle));
  }, [items, query]);

  async function select(id: string): Promise<void> {
    const version = ++detailVersion.current;
    setLoading(true);
    try {
      const definition = await api.getTestCase(projectId, id);
      if (version !== detailVersion.current) return;
      if (definition.kind === "tool") { setScenarioDraft(null); setDraft(draftFromDefinition(definition)); }
      else {
        setDraft(null); setScenarioDraft(draftFromScenarioDefinition(definition));
        setScenarioInputTexts(Object.fromEntries(definition.inputs.map((input) => [
          input.name, input.defaultValue === undefined ? "" : JSON.stringify(input.defaultValue),
        ])));
      }
      setDirty(false); setExecution(null); setExecutionRuns({}); setResponseState("ready"); setResultExpanded(false); setHistoryExpanded(false); executionVersion.current += 1; setLoading(false);
    } catch (error) {
      if (version !== detailVersion.current) return;
      setLoading(false); toast.error(t("list.loadFailed"));
    }
  }

  function changeConnection(connectionId: string): void {
    if (draft === null) return;
    setDraft({ ...draft, connectionId, toolName: "", arguments: {}, rawText: "", inputMode: "form" });
    setDirty(true);
    setSelectedTool(null); setTools([]);
  }

  function changeTool(toolName: string): void {
    if (draft === null) return;
    const tool = tools.find(({ name }) => name === toolName) ?? null;
    setSelectedTool(tool);
    setDraft({ ...draft, toolName, arguments: {}, rawText: "", inputMode: "form" });
    setDirty(true);
  }

  async function save(): Promise<void> {
    if (draft === null && scenarioDraft === null) return;
    if (scenarioDraft !== null) { await saveScenario(); return; }
    if (draft === null) return;
    const parsed = mutationFromDraft(draft);
    if (!parsed.ok) {
      toast.error(t(parsed.reason === "required" ? "editor.required" : parsed.reason === "timeout" ? "editor.invalidTimeout" : "assertion.invalidExpected"));
      return;
    }
    if (selectedTool?.status === "removed") { toast.error(t("editor.toolRemoved")); return; }
    setSaving(true);
    try {
      const saved = draft.id === null
        ? await api.createTestCase(projectId, parsed.value)
        : await api.updateTestCase(projectId, draft.id, { revision: draft.revision!, definition: parsed.value });
      if (saved.kind !== "tool" || saved.projectId !== projectId) throw new Error(t("editor.saveFailed"));
      setDraft(draftFromDefinition(saved));
      setDirty(false);
      const summary: TestCaseSummary = {
        id: saved.id, projectId: saved.projectId, kind: saved.kind, name: saved.name,
        description: saved.description, tags: saved.tags, revision: saved.revision,
        isEnabled: saved.isEnabled, targetConnectionIds: [saved.target.connectionId],
        createdAt: saved.createdAt, updatedAt: saved.updatedAt,
      };
      setItems((current) => [summary, ...current.filter(({ id }) => id !== saved.id)]);
      toast.success(t("editor.saved"));
    } catch (error) {
      toast.error(saveFailure(error));
    } finally { setSaving(false); }
  }

  async function saveScenario(): Promise<void> {
    if (scenarioDraft === null) return;
    const parsed = scenarioMutationFromDraft(scenarioDraft);
    if (!parsed.ok) { toast.error(t(parsed.reason === "required" ? "scenario.required" : "scenario.invalid")); return; }
    setSaving(true);
    try {
      const saved = scenarioDraft.id === null
        ? await api.createTestCase(projectId, parsed.value)
        : await api.updateTestCase(projectId, scenarioDraft.id, { revision: scenarioDraft.revision!, definition: parsed.value });
      if (saved.kind !== "scenario" || saved.projectId !== projectId) throw new Error(t("editor.saveFailed"));
      setScenarioDraft(draftFromScenarioDefinition(saved)); setDirty(false);
      const summary: TestCaseSummary = { id: saved.id, projectId: saved.projectId, kind: saved.kind, name: saved.name,
        description: saved.description, tags: saved.tags, revision: saved.revision, isEnabled: saved.isEnabled,
        targetConnectionIds: [...new Set([...saved.steps, ...saved.cleanupSteps].map(({ target }) => target.connectionId))],
        createdAt: saved.createdAt, updatedAt: saved.updatedAt };
      setItems((current) => [summary, ...current.filter(({ id }) => id !== saved.id)]);
      toast.success(t("editor.saved"));
    } catch (error) { toast.error(saveFailure(error)); }
    finally { setSaving(false); }
  }

  const executionActive = execution?.status === "QUEUED" || execution?.status === "RUNNING";

  async function loadExecutionResponses(detail: TestExecutionDetail, version: number): Promise<void> {
    if (version !== executionVersion.current) return;
    const runIds = [...new Set(detail.steps.flatMap(({ runId }) => runId === null ? [] : [runId]))];
    setExecutionRuns({});
    if (runIds.length === 0) { setResponseState("ready"); return; }
    setResponseState("loading");
    try {
      const runs: RunDetail[] = [];
      for (let index = 0; index < runIds.length; index += 8) {
        runs.push(...await Promise.all(runIds.slice(index, index + 8).map((runId) => api.getRun(projectId, runId))));
        if (version !== executionVersion.current) return;
      }
      if (runs.some((run, index) => run.projectId !== projectId || run.id !== runIds[index])) {
        throw new Error("Run identity mismatch");
      }
      setExecutionRuns(Object.fromEntries(runs.map((run) => [run.id, run])));
      setResponseState("ready");
    } catch {
      if (version === executionVersion.current) setResponseState("error");
    }
  }

  async function pollExecution(executionId: string, version: number): Promise<void> {
    while (version === executionVersion.current) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      if (version !== executionVersion.current) return;
      const latest = await api.getTestExecution(projectId, executionId);
      if (version !== executionVersion.current) return;
      setExecution(latest);
      if (latest.status !== "QUEUED" && latest.status !== "RUNNING") {
        await loadExecutionResponses(latest, version);
        return;
      }
    }
  }

  async function execute(confirmDestructive = false): Promise<void> {
    const selectedId = draft?.id ?? scenarioDraft?.id ?? null;
    if (selectedId === null) return;
    if (dirty) { toast.error(t("execution.saveFirst")); return; }
    let inputs: JsonObject | undefined;
    if (scenarioDraft !== null) {
      inputs = {};
      for (const input of scenarioDraft.inputs) {
        const text = scenarioInputTexts[input.name]?.trim() ?? "";
        if (text === "") {
          if (input.isRequired && input.defaultValue === undefined) { toast.error(t("execution.requiredInput", { name: input.name })); return; }
          if (input.defaultValue !== undefined) inputs[input.name] = input.defaultValue;
          continue;
        }
        try {
          const parsed = jsonValueSchema.safeParse(JSON.parse(text));
          if (!parsed.success) throw new Error("Invalid JSON value");
          inputs[input.name] = parsed.data;
        } catch { toast.error(t("execution.invalidInput", { name: input.name })); return; }
      }
    }
    const version = ++executionVersion.current;
    setExecutionRuns({}); setResponseState("ready");
    try {
      const started = await api.startTestExecution(projectId, selectedId, crypto.randomUUID(), {
        ...(confirmDestructive ? { confirmDestructive: true } : {}), ...(inputs === undefined ? {} : { inputs }),
      });
      if (version !== executionVersion.current) return;
      setDestructiveOpen(false); setResultExpanded(true); setExecution(started);
      if (started.status === "QUEUED" || started.status === "RUNNING") {
        setResponseState("loading");
        await pollExecution(started.id, version);
      }
      else await loadExecutionResponses(started, version);
    } catch (error) {
      if (version !== executionVersion.current) return;
      if (!confirmDestructive && error instanceof Error && error.message === "Destructive Tool confirmation is required") {
        setDestructiveOpen(true);
        return;
      }
      toast.error(error instanceof Error ? error.message : t("execution.failed"));
    }
  }

  async function cancelExecution(): Promise<void> {
    if (execution === null || !executionActive) return;
    const version = ++executionVersion.current;
    try {
      await api.cancelTestExecution(projectId, execution.id);
      const latest = await api.getTestExecution(projectId, execution.id);
      if (version === executionVersion.current) {
        setExecution(latest);
        await loadExecutionResponses(latest, version);
      }
    } catch { if (version === executionVersion.current) toast.error(t("execution.cancelFailed")); }
  }

  function createToolTest(): void {
    setScenarioDraft(null); setDraft(newToolTestCaseDraft()); setDirty(true); setExecution(null); setExecutionRuns({}); setResponseState("ready"); setResultExpanded(false); setHistoryExpanded(false); executionVersion.current += 1;
  }

  function createScenarioTest(): void {
    setDraft(null); setScenarioDraft(newScenarioTestCaseDraft()); setDirty(true); setExecution(null); setExecutionRuns({}); setResponseState("ready"); setResultExpanded(false); setHistoryExpanded(false); executionVersion.current += 1;
  }

  async function remove(): Promise<void> {
    const selectedDraft = scenarioDraft ?? draft;
    if (selectedDraft?.id === null || selectedDraft === null) return;
    setSaving(true);
    try {
      await api.deleteTestCase(projectId, selectedDraft.id);
      setItems((current) => current.filter(({ id }) => id !== selectedDraft.id));
      setDraft(null); setScenarioDraft(null); setDeleteOpen(false); toast.success(t("editor.deleted"));
    } catch { toast.error(t("editor.deleteFailed")); }
    finally { setSaving(false); }
  }

  return <section className="testing-page" aria-labelledby="testing-page-title">
    <header className="page-heading testing-page__heading testing-page__heading--compact"><div><div className="module-heading-title"><h1 id="testing-page-title">{t("title")}</h1>
      <ModuleHelpPopover moduleName={t("title")} triggerLabel={t("help.testing.trigger")} closeLabel={t("help.testing.close")}
        summary={t("help.testing.summary")} description={t("description")} sections={(["purpose", "configure", "use", "effect"] as const).map((section) => ({
          id: section, title: t(`help.sections.${section}`), items: [t(`help.testing.${section}.one`), t(`help.testing.${section}.two`)],
        }))} /></div><p>{t("description")}</p></div></header>
    <div className="testing-workspace">
      <TestCaseList items={filteredItems} selectedId={scenarioDraft?.id ?? draft?.id ?? null} loading={loading} error={listError} query={query}
        onQueryChange={setQuery} onSelect={(id) => void select(id)} onRetry={() => setRefreshKey((current) => current + 1)}
        onCreateTool={createToolTest} onCreateScenario={createScenarioTest} />
      <div className="testing-editor-shell">
        {draft === null && scenarioDraft === null ? <div className="testing-editor-placeholder" role="status"><p>{t("editor.selectCaseHint")}</p></div>
          : draft !== null ? <ToolTestCaseEditor projectId={projectId} draft={draft} connections={connections} tools={tools} tool={selectedTool}
            loadingTools={loadingTools} saving={saving} onChange={(next) => { setDraft(next); setDirty(true); }} onConnectionChange={changeConnection} onToolChange={changeTool}
            onSave={() => void save()} onCancel={() => { setDraft(null); setExecution(null); setExecutionRuns({}); setResponseState("ready"); executionVersion.current += 1; }} onDelete={draft.id === null ? undefined : () => setDeleteOpen(true)}
            canExecute={!dirty && draft.isEnabled && selectedTool?.status !== "removed"} executing={executionActive}
            onExecute={() => selectedTool?.currentSnapshot.definition.annotations?.destructiveHint === true ? setDestructiveOpen(true) : void execute()}
            onCancelExecution={() => void cancelExecution()} />
            : <ScenarioTestCaseEditor api={api} projectId={projectId} draft={scenarioDraft!} connections={connections} saving={saving}
              onChange={(next) => { setScenarioDraft(next); setDirty(true); }} onSave={() => void save()}
              onCancel={() => setScenarioDraft(null)} onDelete={scenarioDraft!.id === null ? undefined : () => setDeleteOpen(true)}
              executionInputs={scenarioInputTexts} onExecutionInputChange={(name, value) => setScenarioInputTexts((current) => ({ ...current, [name]: value }))}
              canExecute={!dirty && scenarioDraft!.isEnabled && scenarioDraft!.id !== null} executing={executionActive}
              onExecute={() => void execute()} onCancelExecution={() => void cancelExecution()}
              onOpenHistory={() => setHistoryExpanded(true)} />}
        {scenarioDraft !== null && scenarioDraft.id !== null
          ? <TestExecutionWorkspace api={api} projectId={projectId} testCaseId={scenarioDraft.id}
            latestExecution={execution} latestRuns={executionRuns} latestResponseState={responseState}
            resultExpanded={resultExpanded} onResultExpandedChange={setResultExpanded}
            historyExpanded={historyExpanded} onHistoryExpandedChange={setHistoryExpanded} />
          : draft !== null
            ? execution === null
              ? <Disclosure label={t("execution.result")} expanded={resultExpanded} onExpandedChange={setResultExpanded}
                className="testing-execution testing-execution-disclosure testing-execution--flush"
                contentClassName="testing-execution__content">
                <div className="testing-execution__empty"><p>{t("execution.noLatestResult")}</p></div>
              </Disclosure>
              : <TestExecutionPanel execution={execution} responseRuns={executionRuns} responseState={responseState}
                expanded={resultExpanded} onExpandedChange={setResultExpanded} flush />
            : null}
      </div>
    </div>
    {deleteOpen && <Dialog titleId="testing-delete-title" descriptionId="testing-delete-description" onClose={() => setDeleteOpen(false)} closeDisabled={saving}>
      <div className="testing-delete-dialog"><h2 id="testing-delete-title">{t("editor.deleteTitle")}</h2><p id="testing-delete-description">{t("editor.deleteDescription")}</p>
        <div><Button variant="secondary" onClick={() => setDeleteOpen(false)}>{t("editor.cancel")}</Button>
          <Button variant="danger" loading={saving} onClick={() => void remove()}>{t("editor.deleteConfirm")}</Button></div></div>
    </Dialog>}
    {destructiveOpen && <Dialog titleId="testing-destructive-title" descriptionId="testing-destructive-description" onClose={() => setDestructiveOpen(false)}>
      <div className="testing-delete-dialog"><h2 id="testing-destructive-title">{t("execution.destructiveTitle")}</h2>
        <p id="testing-destructive-description">{t("execution.destructiveDescription")}</p><div>
          <Button variant="secondary" onClick={() => setDestructiveOpen(false)}>{t("editor.cancel")}</Button>
          <Button variant="danger" onClick={() => void execute(true)}>{t("execution.confirmRun")}</Button>
        </div></div>
    </Dialog>}
  </section>;
}
