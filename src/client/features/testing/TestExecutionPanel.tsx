import { CheckCircle, CircleNotch, XCircle } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TestExecutionDetail } from "../../../shared/testing/test-execution.js";
import type { RunDetail, RunSummary } from "../../api/api-client.js";
import { Button } from "../../components/actions/Button.js";
import { Disclosure } from "../../components/layout/Disclosure.js";
import { RunResultPanel } from "../runs/RunResultPanel.js";
import { AssertionResults } from "./AssertionResults.js";
import { ScenarioExecutionPanel } from "./ScenarioExecutionPanel.js";

const pending = new Set(["QUEUED", "RUNNING"]);

export function TestExecutionPanel({ execution, runTraces = {}, responseRuns, responseState, onUpdateBaseline,
  expanded: controlledExpanded, onExpandedChange, embedded = false, flush = false }: {
  execution: TestExecutionDetail;
  runTraces?: Record<string, RunSummary>;
  responseRuns?: Record<string, RunDetail>;
  responseState?: "loading" | "ready" | "error";
  onUpdateBaseline?: () => void;
  expanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
  embedded?: boolean;
  flush?: boolean;
}) {
  const { t } = useTranslation("testing");
  const [localExpanded, setLocalExpanded] = useState(true);
  const expanded = controlledExpanded ?? localExpanded;
  const isPending = pending.has(execution.status);
  const linkedRun = execution.steps.find(({ runId }) => runId !== null);
  const linkedTrace = linkedRun?.runId === null || linkedRun?.runId === undefined ? undefined : runTraces[linkedRun.runId];
  const linkedWorkflow = execution.steps.find(({ workflowExecutionId }) => workflowExecutionId !== null);
  const canUpdateBaseline = execution.assertions.some((result) =>
    result.actual !== undefined && !result.isRedacted && result.status !== "ERROR" &&
    (result.definition.operator === "EQUALS" || result.definition.operator === "DEEP_EQUALS"));
  const responseRunIds = [...new Set(execution.steps.flatMap(({ runId }) => runId === null ? [] : [runId]))];

  useEffect(() => {
    if (controlledExpanded === undefined) setLocalExpanded(true);
  }, [controlledExpanded, execution.id]);

  const summary = <span className={`testing-execution__disclosure-status testing-execution__status--${execution.status.toLocaleLowerCase()}`}>
    {isPending ? <CircleNotch size={16} className="testing-execution__spinner" aria-hidden="true" />
      : execution.status === "PASSED" ? <CheckCircle size={16} weight="fill" aria-hidden="true" />
        : <XCircle size={16} weight="fill" aria-hidden="true" />}
    {t(`execution.status.${execution.status}`)}
  </span>;

  const content = <>
    <header className="testing-execution__summary"><div className={`testing-execution__status testing-execution__status--${execution.status.toLocaleLowerCase()}`}>
      {isPending ? <CircleNotch size={17} className="testing-execution__spinner" aria-hidden="true" />
        : execution.status === "PASSED" ? <CheckCircle size={17} weight="fill" aria-hidden="true" />
          : <XCircle size={17} weight="fill" aria-hidden="true" />}
      <div><h3>{t(execution.definitionSnapshot.kind === "scenario" ? "execution.result" : "execution.title")}</h3>
        <p>{t(`execution.status.${execution.status}`)}</p></div>
    </div><div className="testing-execution__header-meta"><dl>
      <div><dt>{t("execution.duration")}</dt><dd>{execution.durationMs === null ? "—" : `${execution.durationMs} ms`}</dd></div>
      {linkedRun?.runId !== null && linkedRun?.runId !== undefined && <div><dt>{t("execution.runId")}</dt><dd>{linkedRun.runId}</dd></div>}
      {linkedTrace !== undefined && <>
        <div><dt>{t("execution.connectionId")}</dt><dd>{linkedTrace.connectionId}</dd></div>
        <div><dt>{t("execution.toolSnapshotId")}</dt><dd>{linkedTrace.toolSnapshotId}</dd></div>
      </>}
      {linkedWorkflow?.workflowExecutionId !== null && linkedWorkflow?.workflowExecutionId !== undefined && <div><dt>{t("execution.workflowId")}</dt><dd>{linkedWorkflow.workflowExecutionId}</dd></div>}
    </dl>{onUpdateBaseline !== undefined && canUpdateBaseline && <Button variant="secondary" onClick={onUpdateBaseline}>
      {t("execution.updateBaseline")}</Button>}</div></header>
    {execution.error !== null && <p role="alert" className="testing-execution__error">
      <span>{execution.error.message}</span><code>{execution.error.code}</code>
    </p>}
    {execution.definitionSnapshot.kind === "scenario"
      ? <ScenarioExecutionPanel execution={execution} runTraces={runTraces} responseRuns={responseRuns} responseState={responseState} />
      : <>
        {responseState !== undefined && <section className="testing-execution__responses" aria-labelledby="testing-execution-responses-title">
          <h4 id="testing-execution-responses-title">{t("execution.responses", { count: responseRunIds.length })}</h4>
          {responseState === "loading" ? <p role="status" className="testing-empty-copy">{t("execution.responsesLoading")}</p>
            : responseState === "error" ? <p role="alert" className="testing-execution__response-error">{t("execution.responsesFailed")}</p>
              : responseRunIds.length === 0 ? <p className="testing-empty-copy">{t("execution.noResponses")}</p>
                : responseRunIds.map((runId) => responseRuns?.[runId] === undefined ? null
                  : <RunResultPanel key={runId} run={responseRuns[runId]!} />)}
        </section>}
        {!isPending && <AssertionResults assertions={execution.assertions} />}
      </>}
  </>;

  if (embedded) return <section className="testing-execution__embedded">{content}</section>;
  return <Disclosure label={execution.definitionSnapshot.kind === "scenario" ? t("execution.result") : t("execution.title")}
    summary={summary} expanded={expanded} onExpandedChange={(next) => {
      if (controlledExpanded === undefined) setLocalExpanded(next);
      onExpandedChange?.(next);
    }} className={["testing-execution", "testing-execution-disclosure", flush ? "testing-execution--flush" : null]
      .filter(Boolean).join(" ")} contentClassName="testing-execution__content">
    {content}
  </Disclosure>;
}
