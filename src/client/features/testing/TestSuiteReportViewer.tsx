import { CaretRight, FloppyDisk, PencilSimple, Trash, Wrench } from "@phosphor-icons/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import type { InspectorApiClient, RunDetail } from "../../api/api-client.js";
import { Button } from "../../components/actions/Button.js";
import { StatusBadge, type StatusBadgeStatus } from "../../components/feedback/StatusBadge.js";
import { Select } from "../../components/forms/Select.js";
import { Dialog } from "../../components/overlays/Dialog.js";
import type { TestExecutionDetail } from "../../../shared/testing/test-execution.js";
import type {
  SavedTestSuiteReport,
  TestSuiteExecutionReportOutline,
  TestSuiteExecutionReportSummary,
  TestSuiteReportCall,
} from "../../../shared/testing/test-suite-report.js";
import { RunResultPanel } from "../runs/RunResultPanel.js";

interface Props {
  api: InspectorApiClient;
  projectId: string;
  suiteId: string;
  executionId: string;
  savedReportId?: string;
}

interface SelectedCall { memberIndex: number; call: TestSuiteReportCall }
interface CallDetail { execution: TestExecutionDetail; run: RunDetail | null }
const terminalStatuses = new Set(["PASSED", "FAILED", "ERROR", "CANCELLED", "INTERRUPTED"]);

function badgeStatus(status: string): StatusBadgeStatus {
  if (status === "PASSED") return "success";
  if (status === "QUEUED" || status === "RUNNING" || status === "PENDING") return "pending";
  if (status === "SKIPPED") return "warning";
  return "danger";
}

function initialCall(outline: TestSuiteExecutionReportOutline): SelectedCall | null {
  for (const [memberIndex, member] of outline.members.entries()) {
    const failed = member.calls.find(({ status }) => status === "FAILED" || status === "ERROR");
    if (failed !== undefined) return { memberIndex, call: failed };
  }
  for (const [memberIndex, member] of outline.members.entries()) {
    const withRun = member.calls.find(({ runId }) => runId !== null);
    if (withRun !== undefined) return { memberIndex, call: withRun };
  }
  return null;
}

export function TestSuiteReportViewer({ api, projectId, suiteId, executionId, savedReportId }: Props) {
  const { t } = useTranslation("testing");
  const loadVersion = useRef(0);
  const detailVersion = useRef(0);
  const [outline, setOutline] = useState<TestSuiteExecutionReportOutline | null>(null);
  const [savedReports, setSavedReports] = useState<SavedTestSuiteReport[]>([]);
  const [history, setHistory] = useState<TestSuiteExecutionReportSummary[]>([]);
  const [selectedVersion, setSelectedVersion] = useState(`execution:${executionId}`);
  const [selectedCall, setSelectedCall] = useState<SelectedCall | null>(null);
  const [detail, setDetail] = useState<CallDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [expanded, setExpanded] = useState(true);
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveMode, setSaveMode] = useState<"create" | "edit">("create");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [reportName, setReportName] = useState("");
  const [versionLabel, setVersionLabel] = useState("");
  const [note, setNote] = useState("");

  async function loadReport(targetExecutionId: string): Promise<void> {
    const version = ++loadVersion.current;
    setLoading(true); setOutline(null); setSelectedCall(null); setDetail(null);
    try {
      const next = await api.getTestSuiteExecutionReport(projectId, targetExecutionId);
      if (version !== loadVersion.current) return;
      const nextCall = initialCall(next);
      setOutline(next); setSelectedCall(nextCall); setLoading(false);
    } catch {
      if (version === loadVersion.current) { setLoading(false); toast.error(t("suiteReport.loadFailed")); }
    }
  }

  useEffect(() => {
    setSelectedVersion(`execution:${executionId}`); setSavedReports([]); setHistory([]);
    const reportPromise = loadReport(executionId);
    const scope = loadVersion.current;
    void Promise.all([
      reportPromise,
      api.listSavedTestSuiteReports(projectId, { suiteId, limit: 100 })
        .then(({ items }) => { if (scope !== loadVersion.current) return; setSavedReports(items); if (savedReportId !== undefined && items.some(({ id }) => id === savedReportId)) setSelectedVersion(`saved:${savedReportId}`); })
        .catch(() => { if (scope === loadVersion.current) toast.error(t("suiteReport.versionsLoadFailed")); }),
      api.listTestSuiteExecutions(projectId, suiteId, { limit: 100 })
        .then(({ items }) => { if (scope === loadVersion.current) setHistory(items); })
        .catch(() => { if (scope === loadVersion.current) toast.error(t("suiteReport.historyLoadFailed")); }),
    ]);
    return () => { loadVersion.current += 1; detailVersion.current += 1; };
  }, [api, projectId, suiteId, executionId, savedReportId]);

  useEffect(() => {
    const version = ++detailVersion.current;
    const controller = new AbortController();
    setDetail(null);
    if (outline === null || selectedCall === null) { setDetailLoading(false); return; }
    const member = outline.members[selectedCall.memberIndex];
    const testExecutionId = member?.testExecution?.id;
    if (testExecutionId === undefined) { setDetailLoading(false); return; }
    setDetailLoading(true);
    void api.getTestExecution(projectId, testExecutionId).then(async (execution) => {
      if (version !== detailVersion.current) return;
      const run = selectedCall.call.runId === null ? null : await api.getRun(projectId, selectedCall.call.runId, controller.signal);
      if (version === detailVersion.current) { setDetail({ execution, run }); setDetailLoading(false); }
    }).catch(() => {
      if (!controller.signal.aborted && version === detailVersion.current) { setDetailLoading(false); toast.error(t("suiteReport.detailLoadFailed")); }
    });
    return () => controller.abort();
  }, [api, outline, projectId, selectedCall]);

  const selectedStep = useMemo(() => detail?.execution.steps.find(({ id }) => id === selectedCall?.call.stepRecordId) ?? null,
    [detail, selectedCall]);
  const selectedSavedId = selectedVersion.startsWith("saved:") ? selectedVersion.slice("saved:".length) : null;
  const selectedSaved = selectedSavedId === null ? null : savedReports.find(({ id }) => id === selectedSavedId) ?? null;

  function changeVersion(value: string): void {
    setSelectedVersion(value);
    const [kind, id] = value.split(":", 2);
    const targetExecutionId = kind === "saved" ? savedReports.find((report) => report.id === id)?.suiteExecutionId
      : kind === "execution" ? id : undefined;
    if (targetExecutionId !== undefined) void loadReport(targetExecutionId);
  }

  function openSave(): void {
    setSaveMode("create");
    setReportName(outline === null ? "" : t("suiteReport.defaultName", { name: outline.execution.suiteSnapshot.name }));
    setVersionLabel(""); setNote(""); setSaveOpen(true);
  }

  function openEdit(): void {
    if (selectedSaved === null) return;
    setSaveMode("edit"); setReportName(selectedSaved.name); setVersionLabel(selectedSaved.versionLabel);
    setNote(selectedSaved.note ?? ""); setSaveOpen(true);
  }

  async function saveReport(): Promise<void> {
    if (outline === null || reportName.trim() === "" || versionLabel.trim() === "") return;
    setSaving(true);
    try {
      const metadata = { name: reportName, versionLabel, note: note.trim() === "" ? null : note };
      const saved = saveMode === "edit" && selectedSaved !== null
        ? await api.updateSavedTestSuiteReport(projectId, selectedSaved.id, { revision: selectedSaved.revision, ...metadata })
        : await api.createSavedTestSuiteReport(projectId, crypto.randomUUID(), {
          suiteId, suiteExecutionId: outline.execution.id, ...metadata,
        });
      setSavedReports((current) => [saved, ...current.filter(({ id }) => id !== saved.id)]);
      setSelectedVersion(`saved:${saved.id}`); setSaveOpen(false);
      toast.success(t(saveMode === "edit" ? "suiteReport.updated" : "suiteReport.saved"));
    } catch { toast.error(t("suiteReport.saveFailed")); }
    finally { setSaving(false); }
  }

  async function deleteSavedReport(): Promise<void> {
    if (selectedSaved === null) return;
    setSaving(true);
    try {
      await api.deleteSavedTestSuiteReport(projectId, selectedSaved.id);
      setSavedReports((current) => current.filter(({ id }) => id !== selectedSaved.id));
      setSelectedVersion(`execution:${selectedSaved.suiteExecutionId}`); setDeleteOpen(false);
      toast.success(t("suiteReport.deleted"));
    } catch { toast.error(t("suiteReport.deleteFailed")); }
    finally { setSaving(false); }
  }

  if (loading && outline === null) return <div className="suite-report-viewer suite-report-viewer--state" role="status">{t("suiteReport.loading")}</div>;
  if (outline === null) return <div className="suite-report-viewer suite-report-viewer--state" role="alert">{t("suiteReport.loadFailed")}</div>;
  const summary = outline.execution.summary;
  const selectedMember = selectedCall === null ? null : outline.members[selectedCall.memberIndex] ?? null;

  return <section className="suite-report-viewer" aria-labelledby={`suite-report-${outline.execution.id}`}>
    <header className="suite-report-viewer__header"><div><h3 id={`suite-report-${outline.execution.id}`}>{outline.execution.suiteSnapshot.name}</h3>
      <p>{new Date(outline.execution.createdAt).toLocaleString()} · {outline.execution.durationMs ?? 0} ms</p></div>
      <div className="suite-report-viewer__actions"><Button variant="quiet" aria-expanded={expanded} aria-controls={`suite-report-body-${outline.execution.id}`}
        onClick={() => setExpanded((value) => !value)}><CaretRight className={expanded ? "suite-report-collapse-icon suite-report-collapse-icon--open" : "suite-report-collapse-icon"}
          size={15} weight="bold" aria-hidden="true" />{t(expanded ? "suiteReport.collapse" : "suiteReport.expand")}</Button>
        <label><span>{t("suiteReport.version")}</span><Select aria-label={t("suiteReport.version")}
        value={selectedVersion} onChange={(event) => changeVersion(event.target.value)}>
        <option value={`execution:${executionId}`}>{t("suiteReport.latest")}</option>
        {history.filter(({ id }) => id !== executionId).map((item) => <option key={item.id} value={`execution:${item.id}`}>
          {new Date(item.createdAt).toLocaleString()} · {t(`execution.status.${item.status}`)}</option>)}
        {savedReports.map((saved) => <option key={saved.id} value={`saved:${saved.id}`}>{saved.versionLabel} · {saved.name}</option>)}
      </Select></label><Button variant="secondary" disabled={!terminalStatuses.has(outline.execution.status)} onClick={openSave}>
        <FloppyDisk size={15} aria-hidden="true" />{t("suiteReport.saveVersion")}</Button>
        {selectedSaved !== null && <><Button variant="quiet" onClick={openEdit}><PencilSimple size={15} aria-hidden="true" />{t("suiteReport.editVersion")}</Button>
          <Button variant="danger" onClick={() => setDeleteOpen(true)}><Trash size={15} aria-hidden="true" />{t("suiteReport.deleteVersion")}</Button></>}
      </div></header>
    {expanded && <div id={`suite-report-body-${outline.execution.id}`}><div className="suite-report-viewer__summary"><StatusBadge status={badgeStatus(outline.execution.status)}>
      {t(`execution.status.${outline.execution.status}`)}</StatusBadge>
      <span>{t("suiteReport.total", { count: summary?.total ?? 0 })}</span><span>{t("suiteReport.passed", { count: summary?.passed ?? 0 })}</span>
      <span>{t("suiteReport.failed", { count: (summary?.failed ?? 0) + (summary?.errors ?? 0) })}</span></div>
    <div className="suite-report-viewer__workspace">
      <nav className="suite-report-outline" aria-label={t("suiteReport.callList")}>{outline.members.map((member, memberIndex) =>
        <details key={member.item.id} open><summary><CaretRight size={14} weight="bold" aria-hidden="true" />
          <span><strong>{member.testExecution?.testCaseName ?? member.item.testCaseId}</strong><small>{member.calls.length} {t("suiteReport.calls")}</small></span>
          <StatusBadge status={badgeStatus(member.item.status)}>{t(`execution.status.${member.item.status}`)}</StatusBadge></summary>
          <ol>{member.calls.map((call) => <li key={call.stepRecordId}><button type="button"
            aria-current={selectedCall?.call.stepRecordId === call.stepRecordId ? "step" : undefined}
            onClick={() => setSelectedCall({ memberIndex, call })}>
            <Wrench size={14} aria-hidden="true" /><span><strong>{call.stepId}</strong><small>{t("execution.attempt", { attempt: call.attempt })}
              {call.stepKind === "cleanup" ? ` · ${t("suiteReport.cleanup")}` : ""}</small></span>
            <StatusBadge status={badgeStatus(call.status)}>{t(`execution.stepStatus.${call.status}`)}</StatusBadge></button></li>)}</ol>
        </details>)}</nav>
      <section className="suite-report-detail" aria-label={t("suiteReport.callDetail")}>
        {selectedCall === null ? <p role="status">{t("suiteReport.selectCall")}</p>
          : detailLoading ? <p role="status">{t("suiteReport.detailLoading")}</p>
            : detail === null ? <p role="alert">{t("suiteReport.detailUnavailable")}</p>
              : <><header><div><strong>{selectedMember?.testExecution?.testCaseName}</strong><span>{selectedCall.call.stepId}</span></div>
                <StatusBadge status={badgeStatus(selectedCall.call.status)}>{t(`execution.stepStatus.${selectedCall.call.status}`)}</StatusBadge></header>
                <section className="suite-report-arguments"><h4>{t("execution.arguments")}</h4>
                  {selectedStep?.resolvedArguments === null || selectedStep === null ? <p>{t("execution.noArguments")}</p>
                    : <pre>{JSON.stringify(selectedStep.resolvedArguments, null, 2)}</pre>}</section>
                {detail.run === null ? <p role="status">{t("execution.noStepResponse")}</p> : <RunResultPanel run={detail.run} />}</>}
      </section>
    </div></div>}
    {saveOpen && <Dialog titleId="suite-report-save-title" descriptionId="suite-report-save-description"
      onClose={() => setSaveOpen(false)} closeDisabled={saving}>
      <div className="suite-report-save-dialog"><h2 id="suite-report-save-title">{t(saveMode === "edit" ? "suiteReport.editTitle" : "suiteReport.saveTitle")}</h2>
        <p id="suite-report-save-description">{t(saveMode === "edit" ? "suiteReport.editDescription" : "suiteReport.saveDescription")}</p>
        <label>{t("suiteReport.name")}<input className="ui-input" value={reportName} onChange={(event) => setReportName(event.target.value)} /></label>
        <label>{t("suiteReport.versionLabel")}<input className="ui-input" value={versionLabel} onChange={(event) => setVersionLabel(event.target.value)} /></label>
        <label>{t("suiteReport.note")}<textarea className="ui-input" rows={3} value={note} onChange={(event) => setNote(event.target.value)} /></label>
        <div><Button variant="secondary" onClick={() => setSaveOpen(false)}>{t("editor.cancel")}</Button>
          <Button variant="primary" loading={saving} disabled={reportName.trim() === "" || versionLabel.trim() === ""}
            onClick={() => void saveReport()}>{t(saveMode === "edit" ? "suiteReport.saveChanges" : "suiteReport.save")}</Button></div></div>
    </Dialog>}
    {deleteOpen && selectedSaved !== null && <Dialog titleId="suite-report-delete-title" descriptionId="suite-report-delete-description"
      onClose={() => setDeleteOpen(false)} closeDisabled={saving}>
      <div className="testing-delete-dialog"><h2 id="suite-report-delete-title">{t("suiteReport.deleteTitle")}</h2>
        <p id="suite-report-delete-description">{t("suiteReport.deleteDescription", { version: selectedSaved.versionLabel })}</p><div>
          <Button variant="secondary" onClick={() => setDeleteOpen(false)}>{t("editor.cancel")}</Button>
          <Button variant="danger" loading={saving} onClick={() => void deleteSavedReport()}>{t("suiteReport.deleteConfirm")}</Button>
        </div></div>
    </Dialog>}
  </section>;
}
