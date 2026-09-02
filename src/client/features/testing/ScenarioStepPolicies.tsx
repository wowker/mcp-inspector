import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { AssertionDefinition } from "../../../shared/testing/assertions.js";
import { FormField } from "../../components/forms/FormField.js";
import { AssertionEditor } from "./AssertionEditor.js";
import { parseAssertionExpected, type AssertionDraft } from "./test-case-draft.js";
import type { ScenarioStepDraft } from "./scenario-test-case-draft.js";

interface Props { step: ScenarioStepDraft; onChange: (step: ScenarioStepDraft) => void }

function drafts(definitions: AssertionDefinition[]): AssertionDraft[] {
  return definitions.map((definition) => ({ definition,
    expectedText: definition.expected === undefined ? "" : JSON.stringify(definition.expected, null, 2) }));
}

function definitionDraft(definition: AssertionDefinition | null): AssertionDraft[] {
  return definition === null ? [] : drafts([definition]);
}

function newAssertion(id: string): AssertionDefinition {
  return { id, source: "MCP_RESULT", path: "", operator: "EXISTS" };
}

function parseAll(value: AssertionDraft[]): AssertionDefinition[] | null {
  const result: AssertionDefinition[] = [];
  for (const item of value) {
    const parsed = parseAssertionExpected(item);
    if (!parsed.ok) return null;
    result.push(parsed.value);
  }
  return result;
}

export function ScenarioStepPolicies({ step, onChange }: Props) {
  const { t } = useTranslation("testing");
  const [stepAssertions, setStepAssertions] = useState(() => drafts(step.assertions));
  const [condition, setCondition] = useState(() => definitionDraft(step.condition));
  const [until, setUntil] = useState(() => drafts(step.polling?.until ?? []));
  const [failWhen, setFailWhen] = useState(() => drafts(step.polling?.failWhen ?? []));

  function updateAssertions(value: AssertionDraft[]): void {
    setStepAssertions(value);
    const parsed = parseAll(value);
    if (parsed !== null) onChange({ ...step, assertions: parsed });
  }
  function updateCondition(value: AssertionDraft[]): void {
    const limited = value.slice(0, 1);
    setCondition(limited);
    const parsed = parseAll(limited);
    if (parsed !== null) onChange({ ...step, condition: parsed[0] ?? null });
  }
  function updatePollingAssertions(key: "until" | "failWhen", value: AssertionDraft[]): void {
    if (key === "until") setUntil(value); else setFailWhen(value);
    const parsed = parseAll(value);
    if (parsed === null || step.polling === null) return;
    onChange({ ...step, polling: { ...step.polling, [key]: parsed } });
  }

  return <section className="scenario-policies">
    <section className="scenario-policy"><label><input type="checkbox" checked={condition.length > 0}
      onChange={(event) => updateCondition(event.target.checked ? drafts([newAssertion(`condition-${step.id}`)]) : [])} />
      <span>{t("scenario.enableCondition")}</span></label>
      {condition.length > 0 && <AssertionEditor value={condition} onChange={updateCondition} />}
    </section>
    <section className="scenario-policy"><label><input type="checkbox" checked={step.polling !== null}
      onChange={(event) => onChange({ ...step, polling: event.target.checked
        ? { intervalMs: 1000, maxAttempts: 10, timeoutMs: 30000, until: [], failWhen: [] } : null })} />
      <span>{t("scenario.enablePolling")}</span></label>
      {step.polling !== null && <><div className="scenario-collection__grid">
        <FormField htmlFor={`scenario-poll-interval-${step.id}`} label={t("scenario.pollInterval")}><input id={`scenario-poll-interval-${step.id}`} className="ui-input" type="number"
          min={250} max={60000} value={step.polling.intervalMs} onChange={(event) => onChange({ ...step,
            polling: { ...step.polling!, intervalMs: Number(event.target.value) } })} /></FormField>
        <FormField htmlFor={`scenario-poll-attempts-${step.id}`} label={t("scenario.pollAttempts")}><input id={`scenario-poll-attempts-${step.id}`} className="ui-input" type="number"
          min={1} max={100} value={step.polling.maxAttempts} onChange={(event) => onChange({ ...step,
            polling: { ...step.polling!, maxAttempts: Number(event.target.value) } })} /></FormField>
        <FormField htmlFor={`scenario-poll-timeout-${step.id}`} label={t("scenario.pollTimeout")}><input id={`scenario-poll-timeout-${step.id}`} className="ui-input" type="number"
          min={1} max={3600000} value={step.polling.timeoutMs} onChange={(event) => onChange({ ...step,
            polling: { ...step.polling!, timeoutMs: Number(event.target.value) } })} /></FormField>
      </div><div className="scenario-poll-assertions"><h4>{t("scenario.untilAssertions")}</h4><AssertionEditor value={until}
        onChange={(value) => updatePollingAssertions("until", value)} /><h4>{t("scenario.failAssertions")}</h4><AssertionEditor value={failWhen}
          onChange={(value) => updatePollingAssertions("failWhen", value)} /></div></>}
    </section>
    <section className="scenario-step-assertions"><h4>{t("scenario.stepAssertions")}</h4>
      <AssertionEditor value={stepAssertions} onChange={updateAssertions} /></section>
  </section>;
}
