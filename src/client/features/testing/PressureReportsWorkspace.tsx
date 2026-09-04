import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { InspectorApiClient } from "../../api/api-client.js";
import type { PressureTestExecution, PressureTestSample } from "../../../shared/testing/pressure-test.js";
import { Button } from "../../components/actions/Button.js";
import { Select } from "../../components/forms/Select.js";
import { StatusBadge } from "../../components/feedback/StatusBadge.js";
import { PressureExecutionViewer } from "./PressureExecutionViewer.js";

interface Props { api: InspectorApiClient; projectId: string }

async function allSamples(api: InspectorApiClient, projectId: string, executionId: string): Promise<PressureTestSample[]> {
  const items: PressureTestSample[] = [];
  let cursor: string | undefined;
  const seen = new Set<string>();
  do {
    const page = await api.listPressureTestSamples(projectId, executionId, { limit: 100,
      ...(cursor === undefined ? {} : { cursor }) });
    items.push(...page.items); cursor = page.nextCursor ?? undefined;
    if (cursor !== undefined && (seen.has(cursor) || items.length >= 1_000)) throw new Error("Invalid sample pagination");
    if (cursor !== undefined) seen.add(cursor);
  } while (cursor !== undefined);
  return items;
}

export function PressureReportsWorkspace({ api, projectId }: Props) {
  const { t } = useTranslation("testing");
  const version = useRef(0);
  const [items, setItems] = useState<PressureTestExecution[]>([]);
  const [selected, setSelected] = useState<PressureTestExecution | null>(null);
  const [samples, setSamples] = useState<PressureTestSample[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [date, setDate] = useState("");

  const load = useCallback(() => {
    const current = ++version.current;
    setLoading(true); setError(false);
    void api.listPressureTestExecutions(projectId, { limit: 100 }).then((page) => {
      if (version.current === current) { setItems(page.items); setNextCursor(page.nextCursor); setLoading(false); }
    }).catch(() => { if (version.current === current) { setLoading(false); setError(true); } });
  }, [api, projectId]);

  useEffect(() => { setSelected(null); setSamples([]); setNextCursor(null); load();
    return () => { version.current += 1; }; }, [load]);

  async function loadMore(): Promise<void> {
    if (nextCursor === null) return;
    const current = ++version.current;
    setLoading(true); setError(false);
    try {
      const page = await api.listPressureTestExecutions(projectId, { limit: 100, cursor: nextCursor });
      if (version.current !== current) return;
      setItems((existing) => [...existing, ...page.items]); setNextCursor(page.nextCursor); setLoading(false);
    } catch { if (version.current === current) { setLoading(false); setError(true); } }
  }

  async function select(item: PressureTestExecution): Promise<void> {
    const current = ++version.current;
    setSelected(null); setSamples([]); setLoading(true); setError(false);
    try {
      const [execution, loadedSamples] = await Promise.all([
        api.getPressureTestExecution(projectId, item.id), allSamples(api, projectId, item.id),
      ]);
      if (version.current !== current) return;
      setSelected(execution); setSamples(loadedSamples); setLoading(false);
    } catch { if (version.current === current) { setLoading(false); setError(true); } }
  }

  const visible = items.filter((item) =>
    item.definitionSnapshot.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()) &&
    (status === "" || item.status === status) && (date === "" || item.createdAt.slice(0, 10) === date));

  return <div className="testing-workspace pressure-reports-workspace">
    <aside className="testing-case-list" aria-label={t("pressure.reportList")}><header><h2>{t("pressure.reportList")}</h2><span>{visible.length}</span></header>
      <div className="pressure-report-filters" aria-label={t("pressure.reportFilters")}>
        <label>{t("pressure.reportPlanFilter")}<input className="ui-input" type="search" value={query}
          onChange={(event) => setQuery(event.target.value)} /></label>
        <label>{t("pressure.reportStatusFilter")}<Select value={status} onChange={(event) => setStatus(event.target.value)}>
          <option value="">{t("pressure.reportAllStatuses")}</option>
          {(["PASSED", "FAILED", "ERROR", "CANCELLED", "INTERRUPTED"] as const).map((value) =>
              <option key={value} value={value}>{t(`execution.status.${value}`)}</option>)}</Select></label>
        <label>{t("pressure.reportDateFilter")}<input className="ui-input" type="date" value={date}
          onChange={(event) => setDate(event.target.value)} /></label>
      </div>
      {loading && items.length === 0 ? <p className="testing-list-status">{t("pressure.reportLoading")}</p>
        : error && items.length === 0 ? <div className="testing-list-error"><strong>{t("pressure.reportLoadFailed")}</strong><br /><Button variant="secondary" onClick={load}>{t("report.retry")}</Button></div>
          : items.length === 0 ? <p className="testing-list-status">{t("pressure.reportEmpty")}</p>
            : visible.length === 0 ? <p className="testing-list-status">{t("pressure.reportNoMatch")}</p>
              : <ul>{visible.map((item) => <li key={item.id}><button type="button" aria-current={selected?.id === item.id ? "true" : undefined} onClick={() => void select(item)}>
              <span><strong>{item.definitionSnapshot.name}</strong><small>{new Date(item.createdAt).toLocaleString()}</small></span>
              <StatusBadge status={item.status === "PASSED" ? "success" : item.status === "RUNNING" || item.status === "QUEUED" ? "pending" : "danger"}>{t(`execution.status.${item.status}`)}</StatusBadge>
            </button></li>)}</ul>}
      {nextCursor !== null && <Button variant="secondary" loading={loading}
        onClick={() => void loadMore()}>{t("execution.loadMoreHistory")}</Button>}
    </aside>
    <div className="testing-editor-shell">{loading && items.length > 0 ? <div className="testing-editor-placeholder"><p>{t("pressure.detailLoading")}</p></div>
      : error && items.length > 0 ? <div className="testing-editor-placeholder" role="alert"><p>{t("pressure.reportLoadFailed")}</p></div>
        : selected === null ? <div className="testing-editor-placeholder"><p>{t("pressure.reportSelect")}</p></div>
          : <PressureExecutionViewer api={api} projectId={projectId} execution={selected} samples={samples} />}</div>
  </div>;
}
