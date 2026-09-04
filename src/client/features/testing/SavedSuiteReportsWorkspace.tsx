import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { InspectorApiClient } from "../../api/api-client.js";
import { Button } from "../../components/actions/Button.js";
import { StatusBadge } from "../../components/feedback/StatusBadge.js";
import { Select } from "../../components/forms/Select.js";
import type { SavedTestSuiteReport, TestSuiteExecutionReportSummary } from "../../../shared/testing/test-suite-report.js";
import { TestSuiteReportViewer } from "./TestSuiteReportViewer.js";

interface Props { api: InspectorApiClient; projectId: string }
interface ReportRow {
  suiteId: string; executionId: string; suiteName: string;
  status: TestSuiteExecutionReportSummary["status"] | null;
  createdAt: string; saved: SavedTestSuiteReport[];
}

function rowsFrom(history: TestSuiteExecutionReportSummary[], saved: SavedTestSuiteReport[]): ReportRow[] {
  const rows = new Map<string, ReportRow>();
  for (const item of history) rows.set(item.id, { suiteId: item.suiteId, executionId: item.id, suiteName: item.suiteName,
    status: item.status, createdAt: item.createdAt, saved: [] });
  for (const report of saved) {
    const row = rows.get(report.suiteExecutionId) ?? { suiteId: report.suiteId, executionId: report.suiteExecutionId,
      suiteName: report.name, status: null, createdAt: report.createdAt, saved: [] };
    row.saved.push(report); rows.set(report.suiteExecutionId, row);
  }
  return [...rows.values()].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

async function loadSuiteHistories(api: InspectorApiClient, projectId: string, suiteIds: string[]) {
  const history: TestSuiteExecutionReportSummary[] = [];
  for (let index = 0; index < suiteIds.length; index += 8) {
    const pages = await Promise.all(suiteIds.slice(index, index + 8)
      .map((suiteId) => api.listTestSuiteExecutions(projectId, suiteId, { limit: 100 })));
    history.push(...pages.flatMap(({ items }) => items));
  }
  return history;
}

export function SavedSuiteReportsWorkspace({ api, projectId }: Props) {
  const { t } = useTranslation("testing");
  const version = useRef(0);
  const [rows, setRows] = useState<ReportRow[]>([]);
  const [selected, setSelected] = useState<ReportRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [suiteFilter, setSuiteFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [savedFilter, setSavedFilter] = useState("all");
  const [versionQuery, setVersionQuery] = useState("");

  const load = useCallback(() => {
    const current = ++version.current;
    setLoading(true); setError(false);
    void Promise.all([api.listTestSuites(projectId), api.listSavedTestSuiteReports(projectId, { limit: 100 })])
      .then(async ([suites, savedPage]) => {
        const history = await loadSuiteHistories(api, projectId, suites.items.map(({ id }) => id));
        if (version.current !== current) return;
        const next = rowsFrom(history, savedPage.items);
        setRows(next); setLoading(false);
        setSelected((value) => value === null ? null : next.find(({ executionId }) => executionId === value.executionId) ?? null);
      }).catch(() => { if (version.current === current) { setLoading(false); setError(true); } });
  }, [api, projectId]);

  useEffect(() => {
    setRows([]); setSelected(null); setSuiteFilter("all"); setStatusFilter("all"); setSavedFilter("all"); setVersionQuery(""); load();
    return () => { version.current += 1; };
  }, [load]);

  const suites = useMemo(() => [...new Map(rows.map((row) => [row.suiteId, row.suiteName])).entries()], [rows]);
  const visibleRows = useMemo(() => rows.filter((row) => {
    if (suiteFilter !== "all" && row.suiteId !== suiteFilter) return false;
    if (statusFilter !== "all" && row.status !== statusFilter) return false;
    if (savedFilter === "saved" && row.saved.length === 0) return false;
    if (savedFilter === "ordinary" && row.saved.length > 0) return false;
    const query = versionQuery.trim().toLocaleLowerCase();
    return query === "" || row.saved.some(({ versionLabel }) => versionLabel.toLocaleLowerCase().includes(query));
  }), [rows, savedFilter, statusFilter, suiteFilter, versionQuery]);

  return <><div className="suite-report-filters" aria-label={t("suiteReport.filters")}>
    <Select aria-label={t("suiteReport.suiteFilter")} value={suiteFilter} onChange={(event) => setSuiteFilter(event.target.value)}>
      <option value="all">{t("suiteReport.allSuites")}</option>{suites.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
    </Select>
    <Select aria-label={t("suiteReport.statusFilter")} value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
      <option value="all">{t("suiteReport.allStatuses")}</option>{["PASSED", "FAILED", "ERROR", "CANCELLED", "INTERRUPTED"].map((status) =>
        <option key={status} value={status}>{t(`execution.status.${status}`)}</option>)}
    </Select>
    <Select aria-label={t("suiteReport.savedFilter")} value={savedFilter} onChange={(event) => setSavedFilter(event.target.value)}>
      <option value="all">{t("suiteReport.allReports")}</option><option value="saved">{t("suiteReport.savedOnly")}</option>
      <option value="ordinary">{t("suiteReport.ordinaryOnly")}</option>
    </Select>
    <input className="ui-input" aria-label={t("suiteReport.versionFilter")} placeholder={t("suiteReport.versionFilter")}
      value={versionQuery} onChange={(event) => setVersionQuery(event.target.value)} />
  </div><div className="testing-workspace saved-suite-reports">
    <aside className="testing-case-list" aria-label={t("suiteReport.historyList")}><header><h2>{t("suiteReport.historyList")}</h2><span>{visibleRows.length}</span></header>
      {loading ? <p className="testing-list-status">{t("suiteReport.savedLoading")}</p>
        : error ? <div className="testing-list-error"><strong>{t("suiteReport.historyLoadFailed")}</strong><br />
          <Button variant="secondary" onClick={load}>{t("report.retry")}</Button></div>
          : visibleRows.length === 0 ? <p className="testing-list-empty">{t("suiteReport.historyEmpty")}</p>
            : <ul>{visibleRows.map((row) => <li key={row.executionId}><button type="button" aria-current={selected?.executionId === row.executionId}
              aria-label={`${row.saved[0]?.name ?? row.suiteName} ${row.saved.map(({ versionLabel }) => versionLabel).join(" ")}`}
              onClick={() => setSelected(row)}><span><strong>{row.suiteName}</strong>
                <small>{new Date(row.createdAt).toLocaleString()}</small><small>{row.saved.length === 0 ? t("suiteReport.ordinary")
                  : row.saved.map(({ versionLabel }) => versionLabel).join(" · ")}</small></span>
              {row.status !== null && <StatusBadge status={row.status === "PASSED" ? "success" : "danger"}>{t(`execution.status.${row.status}`)}</StatusBadge>}
            </button></li>)}</ul>}
    </aside>
    <div className="testing-editor-shell">{selected === null
      ? <div className="testing-editor-placeholder" role="status"><p>{t("suiteReport.savedSelect")}</p></div>
      : <TestSuiteReportViewer key={selected.executionId} api={api} projectId={projectId} suiteId={selected.suiteId}
        executionId={selected.executionId} savedReportId={selected.saved[0]?.id} anchorIsLatest={false}
        onSavedReportsChange={load} />}</div>
  </div></>;
}
