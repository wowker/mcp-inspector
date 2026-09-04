import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { InspectorApiClient, RunDetail, RunSummary } from "../../api/api-client.js";
import type { PressureTestExecution, PressureTestSample } from "../../../shared/testing/pressure-test.js";
import type { TestExecutionDetail } from "../../../shared/testing/test-execution.js";
import { StatusBadge } from "../../components/feedback/StatusBadge.js";
import { TestExecutionPanel } from "./TestExecutionPanel.js";
import { PressureTimeline } from "./PressureTimeline.js";

interface Props {
  api: InspectorApiClient;
  projectId: string;
  execution: PressureTestExecution;
  samples: PressureTestSample[];
}

function badge(status: string): "success" | "pending" | "danger" {
  return status === "PASSED" ? "success" : status === "QUEUED" || status === "RUNNING" ? "pending" : "danger";
}

function representativeSamples(samples: PressureTestSample[]): PressureTestSample[] {
  const nonPassing = samples.filter(({ status }) => status !== "PASSED").slice(0, 100);
  const slowest = [...samples].sort((left, right) => right.durationMs - left.durationMs || left.iteration - right.iteration).slice(0, 50);
  const passing = samples.filter(({ status }) => status === "PASSED");
  const successfulEdges = [...passing.slice(0, 10), ...passing.slice(-10)];
  return [...new Map([...nonPassing, ...slowest, ...successfulEdges].map((sample) => [sample.id, sample])).values()]
    .sort((left, right) => left.iteration - right.iteration);
}

export function PressureExecutionViewer({ api, projectId, execution, samples }: Props) {
  const { t } = useTranslation("testing");
  const request = useRef(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<TestExecutionDetail | null>(null);
  const [traces, setTraces] = useState<Record<string, RunSummary>>({});
  const [runs, setRuns] = useState<Record<string, RunDetail>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    request.current += 1;
    setSelectedId(null); setDetail(null); setTraces({}); setRuns({}); setLoading(false); setError(false);
  }, [execution.id]);

  async function select(sample: PressureTestSample): Promise<void> {
    const version = ++request.current;
    setSelectedId(sample.id); setDetail(null); setTraces({}); setRuns({}); setLoading(true); setError(false);
    try {
      const value = await api.getTestExecution(projectId, sample.testExecutionId);
      const runIds = [...new Set(value.steps.flatMap(({ runId }) => runId === null ? [] : [runId]))];
      const next: Record<string, RunSummary> = {};
      const nextRuns: Record<string, RunDetail> = {};
      for (let index = 0; index < runIds.length; index += 8) {
        const batch = await Promise.all(runIds.slice(index, index + 8).map(async (runId) => {
          const [summary, run] = await Promise.all([
            api.getRunSummary(projectId, runId), api.getRun(projectId, runId),
          ]);
          return { summary, detail: run };
        }));
        if (request.current !== version) return;
        batch.forEach(({ summary, detail: run }) => { next[summary.id] = summary; nextRuns[run.id] = run; });
      }
      if (request.current !== version) return;
      setDetail(value); setTraces(next); setRuns(nextRuns); setLoading(false);
    } catch {
      if (request.current === version) { setLoading(false); setError(true); }
    }
  }

  const summary = execution.summary;
  const visibleSamples = representativeSamples(samples);
  return <section className="pressure-report" aria-label={t("pressure.report")}>
    <header className="pressure-report__header">
      <div><h3>{execution.definitionSnapshot.name}</h3><p>{new Date(execution.createdAt).toLocaleString()}</p></div>
      <StatusBadge status={badge(execution.status)}>{t(`execution.status.${execution.status}`)}</StatusBadge>
    </header>
    {execution.error !== null && <p className="pressure-report__error"><code>{execution.error.code}</code> {execution.error.message}</p>}
    <dl className="pressure-metrics">
      <div><dt>{t("pressure.total")}</dt><dd>{summary?.total ?? samples.length}</dd></div>
      <div><dt>{t("pressure.errorRate")}</dt><dd>{summary === null ? "—" : `${(summary.errorRate * 100).toFixed(2)}%`}</dd></div>
      <div><dt>{t("pressure.rps")}</dt><dd>{summary?.averageRequestsPerSecond.toFixed(2) ?? "—"}</dd></div>
      <div><dt>P95</dt><dd>{summary === null ? "—" : `${summary.duration.p95Ms} ms`}</dd></div>
      <div><dt>P99</dt><dd>{summary === null ? "—" : `${summary.duration.p99Ms} ms`}</dd></div>
      <div><dt>{t("pressure.duration")}</dt><dd>{execution.durationMs === null ? "—" : `${execution.durationMs} ms`}</dd></div>
    </dl>
    {summary !== null && <section className="pressure-thresholds"><h4>{t("pressure.thresholdResults")}</h4>
      <ul>{summary.thresholds.map((threshold) => <li key={threshold.metric} data-passed={threshold.passed}>
        <span>{t(`pressure.metric.${threshold.metric}`)}</span><code>{threshold.actual} / {threshold.target}</code>
        <StatusBadge status={threshold.passed ? "success" : "danger"}>{threshold.passed ? t("pressure.met") : t("pressure.notMet")}</StatusBadge>
      </li>)}</ul>
    </section>}
    <PressureTimeline samples={samples} />
    <div className="pressure-sample-workspace">
      <aside className="pressure-samples" aria-label={t("pressure.samples")}><header><h4>{t("pressure.samples")}</h4><span>{visibleSamples.length} / {samples.length}</span></header>
        {visibleSamples.length === 0 ? <p>{t("pressure.noSamples")}</p> : <ol>{visibleSamples.map((sample) => <li key={sample.id}>
          <button type="button" aria-current={selectedId === sample.id ? "true" : undefined} onClick={() => void select(sample)}>
            <span><strong>#{sample.iteration}</strong><small>VU {sample.virtualUser} · {sample.durationMs} ms</small></span>
            <StatusBadge status={badge(sample.status)}>{t(`execution.status.${sample.status}`)}</StatusBadge>
          </button></li>)}</ol>}
      </aside>
      <div className="pressure-sample-detail">
        {loading ? <p className="pressure-detail-placeholder">{t("pressure.detailLoading")}</p>
          : error ? <p className="pressure-detail-placeholder" role="alert">{t("pressure.detailFailed")}</p>
            : detail === null ? <p className="pressure-detail-placeholder">{t("pressure.selectSample")}</p>
              : <TestExecutionPanel execution={detail} runTraces={traces} responseRuns={runs} responseState="ready" />}
      </div>
    </div>
  </section>;
}
