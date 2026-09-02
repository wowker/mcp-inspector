import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLineDown, CaretRight, FloppyDisk, Play } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { confirmToast } from "../../app/AppToaster.js";
import type {
  InspectorApiClient,
  ToolWorkflow,
  WorkflowDebugInput,
  WorkflowDebugResult,
  WorkflowValidationResult,
} from "../../api/api-client.js";

interface Props {
  api: InspectorApiClient;
  projectId: string;
  connectionId: string;
  toolName: string;
  argumentsValue: Record<string, unknown>;
  onApplyArguments?: (value: Record<string, unknown>) => void;
  onWorkflowChange?: (workflow: ToolWorkflow) => void;
}

type Phase = "before" | "after";
type Draft = Pick<ToolWorkflow, "before" | "after" | "timeoutMs">;

const templates = {
  before: `export default async function before(ctx) {
  // Modify the current Tool arguments or call helper Tools.
  ctx.log.info("before started", ctx.arguments.all());
}
`,
  after: `export default async function after(ctx) {
  // ctx.response is the read-only main Tool response.
  ctx.log.info("after completed", ctx.response);
}
`,
} as const;

interface ScriptExample {
  id: "prepareArguments" | "helperTool" | "serverVariable" | "validateResponse" | "saveCursor";
  phase: Phase;
  source: string;
}

const scriptExamples: ScriptExample[] = [
  {
    id: "prepareArguments",
    phase: "before",
    source: `export default async function before(ctx) {
  ctx.arguments.set("target_id", "replace-me");
  ctx.arguments.remove("temporary_value");
  ctx.log.info("arguments prepared", ctx.arguments.all());
}
`,
  },
  {
    id: "helperTool",
    phase: "before",
    source: `export default async function before(ctx) {
  const helper = await ctx.tools.call({
    server: "current",
    name: "lookup_tool",
    arguments: { id: ctx.arguments.get("source_id") },
  });
  const value = ctx.json.get(helper, "$.structuredContent.value");
  ctx.assert.exists(value, "Helper Tool did not return value");
  ctx.arguments.set("target_value", value);
  ctx.log.info("helper result mapped", { value });
}
`,
  },
  {
    id: "serverVariable",
    phase: "before",
    source: `export default async function before(ctx) {
  const tenantId = ctx.env.get("TENANT_ID", { scope: "server" });
  ctx.assert.exists(tenantId, "Server variable TENANT_ID is not configured");
  ctx.arguments.set("tenant_id", tenantId);
  ctx.log.info("tenant applied");
}
`,
  },
  {
    id: "validateResponse",
    phase: "after",
    source: `export default async function after(ctx) {
  const resultId = ctx.json.get(ctx.response, "$.structuredContent.id");
  ctx.assert.exists(resultId, "Main Tool response is missing id");
  ctx.log.info("response verified", { resultId });
}
`,
  },
  {
    id: "saveCursor",
    phase: "after",
    source: `export default async function after(ctx) {
  const cursor = ctx.json.get(ctx.response, "$.structuredContent.nextCursor");
  ctx.assert.exists(cursor, "Main Tool response is missing nextCursor");
  ctx.env.set("LAST_CURSOR", cursor, { scope: "project", secret: false });
  ctx.log.info("project cursor staged", { cursor });
}
`,
  },
];

export function ScriptWorkflowView({ api, projectId, connectionId, toolName, argumentsValue, onApplyArguments, onWorkflowChange }: Props) {
  const { t } = useTranslation("scripts");
  const loadError = useRef(t("feedback.loadFailed"));
  loadError.current = t("feedback.loadFailed");
  const phaseLabel = (phase: Phase): string => t(`phase.${phase}.short`);
  const validationText = (result: WorkflowValidationResult): string => result.valid
    ? t("status.valid")
    : `${result.error?.code ?? "SYNTAX_ERROR"}: ${result.error?.message ?? t("status.invalid")}`;
  const onWorkflowChangeRef = useRef(onWorkflowChange);
  onWorkflowChangeRef.current = onWorkflowChange;
  const [workflow, setWorkflow] = useState<ToolWorkflow | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [validations, setValidations] = useState<Partial<Record<Phase, WorkflowValidationResult>>>({});
  const [debugResults, setDebugResults] = useState<Partial<Record<Phase, WorkflowDebugResult>>>({});
  const [afterResponse, setAfterResponse] = useState("");
  const debugController = useRef<AbortController | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    debugController.current?.abort();
    setWorkflow(null); setDraft(null); setValidations({}); setDebugResults({}); setAfterResponse("");
    void api.getToolWorkflow(projectId, connectionId, toolName).then((loaded) => {
      if (controller.signal.aborted) return;
      setWorkflow(loaded);
      setDraft({ before: loaded.before, after: loaded.after, timeoutMs: loaded.timeoutMs });
      onWorkflowChangeRef.current?.(loaded);
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) toast.error(error instanceof Error ? error.message : loadError.current);
    });
    return () => { controller.abort(); debugController.current?.abort(); };
  }, [api, connectionId, projectId, toolName]);

  const dirty = useMemo(() => workflow !== null && draft !== null &&
    JSON.stringify({ before: workflow.before, after: workflow.after, timeoutMs: workflow.timeoutMs }) !== JSON.stringify(draft),
  [draft, workflow]);

  function updatePhase(phase: Phase, patch: Partial<Draft[Phase]>): void {
    setDraft((current) => current === null ? null : { ...current, [phase]: { ...current[phase], ...patch } });
    setValidations((current) => { const next = { ...current }; delete next[phase]; return next; });
  }

  function applyExample(example: ScriptExample): void {
    if (draft === null) return;
    const apply = () => {
      updatePhase(example.phase, { enabled: true, source: example.source });
      toast.success(t("feedback.exampleApplied", { phase: phaseLabel(example.phase) }));
    };
    if (draft[example.phase].source.trim() === "") { apply(); return; }
    confirmToast({
      message: t("feedback.replaceTitle", { phase: phaseLabel(example.phase) }),
      description: t("feedback.replaceDescription"),
      actionLabel: t("feedback.applyExample"),
      cancelLabel: t("feedback.cancel"),
      onAction: apply,
    });
  }

  async function validate(phase: Phase): Promise<void> {
    if (draft === null) return;
    setBusy(`validate-${phase}`);
    try {
      const result = await api.validateToolWorkflow(projectId, connectionId, toolName, {
        phase, source: draft[phase].source,
      });
      setValidations((current) => ({ ...current, [phase]: result }));
      toast[result.valid ? "success" : "error"](t("feedback.validation", { phase: phaseLabel(phase), result: validationText(result) }));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("feedback.validationFailed"));
    } finally { setBusy(null); }
  }

  async function save(): Promise<void> {
    if (workflow === null || draft === null) return;
    setBusy("save");
    try {
      for (const phase of ["before", "after"] as const) {
        if (!draft[phase].enabled) continue;
        const result = await api.validateToolWorkflow(projectId, connectionId, toolName, { phase, source: draft[phase].source });
        setValidations((current) => ({ ...current, [phase]: result }));
        if (!result.valid) throw new Error(t("feedback.invalidPhase", { phase: phaseLabel(phase), message: result.error?.message ?? t("status.unknownError") }));
      }
      const saved = await api.updateToolWorkflow(projectId, connectionId, toolName, { revision: workflow.revision, ...draft });
      setWorkflow(saved); setDraft({ before: saved.before, after: saved.after, timeoutMs: saved.timeoutMs });
      onWorkflowChange?.(saved);
      toast.success(t("feedback.saved"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("feedback.saveFailed"));
    } finally { setBusy(null); }
  }

  function debug(phase: Phase): void {
    if (draft === null) return;
    if (draft[phase].source.includes("tools.call")) {
      confirmToast({
        message: t("feedback.helperWarning"),
        description: t("feedback.helperDescription"),
        actionLabel: t("feedback.allowDebug"),
        cancelLabel: t("feedback.cancel"),
        onAction: () => void runDebug(phase, true),
      });
      return;
    }
    void runDebug(phase, false);
  }

  async function runDebug(phase: Phase, allowDestructiveHelpers: boolean): Promise<void> {
    if (draft === null) return;
    let response: unknown = null;
    if (phase === "after" && afterResponse.trim() !== "") {
      try { response = JSON.parse(afterResponse); }
      catch { toast.error(t("feedback.invalidAfterResponse")); return; }
    }
    debugController.current?.abort();
    const controller = new AbortController(); debugController.current = controller;
    setBusy(`debug-${phase}`);
    try {
      const result = await api.debugToolWorkflow(projectId, connectionId, toolName, {
        phase, source: draft[phase].source,
        arguments: argumentsValue as WorkflowDebugInput["arguments"],
        response: response as WorkflowDebugInput["response"],
        timeoutMs: draft.timeoutMs,
        allowDestructiveHelpers,
      }, controller.signal);
      if (controller.signal.aborted) return;
      setDebugResults((current) => ({ ...current, [phase]: result }));
      toast.success(t("feedback.debugComplete", { phase: phaseLabel(phase) }));
    } catch (error) {
      if (!controller.signal.aborted) toast.error(error instanceof Error ? error.message : t("feedback.debugFailed"));
    } finally {
      if (debugController.current === controller) { debugController.current = null; setBusy(null); }
    }
  }

  if (workflow === null || draft === null) return <p role="status">{t("loading")}</p>;
  return <div className="script-workflow">
    <header className="script-workflow__header">
      <div><p className="script-workflow__eyebrow">TOOL WORKFLOW</p>
        <p>{t("header.description")}</p></div>
      <div className="script-workflow__actions">
        <label>{t("header.timeout")} <input className="ui-input" aria-label={t("header.timeoutAria")} type="number" min="100" max="60000" step="100"
          value={draft.timeoutMs} onChange={(event) => setDraft({ ...draft, timeoutMs: Number(event.target.value) })} /> ms</label>
        <button className="ui-button ui-button--primary" type="button" disabled={!dirty || busy !== null} onClick={() => void save()}>
          <FloppyDisk size={16} aria-hidden="true" />{t("header.save")}</button>
      </div>
    </header>
    <div className="script-workflow__phase-grid">
      {(["before", "after"] as const).map((phase) => {
        const script = draft[phase]; const validation = validations[phase];
        return <section className={`script-phase script-phase--${phase}`} key={phase}>
          <div className="script-phase__heading"><div><span className="script-phase__order">{phase === "before" ? "01" : "02"}</span>
            <h2>{t(`phase.${phase}.label`)}</h2><p>{t(`phase.${phase}.description`)}</p></div>
            <label className="ui-switch"><input type="checkbox" checked={script.enabled} onChange={(event) => updatePhase(phase, {
              enabled: event.target.checked,
              source: event.target.checked && script.source.trim() === "" ? templates[phase] : script.source,
            })} /><span aria-hidden="true" />{script.enabled ? t("status.enabled") : t("status.disabled")}</label></div>
          <textarea aria-label={t(`phase.${phase}.sourceAria`)} spellCheck={false} value={script.source}
            placeholder={templates[phase]} onChange={(event) => updatePhase(phase, { source: event.target.value })} />
          {phase === "after" && <textarea className="script-phase__response" aria-label={t("afterResponse.aria")} spellCheck={false}
            value={afterResponse} placeholder={t("afterResponse.placeholder")}
            onChange={(event) => setAfterResponse(event.target.value)} />}
          <footer className="script-phase__footer"><span className={validation === undefined ? "" : validation.valid ? "is-valid" : "is-invalid"}>
            {validation === undefined ? t("status.unvalidated") : validationText(validation)}</span>
            <span className="script-phase__buttons"><button className="ui-button" type="button" disabled={busy !== null || script.source.trim() === ""} onClick={() => void validate(phase)}>
              {t("actions.validate")}</button><button className="ui-button ui-button--primary" type="button" disabled={busy !== null || script.source.trim() === ""} onClick={() => void debug(phase)}>
              <Play size={14} aria-hidden="true" />{t("actions.debug")}</button></span></footer>
          {debugResults[phase] !== undefined && <div className="script-debug-result" aria-label={t("debugResult.label", { phase: phaseLabel(phase) })}>
            <header><strong>{t("debugResult.title")}</strong><span>{t("debugResult.summary", { logs: debugResults[phase]!.logs.length, variables: debugResults[phase]!.stagedEnvironment.length })}</span>
              {phase === "before" && onApplyArguments !== undefined && <button className="ui-button" type="button" onClick={() => onApplyArguments(debugResults[phase]!.arguments)}>{t("actions.applyArguments")}</button>}</header>
            <details open><summary>arguments</summary><pre>{JSON.stringify(debugResults[phase]!.arguments, null, 2)}</pre></details>
            {debugResults[phase]!.logs.length > 0 && <details open><summary>{t("debugResult.logs")}</summary><ol>{debugResults[phase]!.logs.map((log, index) => <li key={index}>
              <code>{log.level}</code> {log.message}{log.data === undefined ? null : <pre>{JSON.stringify(log.data, null, 2)}</pre>}</li>)}</ol></details>}
          </div>}
        </section>;
      })}
    </div>
    <details className="script-sdk-reference">
      <summary><CaretRight className="script-disclosure-icon" size={15} weight="bold" aria-hidden="true" /><span>{t("sdk.title")}</span></summary>
      <div>
        <p>{t("sdk.intro")}</p>
        <dl>
          <div><dt><code>ctx.arguments</code></dt><dd>{t("sdk.arguments")}</dd></div>
          <div><dt><code>ctx.tools.call(input)</code></dt><dd>{t("sdk.tools")}</dd></div>
          <div><dt><code>ctx.response</code></dt><dd>{t("sdk.response")}</dd></div>
          <div><dt><code>ctx.variables</code></dt><dd>{t("sdk.variables")}</dd></div>
          <div><dt><code>ctx.env.get/set</code></dt><dd>{t("sdk.env")}</dd></div>
          <div><dt><code>ctx.json.get(value, path)</code></dt><dd>{t("sdk.json")}</dd></div>
          <div><dt><code>ctx.assert</code></dt><dd>{t("sdk.assert")}</dd></div>
        </dl>
      </div>
    </details>
    <details className="script-examples">
      <summary><CaretRight className="script-disclosure-icon" size={15} weight="bold" aria-hidden="true" /><span>{t("examples.title")}</span><small>{t("examples.summary")}</small></summary>
      <div className="script-examples__list">
        {scriptExamples.map((example) => { const title = t(`examples.items.${example.id}.title`); return <section className="script-example" key={`${example.phase}-${example.id}`}>
          <div className="script-example__copy"><span>{phaseLabel(example.phase)}</span>
            <h3>{title}</h3><p>{t(`examples.items.${example.id}.description`)}</p></div>
          <pre><code>{example.source}</code></pre>
          <button className="ui-button" type="button" aria-label={t("examples.useAria", { title })} onClick={() => applyExample(example)}>
            <ArrowLineDown size={15} aria-hidden="true" />{t("examples.applyTo", { phase: phaseLabel(example.phase) })}
          </button>
        </section>; })}
      </div>
    </details>
  </div>;
}
