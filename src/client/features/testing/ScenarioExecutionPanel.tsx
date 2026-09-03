import { CheckCircle, CircleNotch, MinusCircle, XCircle } from "@phosphor-icons/react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TestExecutionDetail, TestExecutionStep } from "../../../shared/testing/test-execution.js";
import type { RunDetail, RunSummary } from "../../api/api-client.js";
import { JsonViewer } from "../runs/JsonViewer.js";
import { RunResultPanel } from "../runs/RunResultPanel.js";
import { AssertionResults } from "./AssertionResults.js";

type SelectedNode = { kind: "step"; id: string } | { kind: "scenario-assertions" } | null;

function StepStatusIcon({ status }: { status: TestExecutionStep["status"] }) {
  if (status === "RUNNING" || status === "PENDING") return <CircleNotch size={16} aria-hidden="true" />;
  if (status === "PASSED") return <CheckCircle size={16} weight="fill" aria-hidden="true" />;
  if (status === "SKIPPED") return <MinusCircle size={16} aria-hidden="true" />;
  return <XCircle size={16} weight="fill" aria-hidden="true" />;
}

export function ScenarioExecutionPanel({ execution, runTraces = {}, responseRuns = {}, responseState }: {
  execution: TestExecutionDetail;
  runTraces?: Record<string, RunSummary>;
  responseRuns?: Record<string, RunDetail>;
  responseState?: "loading" | "ready" | "error";
}) {
  const { t } = useTranslation("testing");
  const [selected, setSelected] = useState<SelectedNode>(null);
  const definition = execution.definitionSnapshot.kind === "scenario" ? execution.definitionSnapshot : null;
  const definitions = useMemo(() => new Map(definition === null ? []
    : [...definition.steps, ...definition.cleanupSteps].map((step) => [step.id, step] as const)), [definition]);
  const scenarioAssertions = execution.assertions.filter(({ stepRecordId }) => stepRecordId === null);
  const scenarioAssertionStatus = scenarioAssertions.some(({ status }) => status === "ERROR") ? "ERROR"
    : scenarioAssertions.some(({ status }) => status === "FAILED") ? "FAILED" : "PASSED";
  const selectedStep = selected?.kind === "step" ? execution.steps.find(({ id }) => id === selected.id) ?? null : null;

  useEffect(() => setSelected(null), [execution.id]);

  function selectStep(id: string): void {
    setSelected((current) => current?.kind === "step" && current.id === id ? null : { kind: "step", id });
  }

  const stepAssertions = selectedStep === null ? [] : execution.assertions.filter(({ stepRecordId }) => stepRecordId === selectedStep.id);
  const selectedRun = selectedStep?.runId === null || selectedStep?.runId === undefined ? undefined : responseRuns[selectedStep.runId];
  const selectedTrace = selectedStep?.runId === null || selectedStep?.runId === undefined ? undefined : runTraces[selectedStep.runId];

  return <div className="scenario-execution-view">
    <aside className="scenario-execution-flow" aria-label={t("execution.flow")}>
      <h4>{t("execution.flow")}</h4>
      {execution.steps.length === 0 ? <p className="testing-empty-copy">{t("execution.noSteps")}</p>
        : <ol>{execution.steps.map((step) => {
          const name = definitions.get(step.stepId)?.name ?? step.stepId;
          const status = t(`execution.stepStatus.${step.status}`);
          return <li key={step.id} data-status={step.status}>
            <button type="button" aria-current={selected?.kind === "step" && selected.id === step.id ? "step" : undefined}
              aria-expanded={selected?.kind === "step" && selected.id === step.id}
              aria-controls="scenario-execution-detail" onClick={() => selectStep(step.id)}>
              <StepStatusIcon status={step.status} />
              <span><strong>{name}</strong><small>{t("execution.attempt", { attempt: step.attempt })}</small></span>
              <span>{status}</span>
            </button>
          </li>;
        })}</ol>}
      {scenarioAssertions.length > 0 && <button type="button" className="scenario-execution-flow__assertions"
        data-status={scenarioAssertionStatus}
        aria-current={selected?.kind === "scenario-assertions" ? "step" : undefined}
        aria-expanded={selected?.kind === "scenario-assertions"}
        aria-controls="scenario-execution-detail"
        onClick={() => setSelected((current) => current?.kind === "scenario-assertions" ? null : { kind: "scenario-assertions" })}>
        {scenarioAssertionStatus === "PASSED" ? <CheckCircle size={16} weight="fill" aria-hidden="true" />
          : <XCircle size={16} weight="fill" aria-hidden="true" />}
        <span><strong>{t("execution.scenarioAssertions")}</strong>
          <small>{t("execution.assertionCount", { count: scenarioAssertions.length })}</small></span>
      </button>}
    </aside>
    <section id="scenario-execution-detail" className="scenario-execution-detail" aria-label={t("execution.stepDetail")}>
      {selected === null ? <div className="scenario-execution-detail__empty" role="status">
        <p>{t("execution.selectStepHint")}</p></div>
        : selected.kind === "scenario-assertions" ? <AssertionResults assertions={scenarioAssertions} />
          : selectedStep === null ? <p className="testing-empty-copy">{t("execution.stepUnavailable")}</p>
            : <>
              <header className="scenario-execution-detail__header"><div>
                <h4>{definitions.get(selectedStep.stepId)?.name ?? selectedStep.stepId}</h4>
                <p>{t("execution.attempt", { attempt: selectedStep.attempt })} · {t(`execution.stepStatus.${selectedStep.status}`)}</p>
              </div></header>
              {selectedStep.error !== null && <p role="alert" className="testing-execution__error">
                <span>{selectedStep.error.message}</span><code>{selectedStep.error.code}</code>
              </p>}
              <section className="scenario-execution-detail__section"><h4>{t("execution.inputArguments")}</h4>
                {selectedStep.resolvedArguments === null ? <p className="testing-empty-copy">{t("execution.noArguments")}</p>
                  : <JsonViewer value={selectedStep.resolvedArguments} defaultExpanded="all" />}</section>
              <section className="scenario-execution-detail__section"><h4>{t("execution.response")}</h4>
                {responseState === "loading" ? <p role="status" className="testing-empty-copy">{t("execution.responsesLoading")}</p>
                  : responseState === "error" ? <p role="alert" className="testing-execution__response-error">{t("execution.responsesFailed")}</p>
                    : selectedRun !== undefined ? <RunResultPanel run={selectedRun} />
                      : selectedStep.runId === null ? <p className="testing-empty-copy">{t("execution.noStepResponse")}</p>
                        : selectedTrace !== undefined ? <dl className="testing-execution__trace">
                          <div><dt>{t("execution.runId")}</dt><dd>{selectedTrace.id}</dd></div>
                          <div><dt>{t("execution.connectionId")}</dt><dd>{selectedTrace.connectionId}</dd></div>
                          <div><dt>{t("execution.toolSnapshotId")}</dt><dd>{selectedTrace.toolSnapshotId}</dd></div>
                        </dl> : <p className="testing-empty-copy">{t("execution.responseUnavailable")}</p>}
              </section>
              <AssertionResults assertions={stepAssertions} />
            </>}
    </section>
  </div>;
}
