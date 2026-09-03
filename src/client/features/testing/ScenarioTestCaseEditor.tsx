import { ArrowDown, ArrowUp, ClockCounterClockwise, FloppyDisk, Play, Plus, Stop, Trash } from "@phosphor-icons/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import type { CatalogToolSummary, ConnectionSummary, DebugTabSummary, InspectorApiClient } from "../../api/api-client.js";
import type { ValueSource } from "../../../shared/testing/test-case.js";
import type { JsonObject } from "../../../shared/tool-definition.js";
import { Button } from "../../components/actions/Button.js";
import { IconButton } from "../../components/actions/IconButton.js";
import { FormField } from "../../components/forms/FormField.js";
import { SearchableSelect } from "../../components/forms/SearchableSelect.js";
import { Select } from "../../components/forms/Select.js";
import { Switch } from "../../components/forms/Switch.js";
import { Disclosure } from "../../components/layout/Disclosure.js";
import { ParameterEditor } from "../tabs/ParameterEditor.js";
import { ScenarioStepPolicies } from "./ScenarioStepPolicies.js";
import { addScenarioStep, moveScenarioStep, removeScenarioStep, type ScenarioStepDraft,
  scenarioDraftIssues, type ScenarioArgumentMappingDraft, type ScenarioTestCaseDraft } from "./scenario-test-case-draft.js";

interface Props {
  api: InspectorApiClient;
  projectId: string;
  draft: ScenarioTestCaseDraft;
  connections: ConnectionSummary[];
  saving: boolean;
  onChange: (draft: ScenarioTestCaseDraft) => void;
  onSave: () => void;
  onCancel: () => void;
  onDelete?: () => void;
  executionInputs: Record<string, string>;
  onExecutionInputChange: (name: string, value: string) => void;
  canExecute: boolean;
  executing: boolean;
  onExecute: () => void;
  onCancelExecution: () => void;
  onOpenHistory: () => void;
}

type StepSection = "main" | "cleanup";

export function ScenarioTestCaseEditor({ api, projectId, draft, connections, saving, onChange, onSave, onCancel,
  onDelete, executionInputs, onExecutionInputChange, canExecute, executing, onExecute, onCancelExecution, onOpenHistory }: Props) {
  const { t } = useTranslation("testing");
  const [selectedStepId, setSelectedStepId] = useState<string | null>(draft.steps[0]?.id ?? draft.cleanupSteps[0]?.id ?? null);
  const [basicsExpanded, setBasicsExpanded] = useState(draft.id === null);
  const [configurationExpanded, setConfigurationExpanded] = useState(draft.id === null);
  const [tools, setTools] = useState<CatalogToolSummary[]>([]);
  const [loadingTools, setLoadingTools] = useState(false);
  const toolVersion = useRef(0);
  const allSteps = useMemo(() => [...draft.steps.map((step) => ({ step, section: "main" as const })),
    ...draft.cleanupSteps.map((step) => ({ step, section: "cleanup" as const }))], [draft.steps, draft.cleanupSteps]);
  const selected = allSteps.find(({ step }) => step.id === selectedStepId) ?? null;
  const selectedStep = selected?.step ?? null;
  const selectedIndex = selected === null ? -1 : allSteps.findIndex(({ step }) => step.id === selected.step.id);
  const priorSteps = selectedIndex < 0 ? [] : allSteps.slice(0, selectedIndex).map(({ step }) => step);
  const priorVariables = priorSteps.flatMap((step) => step.extractors.map(({ name }) => name));
  const issues = useMemo(() => scenarioDraftIssues(draft), [draft]);
  const selectedTool = tools.find(({ name }) => name === selectedStep?.toolName) ?? null;

  useEffect(() => {
    if (selectedStepId !== null && allSteps.some(({ step }) => step.id === selectedStepId)) return;
    setSelectedStepId(allSteps[0]?.step.id ?? null);
  }, [allSteps, selectedStepId]);

  useEffect(() => setBasicsExpanded(draft.id === null), [draft.id]);
  useEffect(() => setConfigurationExpanded(draft.id === null), [draft.id]);

  useEffect(() => {
    const connectionId = selectedStep?.connectionId ?? "";
    if (connectionId === "") { setTools([]); return; }
    const version = ++toolVersion.current;
    setLoadingTools(true);
    void api.listTools(projectId, connectionId).then((result) => {
      if (version === toolVersion.current) { setTools(result); setLoadingTools(false); }
    }).catch(() => {
      if (version === toolVersion.current) { setTools([]); setLoadingTools(false); toast.error(t("list.loadFailed")); }
    });
    return () => { toolVersion.current += 1; };
  }, [api, projectId, selectedStep?.connectionId, t]);

  function replaceStep(step: ScenarioStepDraft): void {
    if (selected === null) return;
    onChange(selected.section === "main"
      ? { ...draft, steps: draft.steps.map((item) => item.id === step.id ? step : item) }
      : { ...draft, cleanupSteps: draft.cleanupSteps.map((item) => item.id === step.id ? step : item) });
  }

  function addStep(section: StepSection): void {
    const id = crypto.randomUUID();
    onChange(addScenarioStep(draft, section, id));
    setSelectedStepId(id);
  }

  function deleteStep(section: StepSection, stepId: string): void {
    const result = removeScenarioStep(draft, section, stepId);
    if (!result.ok) {
      toast.error(t("scenario.deletionBlocked", { names: result.dependents.map(({ stepName }) => stepName).join(", ") }));
      return;
    }
    onChange(result.value);
  }

  function renderSteps(section: StepSection, steps: ScenarioStepDraft[]) {
    return <section className="scenario-step-section">
      <header><strong>{t(section === "main" ? "scenario.mainSteps" : "scenario.cleanupSteps")}</strong>
        <IconButton size="compact" label={t(section === "main" ? "scenario.addMainStep" : "scenario.addCleanupStep")}
          icon={<Plus size={15} />} onClick={() => addStep(section)} /></header>
      {steps.length === 0 ? <p>{t("scenario.noSteps")}</p> : <ol>{steps.map((step, index) => <li key={step.id}>
        <button type="button" aria-current={selectedStepId === step.id ? "step" : undefined} onClick={() => setSelectedStepId(step.id)}>
          <span>{index + 1}</span><strong>{step.name}</strong></button>
        <div><IconButton size="compact" label={t("scenario.moveUp", { name: step.name })} icon={<ArrowUp size={14} />}
          disabled={index === 0} onClick={() => onChange(moveScenarioStep(draft, section, index, -1))} />
          <IconButton size="compact" label={t("scenario.moveDown", { name: step.name })} icon={<ArrowDown size={14} />}
            disabled={index === steps.length - 1} onClick={() => onChange(moveScenarioStep(draft, section, index, 1))} />
          <IconButton size="compact" label={t("scenario.deleteStep", { name: step.name })} icon={<Trash size={14} />}
            onClick={() => deleteStep(section, step.id)} /></div>
      </li>)}</ol>}
    </section>;
  }

  function parameterTab(step: ScenarioStepDraft): DebugTabSummary {
    return { id: `scenario-step-${step.id}`, projectId, connectionId: step.connectionId, toolName: step.toolName,
      title: step.name, position: 0, pinned: false, inputMode: "form", arguments: step.fixedArguments,
      rawText: Object.keys(step.fixedArguments).length === 0 ? "" : JSON.stringify(step.fixedArguments, null, 2),
      viewState: { editorScrollTop: 0, resultScrollTop: 0, splitRatio: .5 }, lastRunId: null };
  }

  function sourceFor(kind: ValueSource["kind"]): ValueSource {
    if (kind === "LITERAL") return { kind, value: null };
    if (kind === "SCENARIO_INPUT") return { kind, name: draft.inputs[0]?.name ?? "" };
    if (kind === "ENVIRONMENT") return { kind, scope: "PROJECT", name: "" };
    if (kind === "VARIABLE") return { kind, name: priorVariables[0] ?? "" };
    return { kind, stepId: priorSteps[0]?.id ?? "", path: "" };
  }

  function updateMapping(index: number, patch: Partial<ScenarioArgumentMappingDraft>): void {
    if (selectedStep === null) return;
    replaceStep({ ...selectedStep, mappings: selectedStep.mappings.map((mapping, itemIndex) => itemIndex === index
      ? { ...mapping, ...patch } : mapping) });
  }

  function renderSource(mapping: ScenarioArgumentMappingDraft, index: number) {
    const source = mapping.source;
    if (source.kind === "LITERAL") return <FormField htmlFor={`scenario-mapping-literal-${index}`} label={t("scenario.literalJson")}>
      <textarea id={`scenario-mapping-literal-${index}`} className="ui-input" rows={2} value={mapping.literalText ?? JSON.stringify(source.value)}
        onChange={(event) => updateMapping(index, { literalText: event.target.value })} /></FormField>;
    if (source.kind === "SCENARIO_INPUT") return <FormField htmlFor={`scenario-mapping-input-${index}`} label={t("scenario.inputName")}>
      <SearchableSelect id={`scenario-mapping-input-${index}`} value={source.name || null}
        options={draft.inputs.filter(({ name }) => name !== "").map(({ name, description }) => ({ value: name, label: name, description }))}
        onChange={(name) => updateMapping(index, { source: { ...source, name: name ?? "" } })}
        placeholder={t("scenario.selectInput")} searchPlaceholder={t("scenario.searchInput")} emptyMessage={t("scenario.noMatchingInputs")}
        clearable clearLabel={t("scenario.clearInput")} /></FormField>;
    if (source.kind === "VARIABLE") return <FormField htmlFor={`scenario-mapping-variable-${index}`} label={t("scenario.variableName")}>
      <SearchableSelect id={`scenario-mapping-variable-${index}`} value={source.name || null}
        options={priorVariables.map((name) => ({ value: name, label: name }))}
        onChange={(name) => updateMapping(index, { source: { ...source, name: name ?? "" } })}
        placeholder={t("scenario.selectVariable")} searchPlaceholder={t("scenario.searchVariable")} emptyMessage={t("scenario.noMatchingVariables")}
        clearable clearLabel={t("scenario.clearVariable")} /></FormField>;
    if (source.kind === "STEP_RESPONSE") return <><FormField htmlFor={`scenario-mapping-step-${index}`} label={t("scenario.sourceStep")}>
      <SearchableSelect id={`scenario-mapping-step-${index}`} value={source.stepId || null}
        options={priorSteps.map((step) => ({ value: step.id, label: step.name, keywords: [step.id] }))}
        onChange={(stepId) => updateMapping(index, { source: { ...source, stepId: stepId ?? "" } })}
        placeholder={t("scenario.selectPriorStep")} searchPlaceholder={t("scenario.searchPriorStep")} emptyMessage={t("scenario.noMatchingSteps")}
        clearable clearLabel={t("scenario.clearPriorStep")} /></FormField>
      <FormField htmlFor={`scenario-mapping-path-${index}`} label={t("scenario.responsePath")}><input id={`scenario-mapping-path-${index}`} className="ui-input"
        value={source.path} onChange={(event) => updateMapping(index, { source: { ...source, path: event.target.value } })} /></FormField></>;
    return <><FormField htmlFor={`scenario-mapping-scope-${index}`} label={t("scenario.environmentScope")}><Select id={`scenario-mapping-scope-${index}`}
      value={source.scope} onChange={(event) => updateMapping(index, { source: { ...source, scope: event.target.value as "PROJECT" | "SERVER" } })}>
      <option value="PROJECT">{t("scenario.project")}</option><option value="SERVER">{t("scenario.server")}</option></Select></FormField>
      <FormField htmlFor={`scenario-mapping-env-${index}`} label={t("scenario.variableName")}><input id={`scenario-mapping-env-${index}`} className="ui-input"
        value={source.name} onChange={(event) => updateMapping(index, { source: { ...source, name: event.target.value } })} /></FormField></>;
  }

  return <article className="testing-editor scenario-editor" aria-labelledby="testing-editor-title">
    <header className="testing-editor__header"><div><h2 id="testing-editor-title">{t(draft.id === null ? "scenario.createTitle" : "scenario.editTitle")}</h2>
      <p>{t("scenario.intro")}</p></div><div className="testing-editor__actions">
      {executing
        ? <Button variant="secondary" onClick={onCancelExecution}><Stop size={15} weight="fill" />{t("execution.cancel")}</Button>
        : <Button variant="primary" disabled={!canExecute} onClick={onExecute}><Play size={15} weight="fill" />{t("execution.runScenario")}</Button>}
      <Button variant="secondary" disabled={draft.id === null} onClick={onOpenHistory}>
        <ClockCounterClockwise size={15} />{t("execution.history")}</Button>
      <Button variant="primary" loading={saving} loadingLabel={t("editor.saving")} onClick={onSave}><FloppyDisk size={15} />{t("editor.save")}</Button>
      <Button variant="secondary" onClick={onCancel}>{t("editor.cancel")}</Button>
      {onDelete !== undefined && <Button variant="danger" onClick={onDelete}><Trash size={15} />{t("editor.delete")}</Button>}
    </div></header>
    <Disclosure label={t("editor.basics")} expanded={basicsExpanded} onExpandedChange={setBasicsExpanded}
      className="testing-basics-disclosure" contentClassName="scenario-basics">
      <FormField htmlFor="scenario-name" label={t("editor.name")} required><input id="scenario-name" className="ui-input" maxLength={120}
        value={draft.name} onChange={(event) => onChange({ ...draft, name: event.target.value })} /></FormField>
      <FormField htmlFor="scenario-description" label={t("editor.description")}><input id="scenario-description" className="ui-input" maxLength={2000}
        value={draft.description} onChange={(event) => onChange({ ...draft, description: event.target.value })} /></FormField>
      <Switch className="testing-enabled" checked={draft.isEnabled} label={t("editor.enabled")}
        onLabel={t("editor.enabledOn")} offLabel={t("editor.enabledOff")}
        showState={false}
        onChange={(isEnabled) => onChange({ ...draft, isEnabled })} />
    </Disclosure>
    <Disclosure label={t("scenario.configuration")} expanded={configurationExpanded} onExpandedChange={setConfigurationExpanded}
      className="testing-basics-disclosure" contentClassName="scenario-configuration">
      <FormField htmlFor="scenario-failure-policy" label={t("scenario.failurePolicy")}><Select id="scenario-failure-policy" value={draft.failurePolicy}
        onChange={(event) => onChange({ ...draft, failurePolicy: event.target.value as ScenarioTestCaseDraft["failurePolicy"] })}>
        <option value="STOP">{t("scenario.stop")}</option><option value="CONTINUE">{t("scenario.continue")}</option></Select></FormField>
    {draft.inputs.length > 0 && <section className="scenario-execution-inputs" aria-labelledby="scenario-execution-inputs-title">
      <header><div><h3 id="scenario-execution-inputs-title">{t("execution.scenarioInputs")}</h3><p>{t("execution.scenarioInputsHint")}</p></div></header>
      <div>{draft.inputs.map((input) => <FormField key={input.name} htmlFor={`scenario-execution-input-${input.name}`}
        label={t("execution.inputJsonLabel", { name: input.name })} description={input.description} required={input.isRequired}>
        <input id={`scenario-execution-input-${input.name}`} className="ui-input" value={executionInputs[input.name] ?? ""}
          placeholder={input.defaultValue === undefined ? t("execution.inputJsonPlaceholder") : JSON.stringify(input.defaultValue)}
          onChange={(event) => onExecutionInputChange(input.name, event.target.value)} /></FormField>)}</div>
    </section>}
    <div className="scenario-workspace">
      <aside className="scenario-rail"><section className="scenario-step-section scenario-inputs"><header><strong>{t("scenario.inputs")}</strong>
        <IconButton size="compact" label={t("scenario.addInput")} icon={<Plus size={15} />} onClick={() => onChange({ ...draft, inputs: [...draft.inputs,
          { name: "", description: "", isRequired: true }] })} /></header>
        {draft.inputs.length === 0 ? <p>{t("scenario.noInputs")}</p> : <div>{draft.inputs.map((input, index) => <article key={`input-${index}`}>
          <input className="ui-input" aria-label={t("scenario.inputNameNumber", { index: index + 1 })} value={input.name}
            placeholder={t("scenario.inputName")} onChange={(event) => onChange({ ...draft, inputs: draft.inputs.map((item, itemIndex) => itemIndex === index
              ? { ...item, name: event.target.value } : item) })} />
          <IconButton size="compact" label={t("scenario.deleteInput", { index: index + 1 })} icon={<Trash size={14} />}
            onClick={() => onChange({ ...draft, inputs: draft.inputs.filter((_, itemIndex) => itemIndex !== index) })} /></article>)}</div>}
      </section>{renderSteps("main", draft.steps)}{renderSteps("cleanup", draft.cleanupSteps)}</aside>
      <section className="scenario-step-editor">
        {selectedStep === null ? <div className="testing-editor-placeholder"><p>{t("scenario.selectStep")}</p></div> : <>
          <h3>{t("scenario.stepSettings")}</h3>
          <FormField htmlFor="scenario-step-name" label={t("scenario.stepName")} required><input id="scenario-step-name" className="ui-input"
            value={selectedStep.name} onChange={(event) => replaceStep({ ...selectedStep, name: event.target.value })} /></FormField>
          <FormField htmlFor="scenario-step-connection" label={t("editor.connection")} required><SearchableSelect id="scenario-step-connection"
            value={selectedStep.connectionId || null} options={connections.map((connection) => ({ value: connection.id, label: connection.name }))}
            onChange={(connectionId) => { setTools([]); replaceStep({ ...selectedStep, connectionId: connectionId ?? "", toolName: "", fixedArguments: {} }); }}
            placeholder={t("editor.selectConnection")} searchPlaceholder={t("editor.searchConnection")} emptyMessage={t("editor.noConnections")}
            clearable clearLabel={t("editor.clearConnection")} required /></FormField>
          <FormField htmlFor="scenario-step-tool" label={t("editor.tool")} required><SearchableSelect id="scenario-step-tool"
            value={selectedStep.toolName || null} options={tools.map((tool) => ({ value: tool.name, label: tool.name, keywords: [tool.currentSnapshot.definition.description ?? ""] }))}
            disabled={selectedStep.connectionId === ""} loading={loadingTools}
            onChange={(toolName) => replaceStep({ ...selectedStep, toolName: toolName ?? "", fixedArguments: {} })}
            placeholder={loadingTools ? t("editor.loadingTools") : t("editor.selectTool")} searchPlaceholder={t("editor.searchTool")}
            emptyMessage={t("editor.noTools")} loadingMessage={t("editor.loadingTools")}
            clearable clearLabel={t("editor.clearTool")} required /></FormField>
          <FormField htmlFor="scenario-on-failure" label={t("scenario.onFailure")}><Select id="scenario-on-failure" value={selectedStep.onFailure}
            onChange={(event) => replaceStep({ ...selectedStep, onFailure: event.target.value as ScenarioStepDraft["onFailure"] })}>
            <option value="STOP">{t("scenario.stop")}</option><option value="CONTINUE">{t("scenario.continue")}</option>
            <option value="SKIP_REMAINING">{t("scenario.skipRemaining")}</option></Select></FormField>
          {selectedTool !== null && selectedTool.status !== "removed" && <section className="scenario-fixed-arguments"><h4>{t("scenario.fixedArguments")}</h4>
            <ParameterEditor tab={parameterTab(selectedStep)} schema={selectedTool.currentSnapshot.definition.inputSchema} showExecute={false}
              onChange={(patch) => replaceStep({ ...selectedStep, fixedArguments: (patch.arguments as JsonObject | undefined) ?? selectedStep.fixedArguments })} /></section>}
          <ScenarioStepPolicies key={selectedStep.id} step={selectedStep} onChange={replaceStep} />
          <section className="scenario-collection"><header><h4>{t("scenario.mappings")}</h4><Button variant="secondary" onClick={() => replaceStep({ ...selectedStep,
            mappings: [...selectedStep.mappings, { targetPath: "", source: { kind: "LITERAL", value: null }, literalText: "null", isRequired: true }] })}>
            <Plus size={14} />{t("scenario.addMapping")}</Button></header>
            {selectedStep.mappings.map((mapping, index) => <article key={`${selectedStep.id}-mapping-${index}`}><div className="scenario-collection__heading">
              <strong>{t("scenario.mapping", { index: index + 1 })}</strong><IconButton label={t("scenario.deleteMapping", { index: index + 1 })}
                icon={<Trash size={14} />} onClick={() => replaceStep({ ...selectedStep, mappings: selectedStep.mappings.filter((_, itemIndex) => itemIndex !== index) })} /></div>
              <div className="scenario-collection__grid"><FormField htmlFor={`scenario-target-path-${index}`} label={t("scenario.targetPath")} required>
                <input id={`scenario-target-path-${index}`} className="ui-input" value={mapping.targetPath}
                  onChange={(event) => updateMapping(index, { targetPath: event.target.value })} /></FormField>
                <FormField htmlFor={`scenario-source-kind-${index}`} label={t("scenario.sourceKind")}><Select id={`scenario-source-kind-${index}`}
                  value={mapping.source.kind} onChange={(event) => updateMapping(index, { source: sourceFor(event.target.value as ValueSource["kind"]), literalText: undefined })}>
                  <option value="LITERAL">{t("scenario.literal")}</option><option value="SCENARIO_INPUT">{t("scenario.input")}</option>
                  <option value="ENVIRONMENT">{t("scenario.environment")}</option><option value="VARIABLE">{t("scenario.variable")}</option>
                  <option value="STEP_RESPONSE">{t("scenario.stepResponse")}</option></Select></FormField>{renderSource(mapping, index)}</div>
            </article>)}</section>
          <section className="scenario-collection"><header><h4>{t("scenario.extractors")}</h4><Button variant="secondary" onClick={() => replaceStep({ ...selectedStep,
            extractors: [...selectedStep.extractors, { name: "", source: "RESULT", path: "", isRequired: true }] })}><Plus size={14} />{t("scenario.addExtractor")}</Button></header>
            {selectedStep.extractors.map((extractor, index) => <article key={`${selectedStep.id}-extractor-${index}`}><div className="scenario-collection__heading">
              <strong>{t("scenario.extractor", { index: index + 1 })}</strong><IconButton label={t("scenario.deleteExtractor", { index: index + 1 })} icon={<Trash size={14} />}
                onClick={() => replaceStep({ ...selectedStep, extractors: selectedStep.extractors.filter((_, itemIndex) => itemIndex !== index) })} /></div>
              <div className="scenario-collection__grid"><FormField htmlFor={`scenario-extractor-name-${index}`} label={t("scenario.variableName")} required><input
                id={`scenario-extractor-name-${index}`} className="ui-input" value={extractor.name} onChange={(event) => replaceStep({ ...selectedStep,
                  extractors: selectedStep.extractors.map((item, itemIndex) => itemIndex === index ? { ...item, name: event.target.value } : item) })} /></FormField>
                <FormField htmlFor={`scenario-extractor-source-${index}`} label={t("scenario.sourceKind")}><Select id={`scenario-extractor-source-${index}`} value={extractor.source}
                  onChange={(event) => replaceStep({ ...selectedStep, extractors: selectedStep.extractors.map((item, itemIndex) => itemIndex === index
                    ? { ...item, source: event.target.value as typeof item.source } : item) })}><option value="RESULT">RESULT</option><option value="ERROR">ERROR</option><option value="HTTP">HTTP</option></Select></FormField>
                <FormField htmlFor={`scenario-extractor-path-${index}`} label={t("scenario.responsePath")}><input id={`scenario-extractor-path-${index}`} className="ui-input"
                  value={extractor.path} onChange={(event) => replaceStep({ ...selectedStep, extractors: selectedStep.extractors.map((item, itemIndex) => itemIndex === index
                    ? { ...item, path: event.target.value } : item) })} /></FormField></div>
            </article>)}</section>
        </>}
      </section>
      <aside className="scenario-context"><h3>{t("scenario.context")}</h3>
        <dl><div><dt>{t("scenario.inputs")}</dt><dd>{draft.inputs.length}</dd></div>
          <div><dt>{t("scenario.mainSteps")}</dt><dd>{draft.steps.length}</dd></div>
          <div><dt>{t("scenario.cleanupSteps")}</dt><dd>{draft.cleanupSteps.length}</dd></div></dl>
        <p>{t("scenario.referenceHint")}</p>
        <section className="scenario-issues" aria-live="polite"><h4>{t("scenario.issues")}</h4>{issues.length === 0
          ? <p>{t("scenario.noIssues")}</p> : <ul>{issues.map((issue, index) => <li key={`${issue}-${index}`}>{issue}</li>)}</ul>}</section>
      </aside>
    </div>
    </Disclosure>
  </article>;
}
