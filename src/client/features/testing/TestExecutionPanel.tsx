import { CheckCircle, CircleNotch, XCircle } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import type { TestExecutionDetail } from "../../../shared/testing/test-execution.js";
import type { RunSummary } from "../../api/api-client.js";
import { Button } from "../../components/actions/Button.js";
import { JsonViewer } from "../runs/JsonViewer.js";

const pending = new Set(["QUEUED", "RUNNING"]);

export function TestExecutionPanel({ execution, runTraces = {}, onUpdateBaseline }: {
  execution: TestExecutionDetail;
  runTraces?: Record<string, RunSummary>;
  onUpdateBaseline?: () => void;
}) {
  const { t } = useTranslation("testing");
  const isPending = pending.has(execution.status);
  const linkedRun = execution.steps.find(({ runId }) => runId !== null);
  const linkedWorkflow = execution.steps.find(({ workflowExecutionId }) => workflowExecutionId !== null);
  const scenarioSteps = execution.definitionSnapshot.kind === "scenario"
    ? [...execution.definitionSnapshot.steps, ...execution.definitionSnapshot.cleanupSteps] : [];
  const canUpdateBaseline = execution.assertions.some((result) =>
    result.actual !== undefined && !result.isRedacted && result.status !== "ERROR" &&
    (result.definition.operator === "EQUALS" || result.definition.operator === "DEEP_EQUALS"));
  return <section className="testing-execution" aria-labelledby="testing-execution-title" aria-live="polite">
    <header><div className={`testing-execution__status testing-execution__status--${execution.status.toLocaleLowerCase()}`}>
      {isPending ? <CircleNotch size={17} className="testing-execution__spinner" aria-hidden="true" />
        : execution.status === "PASSED" ? <CheckCircle size={17} weight="fill" aria-hidden="true" />
          : <XCircle size={17} weight="fill" aria-hidden="true" />}
      <div><h3 id="testing-execution-title">{t("execution.title")}</h3><p>{t(`execution.status.${execution.status}`)}</p></div>
    </div><div className="testing-execution__header-meta"><dl>
      <div><dt>{t("execution.duration")}</dt><dd>{execution.durationMs === null ? "—" : `${execution.durationMs} ms`}</dd></div>
      {linkedRun?.runId !== null && linkedRun?.runId !== undefined && <div><dt>{t("execution.runId")}</dt><dd>{linkedRun.runId}</dd></div>}
      {linkedWorkflow?.workflowExecutionId !== null && linkedWorkflow?.workflowExecutionId !== undefined && <div><dt>{t("execution.workflowId")}</dt><dd>{linkedWorkflow.workflowExecutionId}</dd></div>}
    </dl>{onUpdateBaseline !== undefined && canUpdateBaseline && <Button variant="secondary" onClick={onUpdateBaseline}>
      {t("execution.updateBaseline")}</Button>}</div></header>
    {execution.error !== null && <p role="alert" className="testing-execution__error">{execution.error.message}</p>}
    {execution.steps.length > 0 && <div className="testing-execution__steps">
      <h4>{t("execution.steps", { count: execution.steps.length })}</h4>
      <ol>{execution.steps.map((step) => <li key={step.id} data-status={step.status}>
        <div><strong>{scenarioSteps.find(({ id }) => id === step.stepId)?.name ?? step.stepId}</strong>
          <span>{t("execution.attempt", { attempt: step.attempt })}</span></div>
        <span>{t(`execution.stepStatus.${step.status}`)}</span>
        {(step.runId !== null || step.workflowExecutionId !== null) && <dl className="testing-execution__trace">
          {step.runId !== null && <div><dt>{t("execution.runId")}</dt><dd>{step.runId}</dd></div>}
          {step.workflowExecutionId !== null && <div><dt>{t("execution.workflowId")}</dt><dd>{step.workflowExecutionId}</dd></div>}
          {step.runId !== null && runTraces[step.runId] !== undefined && <>
            <div><dt>{t("execution.connectionId")}</dt><dd>{runTraces[step.runId]!.connectionId}</dd></div>
            <div><dt>{t("execution.toolSnapshotId")}</dt><dd>{runTraces[step.runId]!.toolSnapshotId}</dd></div>
          </>}
        </dl>}
        {step.resolvedArguments !== null && <details><summary>{t("execution.arguments")}</summary>
          <JsonViewer value={step.resolvedArguments} defaultExpanded="all" /></details>}
      </li>)}</ol>
    </div>}
    {!isPending && <div className="testing-execution__assertions">
      <h4>{t("execution.assertions", { count: execution.assertions.length })}</h4>
      {execution.assertions.length === 0 ? <p className="testing-empty-copy">{t("execution.noAssertions")}</p>
        : execution.assertions.map((assertion, index) => <article key={assertion.id} data-status={assertion.status}>
          <header><strong>{t("execution.assertion", { index: index + 1 })}</strong><span>{t(`execution.assertionStatus.${assertion.status}`)}</span></header>
          <p><code>{assertion.definition.source}{assertion.resolvedPath ?? assertion.definition.path}</code> · {assertion.definition.operator}</p>
          {assertion.message !== null && <p>{assertion.message}</p>}
          {(assertion.actual !== undefined || assertion.expected !== undefined) && <div className="testing-execution__values">
            {assertion.actual !== undefined && <div><strong>{t("execution.actual")}</strong><JsonViewer value={assertion.actual} defaultExpanded="all" /></div>}
            {assertion.expected !== undefined && <div><strong>{t("execution.expected")}</strong><JsonViewer value={assertion.expected} defaultExpanded="all" /></div>}
          </div>}
        </article>)}
    </div>}
  </section>;
}
