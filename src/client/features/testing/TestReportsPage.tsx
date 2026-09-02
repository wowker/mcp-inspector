import { ArrowClockwise, DownloadSimple, UploadSimple } from "@phosphor-icons/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import type { ConnectionSummary, InspectorApiClient, RunSummary } from "../../api/api-client.js";
import { automatedTestsExportEnvelopeSchema, type AutomatedTestsExportEnvelope } from "../../../shared/testing/test-transfer.js";
import type { TestExecutionDetail, TestExecutionReportSummary } from "../../../shared/testing/test-execution.js";
import { Button } from "../../components/actions/Button.js";
import { StatusBadge } from "../../components/feedback/StatusBadge.js";
import { Dialog } from "../../components/overlays/Dialog.js";
import { Select } from "../../components/forms/Select.js";
import { TestExecutionPanel } from "./TestExecutionPanel.js";
import "./testing.css";

interface Props { api: InspectorApiClient; projectId: string }

export function TestReportsPage({ api, projectId }: Props) {
  const { t } = useTranslation("testing");
  const requestVersion = useRef(0);
  const transferVersion = useRef(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<TestExecutionReportSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [execution, setExecution] = useState<TestExecutionDetail | null>(null);
  const [runTraces, setRunTraces] = useState<Record<string, RunSummary>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [baselineOpen, setBaselineOpen] = useState(false);
  const [updatingBaseline, setUpdatingBaseline] = useState(false);
  const [importEnvelope, setImportEnvelope] = useState<AutomatedTestsExportEnvelope | null>(null);
  const [connections, setConnections] = useState<ConnectionSummary[]>([]);
  const [bindings, setBindings] = useState<Record<string, string>>({});
  const [conflictPolicy, setConflictPolicy] = useState<"SKIP" | "COPY" | "OVERWRITE">("COPY");
  const [transferring, setTransferring] = useState(false);

  const load = useCallback(() => {
    const version = ++requestVersion.current;
    setLoading(true); setError(false);
    void api.listTestExecutions(projectId, { limit: 100 }).then((page) => {
      if (version !== requestVersion.current) return;
      setItems(page.items); setLoading(false);
    }).catch(() => { if (version === requestVersion.current) { setError(true); setLoading(false); } });
  }, [api, projectId]);

  useEffect(() => {
    setItems([]); setSelectedId(null); setExecution(null); setRunTraces({});
    setImportEnvelope(null); setConnections([]); setBindings({}); setTransferring(false);
    transferVersion.current += 1;
    load();
    return () => { requestVersion.current += 1; transferVersion.current += 1; };
  }, [load]);

  async function select(item: TestExecutionReportSummary): Promise<void> {
    const version = ++requestVersion.current;
    setSelectedId(item.id); setExecution(null); setRunTraces({}); setLoading(true); setError(false);
    try {
      const detail = await api.getTestExecution(projectId, item.id);
      if (version !== requestVersion.current) return;
      const runIds = [...new Set(detail.steps.flatMap(({ runId }) => runId === null ? [] : [runId]))];
      const traces: Record<string, RunSummary> = {};
      for (let index = 0; index < runIds.length; index += 8) {
        const batch = await Promise.all(runIds.slice(index, index + 8).map((runId) => api.getRunSummary(projectId, runId)));
        if (version !== requestVersion.current) return;
        batch.forEach((run) => { traces[run.id] = run; });
      }
      setExecution(detail); setRunTraces(traces); setLoading(false);
    } catch { if (version === requestVersion.current) { setError(true); setLoading(false); } }
  }

  async function updateBaseline(): Promise<void> {
    if (execution === null) return;
    setUpdatingBaseline(true);
    try {
      const result = await api.updateTestExecutionBaseline(projectId, execution.id, {
        revision: execution.definitionSnapshot.revision, confirm: true,
      });
      setBaselineOpen(false);
      toast.success(t("report.baselineUpdated", { count: result.updatedAssertions }));
    } catch { toast.error(t("report.baselineFailed")); }
    finally { setUpdatingBaseline(false); }
  }

  async function exportDefinitions(): Promise<void> {
    const version = ++transferVersion.current;
    setTransferring(true);
    try {
      const envelope = await api.exportAutomatedTests(projectId);
      if (version !== transferVersion.current) return;
      const url = URL.createObjectURL(new Blob([JSON.stringify(envelope, null, 2)], { type: "application/json" }));
      const anchor = document.createElement("a"); anchor.href = url; anchor.download = "mcp-inspector-automated-tests.json";
      anchor.click(); URL.revokeObjectURL(url);
      toast.success(t("report.exported"));
    } catch { if (version === transferVersion.current) toast.error(t("report.exportFailed")); }
    finally { if (version === transferVersion.current) setTransferring(false); }
  }

  async function chooseImport(file: File | undefined): Promise<void> {
    if (file === undefined) return;
    const version = ++transferVersion.current;
    try {
      const envelope = automatedTestsExportEnvelopeSchema.parse(JSON.parse(await file.text()));
      const loadedConnections = await api.listConnections(projectId);
      if (version !== transferVersion.current) return;
      setImportEnvelope(envelope); setConnections(loadedConnections); setBindings({}); setConflictPolicy("COPY");
    } catch { if (version === transferVersion.current) toast.error(t("report.importInvalid")); }
    finally { if (fileInput.current !== null) fileInput.current.value = ""; }
  }

  async function importDefinitions(): Promise<void> {
    if (importEnvelope === null || importEnvelope.connections.some(({ alias }) => bindings[alias] === undefined)) return;
    const version = ++transferVersion.current;
    setTransferring(true);
    try {
      const result = await api.importAutomatedTests(projectId, {
        envelope: importEnvelope, bindings, conflictPolicy, confirm: true,
      });
      if (version !== transferVersion.current) return;
      setImportEnvelope(null);
      toast.success(t("report.imported", { cases: result.importedTestCases, suites: result.importedTestSuites }));
    } catch { if (version === transferVersion.current) toast.error(t("report.importFailed")); }
    finally { if (version === transferVersion.current) setTransferring(false); }
  }

  return <section className="testing-page testing-reports" aria-labelledby="testing-reports-title">
    <header className="page-heading testing-page__heading testing-page__heading--compact"><div>
      <h1 id="testing-reports-title">{t("report.title")}</h1><p>{t("report.description")}</p>
    </div><div className="testing-page__create-actions">
      <Button variant="secondary" loading={transferring} onClick={() => void exportDefinitions()}><DownloadSimple size={16} />{t("report.export")}</Button>
      <Button variant="secondary" onClick={() => fileInput.current?.click()}><UploadSimple size={16} />{t("report.import")}</Button>
      <Button variant="secondary" onClick={load}><ArrowClockwise size={16} />{t("report.refresh")}</Button>
      <input ref={fileInput} className="testing-transfer-file" type="file" accept="application/json,.json"
        aria-label={t("report.importFile")} onChange={(event) => void chooseImport(event.target.files?.[0])} />
    </div></header>
    <div className="testing-workspace">
      <aside className="testing-case-list" aria-label={t("report.list")}><header><h2>{t("report.list")}</h2><span>{items.length}</span></header>
        {loading && items.length === 0 ? <p className="testing-list-status">{t("report.loading")}</p>
          : error && items.length === 0 ? <div className="testing-list-error"><strong>{t("report.loadFailed")}</strong><br />
            <Button variant="secondary" onClick={load}>{t("report.retry")}</Button></div>
            : items.length === 0 ? <p className="testing-list-empty">{t("report.empty")}</p>
              : <ul>{items.map((item) => <li key={item.id}><button type="button" aria-current={selectedId === item.id}
                onClick={() => void select(item)}><span><strong>{item.testCaseName}</strong><small>{new Date(item.createdAt).toLocaleString()}</small></span>
                <StatusBadge status={item.status === "PASSED" ? "success" : item.status === "QUEUED" || item.status === "RUNNING" ? "pending" : "danger"}>
                  {t(`execution.status.${item.status}`)}</StatusBadge></button></li>)}</ul>}
      </aside>
      <div className="testing-editor-shell">
        {loading && selectedId !== null ? <div className="testing-editor-placeholder" role="status"><p>{t("report.loadingDetail")}</p></div>
          : error && selectedId !== null ? <div className="testing-editor-placeholder" role="alert"><p>{t("report.loadFailed")}</p></div>
            : execution === null ? <div className="testing-editor-placeholder" role="status"><p>{t("report.selectHint")}</p></div>
              : <TestExecutionPanel execution={execution} runTraces={runTraces} onUpdateBaseline={() => setBaselineOpen(true)} />}
      </div>
    </div>
    {baselineOpen && execution !== null && <Dialog titleId="baseline-update-title" descriptionId="baseline-update-description"
      onClose={() => setBaselineOpen(false)} closeDisabled={updatingBaseline}>
      <div className="testing-delete-dialog"><h2 id="baseline-update-title">{t("report.baselineTitle")}</h2>
        <p id="baseline-update-description">{t("report.baselineDescription", {
          name: execution.definitionSnapshot.name, revision: execution.definitionSnapshot.revision,
        })}</p><div><Button variant="secondary" onClick={() => setBaselineOpen(false)}>{t("editor.cancel")}</Button>
          <Button variant="primary" loading={updatingBaseline} onClick={() => void updateBaseline()}>{t("report.baselineConfirm")}</Button></div>
      </div>
    </Dialog>}
    {importEnvelope !== null && <Dialog titleId="test-import-title" descriptionId="test-import-description"
      onClose={() => setImportEnvelope(null)} closeDisabled={transferring}>
      <div className="testing-transfer-dialog"><h2 id="test-import-title">{t("report.importTitle")}</h2>
        <p id="test-import-description">{t("report.importDescription")}</p>
        <div className="testing-transfer-bindings">{importEnvelope.connections.map((connection) => <label key={connection.alias}>
          <span>{connection.name} <code>{connection.alias}</code></span>
          <Select aria-label={t("report.bindServer", { name: connection.name })} value={bindings[connection.alias] ?? ""}
            onChange={(event) => setBindings((current) => ({ ...current, [connection.alias]: event.target.value }))}>
            <option value="">{t("report.selectServer")}</option>
            {connections.map((server) => <option key={server.id} value={server.id}>{server.name}</option>)}
          </Select>
        </label>)}</div>
        <label className="testing-transfer-policy"><span>{t("report.conflictPolicy")}</span><Select value={conflictPolicy}
          aria-label={t("report.conflictPolicy")}
          onChange={(event) => setConflictPolicy(event.target.value as typeof conflictPolicy)}>
          <option value="COPY">{t("report.conflictCopy")}</option><option value="SKIP">{t("report.conflictSkip")}</option>
          <option value="OVERWRITE">{t("report.conflictOverwrite")}</option>
        </Select></label>
        <div className="testing-transfer-actions"><Button variant="secondary" onClick={() => setImportEnvelope(null)}>{t("editor.cancel")}</Button>
          <Button variant="primary" loading={transferring}
            disabled={importEnvelope.connections.some(({ alias }) => !bindings[alias])}
            onClick={() => void importDefinitions()}>{t("report.importConfirm")}</Button></div>
      </div>
    </Dialog>}
  </section>;
}
