import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TestExecutionDetail, TestExecutionReportSummary } from "../../../shared/testing/test-execution.js";
import type { InspectorApiClient, RunDetail } from "../../api/api-client.js";
import { Button } from "../../components/actions/Button.js";
import { StatusBadge } from "../../components/feedback/StatusBadge.js";
import { Disclosure } from "../../components/layout/Disclosure.js";
import { TestExecutionPanel } from "./TestExecutionPanel.js";

export function TestExecutionWorkspace({ api, projectId, testCaseId, latestExecution, latestRuns,
  latestResponseState, resultExpanded, onResultExpandedChange, historyExpanded, onHistoryExpandedChange }: {
  api: InspectorApiClient;
  projectId: string;
  testCaseId: string;
  latestExecution: TestExecutionDetail | null;
  latestRuns: Record<string, RunDetail>;
  latestResponseState: "loading" | "ready" | "error";
  resultExpanded: boolean;
  onResultExpandedChange: (expanded: boolean) => void;
  historyExpanded: boolean;
  onHistoryExpandedChange: (expanded: boolean) => void;
}) {
  const { t, i18n } = useTranslation("testing");
  const historyRequestVersion = useRef(0);
  const detailRequestVersion = useRef(0);
  const [history, setHistory] = useState<TestExecutionReportSummary[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [historyState, setHistoryState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [historyExecution, setHistoryExecution] = useState<TestExecutionDetail | null>(null);
  const [historyRuns, setHistoryRuns] = useState<Record<string, RunDetail>>({});
  const [historyResponseState, setHistoryResponseState] = useState<"loading" | "ready" | "error">("ready");

  const loadHistory = useCallback(async (cursor?: string) => {
    const version = ++historyRequestVersion.current;
    setHistoryState("loading");
    try {
      const page = await api.listTestExecutions(projectId, { testCaseId, ...(cursor === undefined ? {} : { cursor }), limit: 50 });
      if (version !== historyRequestVersion.current) return;
      if (page.items.some((item) => item.projectId !== projectId || item.testCaseId !== testCaseId)) throw new Error();
      setHistory((current) => cursor === undefined ? page.items
        : [...current, ...page.items.filter((item) => !current.some(({ id }) => id === item.id))]);
      setNextCursor(page.nextCursor);
      setHistoryState("ready");
    } catch {
      if (version === historyRequestVersion.current) setHistoryState("error");
    }
  }, [api, projectId, testCaseId]);

  useEffect(() => {
    historyRequestVersion.current += 1;
    detailRequestVersion.current += 1;
    setHistory([]); setNextCursor(null); setHistoryState("idle"); setSelectedId(null);
    setHistoryExecution(null); setHistoryRuns({}); setHistoryResponseState("ready");
    return () => {
      historyRequestVersion.current += 1;
      detailRequestVersion.current += 1;
    };
  }, [api, projectId, testCaseId]);

  useEffect(() => {
    if (historyExpanded && historyState === "idle") void loadHistory();
  }, [historyExpanded, historyState, loadHistory]);

  async function selectHistory(item: TestExecutionReportSummary): Promise<void> {
    const version = ++detailRequestVersion.current;
    setSelectedId(item.id); setHistoryExecution(null); setHistoryRuns({}); setHistoryResponseState("loading");
    try {
      const detail = await api.getTestExecution(projectId, item.id);
      if (version !== detailRequestVersion.current) return;
      if (detail.id !== item.id || detail.projectId !== projectId || detail.testCaseId !== testCaseId) throw new Error();
      setHistoryExecution(detail);
      const runIds = [...new Set(detail.steps.flatMap(({ runId }) => runId === null ? [] : [runId]))];
      const runs: RunDetail[] = [];
      for (let index = 0; index < runIds.length; index += 8) {
        runs.push(...await Promise.all(runIds.slice(index, index + 8).map((runId) => api.getRun(projectId, runId))));
        if (version !== detailRequestVersion.current) return;
      }
      if (runs.some((run) => run.projectId !== projectId || !runIds.includes(run.id))) throw new Error();
      setHistoryRuns(Object.fromEntries(runs.map((run) => [run.id, run])));
      setHistoryResponseState("ready");
    } catch {
      if (version === detailRequestVersion.current) setHistoryResponseState("error");
    }
  }

  return <section className="test-execution-workspace">
    {latestExecution === null ? <Disclosure label={t("execution.result")} expanded={resultExpanded}
      onExpandedChange={onResultExpandedChange}
      className="testing-execution testing-execution-disclosure testing-execution--flush"
      contentClassName="testing-execution__content">
      <div className="testing-editor-placeholder"><p>{t("execution.noLatestResult")}</p></div>
    </Disclosure> : <TestExecutionPanel execution={latestExecution} responseRuns={latestRuns}
      responseState={latestResponseState} expanded={resultExpanded} onExpandedChange={onResultExpandedChange} flush />}
    <Disclosure label={t("execution.history")} expanded={historyExpanded} onExpandedChange={onHistoryExpandedChange}
      className="testing-execution testing-execution-disclosure testing-execution--flush testing-execution-history-disclosure"
      contentClassName="test-execution-history">
      <section className="test-execution-history__list" aria-label={t("execution.historyList")}>
        <header><h3>{t("execution.history")}</h3><span>{history.length}</span></header>
        {historyState === "loading" && history.length === 0 ? <p role="status">{t("execution.historyLoading")}</p>
          : historyState === "error" && history.length === 0 ? <div role="alert"><p>{t("execution.historyFailed")}</p>
            <Button variant="secondary" onClick={() => void loadHistory()}>{t("report.retry")}</Button></div>
            : history.length === 0 ? <p>{t("execution.historyEmpty")}</p>
              : <ol>{history.map((item) => <li key={item.id}><button type="button"
                aria-current={selectedId === item.id ? "true" : undefined} onClick={() => void selectHistory(item)}>
                <span><strong>{item.testCaseName}</strong>
                  <small>{new Intl.DateTimeFormat(i18n.resolvedLanguage, { dateStyle: "medium", timeStyle: "medium" })
                    .format(new Date(item.createdAt))}</small></span>
                <StatusBadge status={item.status === "PASSED" ? "success"
                  : item.status === "QUEUED" || item.status === "RUNNING" ? "pending" : "danger"}>
                  {t(`execution.status.${item.status}`)}</StatusBadge>
              </button></li>)}</ol>}
        {nextCursor !== null && <Button variant="secondary" loading={historyState === "loading"}
          onClick={() => void loadHistory(nextCursor)}>{t("execution.loadMoreHistory")}</Button>}
      </section>
      <div className="test-execution-history__detail">
        {selectedId === null ? <div className="testing-editor-placeholder"><p>{t("execution.selectHistoryHint")}</p></div>
          : historyExecution === null ? <div className="testing-editor-placeholder" role={historyResponseState === "error" ? "alert" : "status"}>
            <p>{t(historyResponseState === "error" ? "execution.historyDetailFailed" : "execution.historyDetailLoading")}</p></div>
            : <TestExecutionPanel execution={historyExecution} responseRuns={historyRuns} responseState={historyResponseState} embedded />}
      </div>
    </Disclosure>
  </section>;
}
