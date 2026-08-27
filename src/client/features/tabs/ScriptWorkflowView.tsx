import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLineDown, CaretRight, FloppyDisk, Play } from "@phosphor-icons/react";
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
  // 可修改当前 Tool 的 arguments，也可调用其他 Tool。
  ctx.log.info("before started", ctx.arguments.all());
}
`,
  after: `export default async function after(ctx) {
  // ctx.response 为主 Tool 的只读响应。
  ctx.log.info("after completed", ctx.response);
}
`,
} as const;

interface ScriptExample {
  phase: Phase;
  title: string;
  description: string;
  source: string;
}

const scriptExamples: ScriptExample[] = [
  {
    phase: "before",
    title: "设置与清理参数",
    description: "在主 Tool 执行前补充参数，并移除不应发送的临时字段。",
    source: `export default async function before(ctx) {
  ctx.arguments.set("target_id", "replace-me");
  ctx.arguments.remove("temporary_value");
  ctx.log.info("arguments prepared", ctx.arguments.all());
}
`,
  },
  {
    phase: "before",
    title: "调用辅助 Tool 并映射结果",
    description: "调用当前 Server 的另一个 Tool，提取响应字段并写入主 Tool 参数。",
    source: `export default async function before(ctx) {
  const helper = await ctx.tools.call({
    server: "current",
    name: "lookup_tool",
    arguments: { id: ctx.arguments.get("source_id") },
  });
  const value = ctx.json.get(helper, "$.structuredContent.value");
  ctx.assert.exists(value, "辅助 Tool 未返回 value");
  ctx.arguments.set("target_value", value);
  ctx.log.info("helper result mapped", { value });
}
`,
  },
  {
    phase: "before",
    title: "读取 Server 环境变量",
    description: "读取当前 Server 作用域的变量，并将它作为主 Tool 参数。",
    source: `export default async function before(ctx) {
  const tenantId = ctx.env.get("TENANT_ID", { scope: "server" });
  ctx.assert.exists(tenantId, "未配置 Server 变量 TENANT_ID");
  ctx.arguments.set("tenant_id", tenantId);
  ctx.log.info("tenant applied");
}
`,
  },
  {
    phase: "after",
    title: "校验主 Tool 响应",
    description: "主 Tool 成功后检查关键响应字段，并输出结构化日志。",
    source: `export default async function after(ctx) {
  const resultId = ctx.json.get(ctx.response, "$.structuredContent.id");
  ctx.assert.exists(resultId, "主 Tool 响应缺少 id");
  ctx.log.info("response verified", { resultId });
}
`,
  },
  {
    phase: "after",
    title: "保存响应值到项目变量",
    description: "从响应中提取游标，并在整条流水线成功后保存为项目变量。",
    source: `export default async function after(ctx) {
  const cursor = ctx.json.get(ctx.response, "$.structuredContent.nextCursor");
  ctx.assert.exists(cursor, "主 Tool 响应缺少 nextCursor");
  ctx.env.set("LAST_CURSOR", cursor, { scope: "project", secret: false });
  ctx.log.info("project cursor staged", { cursor });
}
`,
  },
];

function validationText(result: WorkflowValidationResult): string {
  return result.valid ? "语法有效" : `${result.error?.code ?? "SYNTAX_ERROR"}: ${result.error?.message ?? "脚本语法无效"}`;
}

export function ScriptWorkflowView({ api, projectId, connectionId, toolName, argumentsValue, onApplyArguments, onWorkflowChange }: Props) {
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
      if (!controller.signal.aborted) toast.error(error instanceof Error ? error.message : "加载脚本配置失败");
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
      toast.success(`样例已应用到${example.phase === "before" ? "前置" : "后置"}脚本`);
    };
    if (draft[example.phase].source.trim() === "") { apply(); return; }
    confirmToast({
      message: `替换现有${example.phase === "before" ? "前置" : "后置"}脚本？`,
      description: "当前编辑内容将被样例替换；保存配置前仍可撤销或修改。",
      actionLabel: "应用样例",
      cancelLabel: "取消",
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
      toast[result.valid ? "success" : "error"](`${phase === "before" ? "前置" : "后置"}脚本：${validationText(result)}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "脚本校验失败");
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
        if (!result.valid) throw new Error(`${phase === "before" ? "前置" : "后置"}脚本语法无效：${result.error?.message ?? "未知错误"}`);
      }
      const saved = await api.updateToolWorkflow(projectId, connectionId, toolName, { revision: workflow.revision, ...draft });
      setWorkflow(saved); setDraft({ before: saved.before, after: saved.after, timeoutMs: saved.timeoutMs });
      onWorkflowChange?.(saved);
      toast.success("脚本配置已保存");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "保存脚本配置失败");
    } finally { setBusy(null); }
  }

  function debug(phase: Phase): void {
    if (draft === null) return;
    if (draft[phase].source.includes("tools.call")) {
      confirmToast({
        message: "脚本会调用辅助 Tool，其中可能包含有副作用的操作。",
        description: "是否允许本次试运行调用破坏性辅助 Tool？",
        actionLabel: "允许试运行",
        cancelLabel: "取消",
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
      catch { toast.error("后置脚本调试响应必须是有效 JSON"); return; }
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
      toast.success(`${phase === "before" ? "前置" : "后置"}脚本试运行完成；环境变量修改未提交`);
    } catch (error) {
      if (!controller.signal.aborted) toast.error(error instanceof Error ? error.message : "脚本试运行失败");
    } finally {
      if (debugController.current === controller) { debugController.current = null; setBusy(null); }
    }
  }

  if (workflow === null || draft === null) return <p role="status">正在加载脚本配置…</p>;
  return <div className="script-workflow">
    <header className="script-workflow__header">
      <div><p className="script-workflow__eyebrow">TOOL WORKFLOW</p>
        <p>在隔离沙箱中准备参数、调用辅助 Tool，并检查完整执行日志。</p></div>
      <div className="script-workflow__actions">
        <label>单段超时 <input className="ui-input" aria-label="脚本超时（毫秒）" type="number" min="100" max="60000" step="100"
          value={draft.timeoutMs} onChange={(event) => setDraft({ ...draft, timeoutMs: Number(event.target.value) })} /> ms</label>
        <button className="ui-button ui-button--primary" type="button" disabled={!dirty || busy !== null} onClick={() => void save()}>
          <FloppyDisk size={16} aria-hidden="true" />保存配置</button>
      </div>
    </header>
    <div className="script-workflow__phase-grid">
      {(["before", "after"] as const).map((phase) => {
        const script = draft[phase]; const validation = validations[phase];
        return <section className={`script-phase script-phase--${phase}`} key={phase}>
          <div className="script-phase__heading"><div><span className="script-phase__order">{phase === "before" ? "01" : "02"}</span>
            <h2>{phase === "before" ? "前置脚本" : "后置脚本"}</h2><p>{phase === "before" ? "主 Tool 前运行，可修改 arguments。" : "主 Tool 成功后运行，可读取 response。"}</p></div>
            <label className="ui-switch"><input type="checkbox" checked={script.enabled} onChange={(event) => updatePhase(phase, {
              enabled: event.target.checked,
              source: event.target.checked && script.source.trim() === "" ? templates[phase] : script.source,
            })} /><span aria-hidden="true" />{script.enabled ? "已启用" : "未启用"}</label></div>
          <textarea aria-label={`${phase === "before" ? "前置" : "后置"}脚本源码`} spellCheck={false} value={script.source}
            placeholder={templates[phase]} onChange={(event) => updatePhase(phase, { source: event.target.value })} />
          {phase === "after" && <textarea className="script-phase__response" aria-label="后置脚本调试响应 JSON" spellCheck={false}
            value={afterResponse} placeholder="可选：粘贴主 Tool 响应 JSON；留空时 ctx.response 为 null"
            onChange={(event) => setAfterResponse(event.target.value)} />}
          <footer className="script-phase__footer"><span className={validation === undefined ? "" : validation.valid ? "is-valid" : "is-invalid"}>
            {validation === undefined ? "尚未校验" : validationText(validation)}</span>
            <span className="script-phase__buttons"><button className="ui-button" type="button" disabled={busy !== null || script.source.trim() === ""} onClick={() => void validate(phase)}>
              校验语法</button><button className="ui-button ui-button--primary" type="button" disabled={busy !== null || script.source.trim() === ""} onClick={() => void debug(phase)}>
              <Play size={14} aria-hidden="true" />试运行</button></span></footer>
          {debugResults[phase] !== undefined && <div className="script-debug-result" aria-label={`${phase === "before" ? "前置" : "后置"}脚本试运行结果`}>
            <header><strong>试运行结果</strong><span>{debugResults[phase]!.logs.length} 条日志 · {debugResults[phase]!.stagedEnvironment.length} 个待提交变量</span>
              {phase === "before" && onApplyArguments !== undefined && <button className="ui-button" type="button" onClick={() => onApplyArguments(debugResults[phase]!.arguments)}>应用参数</button>}</header>
            <details open><summary>arguments</summary><pre>{JSON.stringify(debugResults[phase]!.arguments, null, 2)}</pre></details>
            {debugResults[phase]!.logs.length > 0 && <details open><summary>日志</summary><ol>{debugResults[phase]!.logs.map((log, index) => <li key={index}>
              <code>{log.level}</code> {log.message}{log.data === undefined ? null : <pre>{JSON.stringify(log.data, null, 2)}</pre>}</li>)}</ol></details>}
          </div>}
        </section>;
      })}
    </div>
    <details className="script-sdk-reference">
      <summary><CaretRight className="script-disclosure-icon" size={15} weight="bold" aria-hidden="true" /><span>脚本 SDK 与调试参考</span></summary>
      <div>
        <p>脚本使用 ES2022 JavaScript，必须导出默认函数。通过 <code>ctx.log</code> 或 <code>console</code> 输出的内容会出现在调用结果的“脚本流水线”日志中。</p>
        <dl>
          <div><dt><code>ctx.arguments</code></dt><dd>前置脚本读取、设置或删除主 Tool 参数；后置脚本只读。</dd></div>
          <div><dt><code>ctx.tools.call(input)</code></dt><dd>调用辅助 Tool，并返回其 MCP 结果。辅助调用不会再次触发脚本。</dd></div>
          <div><dt><code>ctx.response</code></dt><dd>后置脚本读取主 Tool 的完整响应。</dd></div>
          <div><dt><code>ctx.variables</code></dt><dd>在本次流水线内传递临时 JSON 值。</dd></div>
          <div><dt><code>ctx.env.get/set</code></dt><dd>读取项目或 Server 环境变量；写入仅在整条流水线成功后提交。</dd></div>
          <div><dt><code>ctx.json.get(value, path)</code></dt><dd>使用点号、数组下标路径从辅助 Tool 或主 Tool 响应中取值。</dd></div>
          <div><dt><code>ctx.assert</code></dt><dd>断言条件；失败会终止流水线并保留错误位置。</dd></div>
        </dl>
      </div>
    </details>
    <details className="script-examples">
      <summary><CaretRight className="script-disclosure-icon" size={15} weight="bold" aria-hidden="true" /><span>样例脚本</span><small>5 个可直接应用的前置与后置脚本</small></summary>
      <div className="script-examples__list">
        {scriptExamples.map((example) => <section className="script-example" key={`${example.phase}-${example.title}`}>
          <div className="script-example__copy"><span>{example.phase === "before" ? "前置" : "后置"}</span>
            <h3>{example.title}</h3><p>{example.description}</p></div>
          <pre><code>{example.source}</code></pre>
          <button className="ui-button" type="button" aria-label={`使用样例：${example.title}`} onClick={() => applyExample(example)}>
            <ArrowLineDown size={15} aria-hidden="true" />应用到{example.phase === "before" ? "前置" : "后置"}脚本
          </button>
        </section>)}
      </div>
    </details>
  </div>;
}
