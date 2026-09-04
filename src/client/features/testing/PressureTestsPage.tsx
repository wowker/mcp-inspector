import { Play, Plus, Stop, Trash } from "@phosphor-icons/react";
import { useCallback, useEffect, useRef, useState, type ChangeEvent } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import type { InspectorApiClient } from "../../api/api-client.js";
import { pressureTestMutationSchema, type PressureTestDefinition, type PressureTestExecution,
  type PressureTestSample } from "../../../shared/testing/pressure-test.js";
import type { TestCaseSummary } from "../../../shared/testing/test-case.js";
import { Button } from "../../components/actions/Button.js";
import { Select } from "../../components/forms/Select.js";
import { Dialog } from "../../components/overlays/Dialog.js";
import { ModuleHelpPopover } from "../../components/overlays/ModuleHelpPopover.js";
import { PressureExecutionViewer } from "./PressureExecutionViewer.js";
import "./testing.css";

interface Props { api: InspectorApiClient; projectId: string; active?: boolean }
interface Draft {
  id: string | null;
  revision: number | null;
  name: string;
  description: string;
  testCaseId: string;
  inputs: string;
  virtualUsers: number;
  rampUpMs: number;
  durationMs: number;
  thinkTimeMs: number;
  maxIterations: number;
  maxErrorRatePercent: number;
  maxP95DurationMs: number;
  minRequestsPerSecond: number;
  stopOnErrorRate: boolean;
}

const emptyDraft = (): Draft => ({ id: null, revision: null, name: "", description: "", testCaseId: "", inputs: "{}",
  virtualUsers: 1, rampUpMs: 0, durationMs: 30_000, thinkTimeMs: 0, maxIterations: 100,
  maxErrorRatePercent: 1, maxP95DurationMs: 1_000, minRequestsPerSecond: 1, stopOnErrorRate: true });
const terminal = new Set(["PASSED", "FAILED", "ERROR", "CANCELLED", "INTERRUPTED"]);

function draftOf(value: PressureTestDefinition): Draft {
  return { id: value.id, revision: value.revision, name: value.name, description: value.description,
    testCaseId: value.target.testCaseId, inputs: JSON.stringify(value.inputs, null, 2),
    virtualUsers: value.load.virtualUsers, rampUpMs: value.load.rampUpMs, durationMs: value.load.durationMs,
    thinkTimeMs: value.load.thinkTimeMs, maxIterations: value.load.maxIterations,
    maxErrorRatePercent: value.thresholds.maxErrorRate * 100,
    maxP95DurationMs: value.thresholds.maxP95DurationMs,
    minRequestsPerSecond: value.thresholds.minRequestsPerSecond,
    stopOnErrorRate: value.thresholds.stopOnErrorRate };
}

async function allCases(api: InspectorApiClient, projectId: string): Promise<TestCaseSummary[]> {
  const items: TestCaseSummary[] = [];
  let cursor: string | undefined;
  const seen = new Set<string>();
  do {
    const page = await api.listTestCases(projectId, { limit: 100, ...(cursor === undefined ? {} : { cursor }) });
    items.push(...page.items.filter(({ isEnabled }) => isEnabled));
    cursor = page.nextCursor ?? undefined;
    if (cursor !== undefined && (seen.has(cursor) || items.length > 1_000)) throw new Error("Invalid test case pagination");
    if (cursor !== undefined) seen.add(cursor);
  } while (cursor !== undefined);
  return items;
}

async function allExecutionSamples(api: InspectorApiClient, projectId: string,
  executionId: string): Promise<PressureTestSample[]> {
  const items: PressureTestSample[] = [];
  let cursor: string | undefined;
  const seen = new Set<string>();
  do {
    const page = await api.listPressureTestSamples(projectId, executionId, { limit: 100,
      ...(cursor === undefined ? {} : { cursor }) });
    items.push(...page.items); cursor = page.nextCursor ?? undefined;
    if (cursor !== undefined && (seen.has(cursor) || items.length > 1_000)) throw new Error("Invalid sample pagination");
    if (cursor !== undefined) seen.add(cursor);
  } while (cursor !== undefined);
  return items;
}

function numeric(value: string, minimum: number, maximum: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : minimum;
}

export function PressureTestsPage({ api, projectId, active = true }: Props) {
  const { t } = useTranslation("testing");
  const loadVersion = useRef(0);
  const executionVersion = useRef(0);
  const wasActive = useRef(active);
  const [items, setItems] = useState<PressureTestDefinition[]>([]);
  const [cases, setCases] = useState<TestCaseSummary[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [execution, setExecution] = useState<PressureTestExecution | null>(null);
  const [samples, setSamples] = useState<PressureTestSample[]>([]);
  const [saving, setSaving] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [destructiveOpen, setDestructiveOpen] = useState(false);

  const reload = useCallback(() => {
    const version = ++loadVersion.current;
    void Promise.all([api.listPressureTests(projectId, { limit: 100 }), allCases(api, projectId)])
      .then(([page, testCases]) => { if (loadVersion.current === version) { setItems(page.items); setCases(testCases); } })
      .catch(() => { if (loadVersion.current === version) toast.error(t("pressure.loadFailed")); });
  }, [api, projectId, t]);

  useEffect(() => {
    setDraft(null); setExecution(null); setSamples([]); setDeleteOpen(false); setDestructiveOpen(false);
    executionVersion.current += 1; reload();
    return () => { loadVersion.current += 1; executionVersion.current += 1; };
  }, [projectId]);
  useEffect(() => {
    if (active && !wasActive.current) reload();
    wasActive.current = active;
  }, [active, reload]);

  async function select(id: string): Promise<void> {
    try {
      const value = await api.getPressureTest(projectId, id);
      setDraft(draftOf(value)); setExecution(null); setSamples([]); executionVersion.current += 1;
    } catch { toast.error(t("pressure.loadFailed")); }
  }

  function mutation() {
    if (draft === null) return null;
    let inputs: unknown;
    try { inputs = JSON.parse(draft.inputs); } catch { toast.error(t("pressure.invalidInputs")); return null; }
    const parsed = pressureTestMutationSchema.safeParse({ name: draft.name.trim(), description: draft.description,
      target: { testCaseId: draft.testCaseId }, inputs,
      load: { virtualUsers: Math.trunc(draft.virtualUsers), rampUpMs: Math.trunc(draft.rampUpMs),
        durationMs: Math.trunc(draft.durationMs), thinkTimeMs: Math.trunc(draft.thinkTimeMs),
        maxIterations: Math.trunc(draft.maxIterations) },
      thresholds: { maxErrorRate: draft.maxErrorRatePercent / 100,
        maxP95DurationMs: Math.trunc(draft.maxP95DurationMs),
        minRequestsPerSecond: draft.minRequestsPerSecond, stopOnErrorRate: draft.stopOnErrorRate } });
    if (!parsed.success) { toast.error(t("pressure.invalid")); return null; }
    return parsed.data;
  }

  async function save(): Promise<void> {
    const definition = mutation();
    if (draft === null || definition === null) return;
    setSaving(true);
    try {
      const saved = draft.id === null ? await api.createPressureTest(projectId, definition)
        : await api.updatePressureTest(projectId, draft.id, { revision: draft.revision!, definition });
      setDraft(draftOf(saved)); reload(); toast.success(t("pressure.saved"));
    } catch { toast.error(t("pressure.saveFailed")); }
    finally { setSaving(false); }
  }

  async function run(confirmDestructive = false): Promise<void> {
    if (draft?.id === null || draft === null) return;
    const version = ++executionVersion.current;
    try {
      let value = await api.startPressureTestExecution(projectId, draft.id, crypto.randomUUID(),
        confirmDestructive ? { confirmDestructive: true } : undefined);
      if (executionVersion.current !== version) return;
      setDestructiveOpen(false); setExecution(value); setSamples([]);
      while (!terminal.has(value.status)) {
        await new Promise((resolve) => setTimeout(resolve, 400));
        if (executionVersion.current !== version) return;
        const [latest, page] = await Promise.all([
          api.getPressureTestExecution(projectId, value.id),
          api.listPressureTestSamples(projectId, value.id, { limit: 100 }),
        ]);
        if (executionVersion.current !== version) return;
        value = latest; setExecution(latest); setSamples(page.items);
      }
      const completedSamples = await allExecutionSamples(api, projectId, value.id);
      if (executionVersion.current === version) setSamples(completedSamples);
    } catch (error) {
      if (executionVersion.current !== version) return;
      if (!confirmDestructive && error instanceof Error && error.message === "Destructive Tool confirmation is required") {
        setDestructiveOpen(true); return;
      }
      toast.error(error instanceof Error ? error.message : t("pressure.runFailed"));
    }
  }

  async function cancel(): Promise<void> {
    if (execution === null) return;
    const version = ++executionVersion.current;
    try {
      await api.cancelPressureTestExecution(projectId, execution.id);
      const value = await api.getPressureTestExecution(projectId, execution.id);
      if (executionVersion.current === version) setExecution(value);
    } catch { toast.error(t("pressure.cancelFailed")); }
  }

  async function remove(): Promise<void> {
    if (draft?.id === null || draft === null) return;
    setSaving(true);
    try {
      await api.deletePressureTest(projectId, draft.id);
      setItems((current) => current.filter(({ id }) => id !== draft.id));
      setDraft(null); setExecution(null); setSamples([]); setDeleteOpen(false);
      toast.success(t("pressure.deleted"));
    } catch { toast.error(t("pressure.deleteFailed")); }
    finally { setSaving(false); }
  }

  const setNumber = (field: keyof Draft, minimum: number, maximum: number) =>
    (event: ChangeEvent<HTMLInputElement>) => draft !== null && setDraft({ ...draft,
      [field]: numeric(event.target.value, minimum, maximum) });

  return <section className="testing-page pressure-page" aria-labelledby="pressure-page-title">
    <header className="page-heading testing-page__heading testing-page__heading--compact"><div>
      <div className="module-heading-title"><h1 id="pressure-page-title">{t("pressure.title")}</h1>
        <ModuleHelpPopover moduleName={t("pressure.title")} triggerLabel={t("help.pressure.trigger")} closeLabel={t("help.pressure.close")}
          summary={t("help.pressure.summary")} description={t("pressure.description")} sections={( ["purpose", "configure", "use", "effect"] as const).map((section) => ({
            id: section, title: t(`help.sections.${section}`), items: [t(`help.pressure.${section}.one`), t(`help.pressure.${section}.two`)],
          }))} /></div><p>{t("pressure.description")}</p>
    </div></header>
    <div className="testing-workspace">
      <aside className="testing-case-list" aria-label={t("pressure.list")}><header><h2>{t("pressure.list")}</h2><span>{items.length}</span></header>
        <div className="testing-list-create-actions testing-list-create-actions--single"><Button variant="primary"
          onClick={() => { setDraft(emptyDraft()); setExecution(null); setSamples([]); executionVersion.current += 1; }}>
          <Plus size={16} />{t("pressure.new")}</Button></div>
        {items.length === 0 ? <p className="testing-list-status">{t("pressure.empty")}</p> : <ul>{items.map((item) => <li key={item.id}>
          <button type="button" aria-current={draft?.id === item.id ? "true" : undefined} onClick={() => void select(item.id)}>
            <span><strong>{item.name}</strong><small>{t("pressure.vuSummary", { count: item.load.virtualUsers })}</small></span>
          </button></li>)}</ul>}
      </aside>
      <div className="testing-editor-shell">{draft === null ? <div className="testing-editor-placeholder"><p>{t("pressure.selectHint")}</p></div>
        : <div className="testing-editor"><header className="testing-editor__header"><div><h2>{draft.id === null ? t("pressure.new") : draft.name}</h2>
          <p>{t("pressure.editorHint")}</p></div><div className="testing-editor__actions">
          {draft.id !== null && (execution !== null && !terminal.has(execution.status)
            ? <Button variant="danger" onClick={() => void cancel()}><Stop size={15} />{t("pressure.stop")}</Button>
            : <Button variant="primary" onClick={() => void run()}><Play size={15} />{t("pressure.run")}</Button>)}
          <Button variant="secondary" loading={saving} onClick={() => void save()}>{t("pressure.save")}</Button>
          {draft.id !== null && <Button variant="danger" onClick={() => setDeleteOpen(true)}><Trash size={15} />{t("pressure.delete")}</Button>}
        </div></header>
        <section className="testing-editor-section pressure-basics"><label>{t("editor.name")}<input className="ui-input" value={draft.name}
          onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
          <label>{t("editor.description")}<input className="ui-input" value={draft.description}
            onChange={(event) => setDraft({ ...draft, description: event.target.value })} /></label>
          <label>{t("pressure.target")}<Select value={draft.testCaseId} onChange={(event) => setDraft({ ...draft, testCaseId: event.target.value })}>
            <option value="">{t("pressure.selectTarget")}</option>{cases.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</Select></label>
          <label>{t("pressure.inputs")}<textarea className="ui-input" rows={3} value={draft.inputs}
            onChange={(event) => setDraft({ ...draft, inputs: event.target.value })} /></label></section>
        <section className="testing-editor-section"><h3>{t("pressure.loadModel")}</h3><div className="pressure-grid">
          <label>{t("pressure.virtualUsers")}<input className="ui-input" type="number" min={1} max={20} value={draft.virtualUsers} onChange={setNumber("virtualUsers", 1, 20)} /></label>
          <label>{t("pressure.rampUpMs")}<input className="ui-input" type="number" min={0} max={120000} value={draft.rampUpMs} onChange={setNumber("rampUpMs", 0, 120000)} /></label>
          <label>{t("pressure.durationMs")}<input className="ui-input" type="number" min={1000} max={600000} value={draft.durationMs} onChange={setNumber("durationMs", 1000, 600000)} /></label>
          <label>{t("pressure.thinkTimeMs")}<input className="ui-input" type="number" min={0} max={10000} value={draft.thinkTimeMs} onChange={setNumber("thinkTimeMs", 0, 10000)} /></label>
          <label>{t("pressure.maxIterations")}<input className="ui-input" type="number" min={1} max={1000} value={draft.maxIterations} onChange={setNumber("maxIterations", 1, 1000)} /></label>
        </div><p className="pressure-safety-note">{t("pressure.safetyPreview", { count: draft.maxIterations })}</p></section>
        <section className="testing-editor-section"><h3>{t("pressure.thresholds")}</h3><div className="pressure-grid">
          <label>{t("pressure.maxErrorRate")}<input className="ui-input" type="number" min={0} max={100} step="0.1" value={draft.maxErrorRatePercent} onChange={setNumber("maxErrorRatePercent", 0, 100)} /></label>
          <label>{t("pressure.maxP95")}<input className="ui-input" type="number" min={1} max={300000} value={draft.maxP95DurationMs} onChange={setNumber("maxP95DurationMs", 1, 300000)} /></label>
          <label>{t("pressure.minRps")}<input className="ui-input" type="number" min={0} max={10000} step="0.1" value={draft.minRequestsPerSecond} onChange={setNumber("minRequestsPerSecond", 0, 10000)} /></label>
          <label className="testing-enabled"><input type="checkbox" checked={draft.stopOnErrorRate}
            onChange={(event) => setDraft({ ...draft, stopOnErrorRate: event.target.checked })} />{t("pressure.stopOnErrorRate")}</label>
        </div></section>
        {execution !== null && <PressureExecutionViewer api={api} projectId={projectId} execution={execution} samples={samples} />}
      </div>}</div>
    </div>
    {deleteOpen && <Dialog titleId="pressure-delete-title" descriptionId="pressure-delete-description" onClose={() => setDeleteOpen(false)} closeDisabled={saving}>
      <div className="testing-delete-dialog"><h2 id="pressure-delete-title">{t("pressure.deleteTitle")}</h2><p id="pressure-delete-description">{t("pressure.deleteDescription")}</p>
        <div><Button variant="secondary" onClick={() => setDeleteOpen(false)}>{t("editor.cancel")}</Button><Button variant="danger" loading={saving} onClick={() => void remove()}>{t("pressure.delete")}</Button></div></div>
    </Dialog>}
    {destructiveOpen && <Dialog titleId="pressure-destructive-title" descriptionId="pressure-destructive-description" onClose={() => setDestructiveOpen(false)}>
      <div className="testing-delete-dialog"><h2 id="pressure-destructive-title">{t("pressure.destructiveTitle")}</h2><p id="pressure-destructive-description">{t("pressure.destructiveDescription", { count: draft?.maxIterations ?? 0 })}</p>
        <div><Button variant="secondary" onClick={() => setDestructiveOpen(false)}>{t("editor.cancel")}</Button><Button variant="danger" onClick={() => void run(true)}>{t("pressure.confirmRun")}</Button></div></div>
    </Dialog>}
  </section>;
}
