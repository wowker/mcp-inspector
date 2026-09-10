import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { ArrowsClockwise, CheckCircle, FileCode, TerminalWindow } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import type {
  AutomationDraft,
  AutomationDraftDefinition,
  AutomationDraftPage,
  AuthoringApplyResult,
  AuthoringDraftExecutionDetail,
  AuthoringDraftExecutionSummary,
  AuthoringToolCallDetail,
  AuthoringToolCallPage,
  DraftValidationResult,
  InspectorApiClient,
} from "../../api/api-client.js";
import type { AuthoringAppliedAsset } from "../../../shared/authoring/apply.js";
import { InspectorApiError } from "../../api/api-client.js";
import { Button } from "../../components/actions/Button.js";
import { FormField } from "../../components/forms/FormField.js";
import { StatusBadge } from "../../components/feedback/StatusBadge.js";

type WorkspaceView = "drafts" | "calls";
type LoadState = "idle" | "loading" | "ready" | "unauthorized" | "interrupted" | "error";

interface AuthoringWorkspaceProps {
  api: InspectorApiClient;
  projectId: string;
  active: boolean;
  enabled: boolean;
  onOpenAsset(asset: AuthoringAppliedAsset): void;
}

const terminalExecutionStatuses = new Set(["PASSED", "FAILED", "ERROR", "CANCELLED", "INTERRUPTED"]);

function failureState(error: unknown): Exclude<LoadState, "idle" | "loading" | "ready"> {
  if (error instanceof InspectorApiError && error.status === 401) return "unauthorized";
  if (error instanceof DOMException && error.name === "AbortError") return "interrupted";
  return "error";
}

function callBadge(status: string): "idle" | "pending" | "success" | "warning" | "danger" {
  if (status === "SUCCEEDED") return "success";
  if (status === "PENDING" || status === "RUNNING") return "pending";
  if (status === "UNKNOWN") return "warning";
  if (status === "FAILED" || status === "BLOCKED") return "danger";
  return "idle";
}

export function AuthoringWorkspace({ api, projectId, active, enabled, onOpenAsset }: AuthoringWorkspaceProps) {
  const { t } = useTranslation("app");
  const [view, setView] = useState<WorkspaceView>("drafts");
  const [filter, setFilter] = useState("");
  const [drafts, setDrafts] = useState<AutomationDraftPage["items"]>([]);
  const [calls, setCalls] = useState<AuthoringToolCallPage["items"]>([]);
  const [selectedDraft, setSelectedDraft] = useState<AutomationDraft | null>(null);
  const [selectedCall, setSelectedCall] = useState<AuthoringToolCallDetail | null>(null);
  const [goal, setGoal] = useState("");
  const [definitionText, setDefinitionText] = useState("");
  const [validation, setValidation] = useState<DraftValidationResult | null>(null);
  const [state, setState] = useState<LoadState>("idle");
  const [detailState, setDetailState] = useState<LoadState>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [action, setAction] = useState<"validate" | "execute" | "cancel" | "apply" | null>(null);
  const [execution, setExecution] = useState<AuthoringDraftExecutionSummary | AuthoringDraftExecutionDetail | null>(null);
  const [applyResult, setApplyResult] = useState<AuthoringApplyResult | null>(null);
  const loadedProject = useRef<string | null>(null);
  const projectIdRef = useRef(projectId);
  projectIdRef.current = projectId;
  const listRequestSequence = useRef(0);
  const detailRequestSequence = useRef(0);
  const executionRequestSequence = useRef(0);
  const listScroll = useRef<HTMLDivElement>(null);
  const detailScroll = useRef<HTMLDivElement>(null);

  useEffect(() => () => { executionRequestSequence.current += 1; }, []);

  async function loadLists(targetProjectId = projectId): Promise<void> {
    const requestSequence = ++listRequestSequence.current;
    setState("loading");
    setMessage(null);
    try {
      const [draftPage, callPage] = await Promise.all([
        api.listAuthoringDrafts(targetProjectId),
        api.listAuthoringCalls(targetProjectId),
      ]);
      if (targetProjectId !== projectIdRef.current || requestSequence !== listRequestSequence.current) return;
      setDrafts(draftPage.items);
      setCalls(callPage.items);
      setState("ready");
    } catch (error) {
      if (targetProjectId !== projectIdRef.current || requestSequence !== listRequestSequence.current) return;
      setState(failureState(error));
    }
  }

  useEffect(() => {
    if (loadedProject.current !== projectId) {
      loadedProject.current = projectId;
      listRequestSequence.current += 1;
      detailRequestSequence.current += 1;
      setView("drafts");
      setFilter("");
      setDrafts([]);
      setCalls([]);
      setSelectedDraft(null);
      setSelectedCall(null);
      setGoal("");
      setDefinitionText("");
      setValidation(null);
      setExecution(null);
      setApplyResult(null);
      setMessage(null);
      setState("idle");
      setDetailState("idle");
      executionRequestSequence.current += 1;
      if (listScroll.current) listScroll.current.scrollTop = 0;
      if (detailScroll.current) detailScroll.current.scrollTop = 0;
    }
    if (!enabled && state !== "idle") {
      listRequestSequence.current += 1;
      detailRequestSequence.current += 1;
      setDrafts([]);
      setCalls([]);
      setSelectedDraft(null);
      setSelectedCall(null);
      setState("idle");
      setDetailState("idle");
    }
    if (active && enabled && state === "idle") void loadLists(projectId);
  }, [active, enabled, projectId, state]);

  async function openDraft(draftId: string): Promise<void> {
    const targetProjectId = projectId;
    const requestSequence = ++detailRequestSequence.current;
    setDetailState("loading");
    setMessage(null);
    try {
      const draft = await api.getAuthoringDraft(projectId, draftId);
      if (targetProjectId !== projectIdRef.current || requestSequence !== detailRequestSequence.current) return;
      setSelectedDraft(draft);
      setSelectedCall(null);
      setGoal(draft.goal);
      setDefinitionText(JSON.stringify(draft.definition, null, 2));
      setValidation(null);
      setExecution(null);
      setApplyResult(null);
      setDetailState("ready");
    } catch (error) {
      if (targetProjectId !== projectIdRef.current || requestSequence !== detailRequestSequence.current) return;
      setDetailState(failureState(error));
    }
  }

  async function openCall(callId: string): Promise<void> {
    const targetProjectId = projectId;
    const requestSequence = ++detailRequestSequence.current;
    setDetailState("loading");
    setMessage(null);
    try {
      const call = await api.getAuthoringCall(projectId, callId);
      if (targetProjectId !== projectIdRef.current || requestSequence !== detailRequestSequence.current) return;
      setSelectedCall(call);
      setSelectedDraft(null);
      setDetailState("ready");
    } catch (error) {
      if (targetProjectId !== projectIdRef.current || requestSequence !== detailRequestSequence.current) return;
      setDetailState(failureState(error));
    }
  }

  async function saveDraft(): Promise<void> {
    if (selectedDraft === null) return;
    setSaving(true);
    setMessage(null);
    try {
      const definition = JSON.parse(definitionText) as AutomationDraftDefinition;
      const result = await api.replaceAuthoringDraft(projectId, selectedDraft.id, {
        expectedRevision: selectedDraft.revision,
        goal,
        definition,
        idempotencyKey: crypto.randomUUID(),
      });
      setSelectedDraft({ ...selectedDraft, revision: result.revision, goal, definition, definitionDigest: result.definitionDigest });
      setValidation(null);
      setExecution(null);
      setApplyResult(null);
      setDrafts((items) => items.map((item) => item.id === selectedDraft.id
        ? { ...item, revision: result.revision, goal } : item));
      setMessage(t("authoring.workspace.saved"));
    } catch (error) {
      if (error instanceof InspectorApiError && error.status === 409) setMessage(t("authoring.workspace.stale"));
      else if (error instanceof SyntaxError) setMessage(t("authoring.workspace.invalidJson"));
      else setMessage(t("authoring.workspace.saveFailed"));
    } finally {
      setSaving(false);
    }
  }

  async function validateDraft(): Promise<void> {
    if (selectedDraft === null) return;
    setAction("validate"); setMessage(null);
    try {
      const result = await api.validateAuthoringDraft(projectId, selectedDraft.id, selectedDraft.revision);
      setValidation(result);
    } catch {
      setMessage(t("authoring.workspace.validateFailed"));
    } finally { setAction(null); }
  }

  async function executeDraft(): Promise<void> {
    if (selectedDraft === null || validation?.status !== "VALID" ||
        validation.draftRevision !== selectedDraft.revision) return;
    const requestSequence = ++executionRequestSequence.current;
    setAction("execute"); setMessage(null); setApplyResult(null);
    try {
      const started = await api.executeAuthoringDraft(projectId, selectedDraft.id, {
        revision: selectedDraft.revision, validationDigest: validation.validationDigest,
        idempotencyKey: crypto.randomUUID(),
      });
      if (requestSequence !== executionRequestSequence.current) return;
      setExecution(started);
      setAction(null);
      while (!terminalExecutionStatuses.has(started.status) && requestSequence === executionRequestSequence.current) {
        await new Promise((resolve) => setTimeout(resolve, 250));
        const current = await api.getAuthoringDraftExecution(projectId, started.id);
        if (requestSequence !== executionRequestSequence.current) return;
        setExecution(current);
        if (terminalExecutionStatuses.has(current.status)) return;
      }
    } catch {
      if (requestSequence === executionRequestSequence.current) {
        setMessage(t("authoring.workspace.executeFailed")); setAction(null);
      }
    }
  }

  async function cancelExecution(): Promise<void> {
    if (execution === null || terminalExecutionStatuses.has(execution.status)) return;
    setAction("cancel");
    try {
      await api.cancelAuthoringDraftExecution(projectId, execution.id);
      executionRequestSequence.current += 1;
      setExecution(await api.getAuthoringDraftExecution(projectId, execution.id));
    } catch { setMessage(t("authoring.workspace.cancelFailed")); }
    finally { setAction(null); }
  }

  async function applyDraft(): Promise<void> {
    if (selectedDraft === null || validation?.status !== "VALID" ||
        validation.draftRevision !== selectedDraft.revision) return;
    setAction("apply"); setMessage(null);
    try {
      const result = await api.applyAuthoringDraft(projectId, selectedDraft.id, {
        expectedRevision: selectedDraft.revision, validationDigest: validation.validationDigest,
        idempotencyKey: crypto.randomUUID(),
      });
      setApplyResult(result);
      setSelectedDraft({ ...selectedDraft, state: "APPLIED" });
      setDrafts((items) => items.map((item) => item.id === selectedDraft.id ? { ...item, state: "APPLIED" } : item));
      setMessage(t("authoring.workspace.applied"));
    } catch { setMessage(t("authoring.workspace.applyFailed")); }
    finally { setAction(null); }
  }

  function selectView(next: WorkspaceView): void {
    setView(next);
    setSelectedDraft(null);
    setSelectedCall(null);
    setDetailState("idle");
    setMessage(null);
  }

  function navigateViews(event: KeyboardEvent<HTMLButtonElement>, current: WorkspaceView): void {
    const order: WorkspaceView[] = ["drafts", "calls"];
    let index = order.indexOf(current);
    if (event.key === "ArrowRight" || event.key === "ArrowDown") index = (index + 1) % order.length;
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp") index = (index - 1 + order.length) % order.length;
    else if (event.key === "Home") index = 0;
    else if (event.key === "End") index = order.length - 1;
    else return;
    event.preventDefault();
    const next = order[index] ?? "drafts";
    selectView(next);
    queueMicrotask(() => document.getElementById(`authoring-view-${next}`)?.focus());
  }

  if (!enabled) return <div className="authoring-workspace-state" role="status">
    <strong>{t("authoring.workspace.disabledTitle")}</strong><p>{t("authoring.workspace.disabledHint")}</p>
  </div>;
  if (state === "loading" || state === "idle") return <div className="authoring-workspace-state" role="status">{t("authoring.workspace.loading")}</div>;
  if (state !== "ready") return <div className="authoring-workspace-state" role="alert">
    <strong>{t(`authoring.workspace.${state}Title`)}</strong>
    <Button variant="secondary" onClick={() => void loadLists()}><ArrowsClockwise size={16} />{t("authoring.workspace.retry")}</Button>
  </div>;

  const normalizedFilter = filter.trim().toLocaleLowerCase();
  const visibleDrafts = normalizedFilter === "" ? drafts : drafts.filter((draft) =>
    draft.goal.toLocaleLowerCase().includes(normalizedFilter));
  const visibleCalls = normalizedFilter === "" ? calls : calls.filter((call) =>
    call.toolName.toLocaleLowerCase().includes(normalizedFilter) || call.purpose.toLocaleLowerCase().includes(normalizedFilter));
  const items = view === "drafts" ? visibleDrafts : visibleCalls;
  const validatedActionDisabledReason = selectedDraft?.state !== "ACTIVE"
    ? t("authoring.workspace.appliedReadonly")
    : validation?.status === "VALID" ? undefined : t("authoring.workspace.validateFirst");
  return <section className="authoring-workspace" aria-label={t("authoring.workspace.label")}>
    <aside className="authoring-workspace__navigator">
      <div className="authoring-view-tabs" role="tablist" aria-label={t("authoring.workspace.views")}>
        <button id="authoring-view-drafts" type="button" role="tab" aria-selected={view === "drafts"}
          tabIndex={view === "drafts" ? 0 : -1} onClick={() => selectView("drafts")} onKeyDown={(event) => navigateViews(event, "drafts")}>{t("authoring.workspace.drafts")}</button>
        <button id="authoring-view-calls" type="button" role="tab" aria-selected={view === "calls"}
          tabIndex={view === "calls" ? 0 : -1} onClick={() => selectView("calls")} onKeyDown={(event) => navigateViews(event, "calls")}>{t("authoring.workspace.calls")}</button>
      </div>
      <div className="authoring-list-toolbar">
        <span>{t("authoring.workspace.count", { count: items.length })}</span>
        <Button variant="quiet" onClick={() => void loadLists()} aria-label={t("authoring.workspace.refresh")}><ArrowsClockwise size={16} /></Button>
      </div>
      <label className="authoring-filter"><span className="sr-only">{t("authoring.workspace.filter")}</span>
        <input type="search" value={filter} placeholder={t("authoring.workspace.filter")}
          onChange={(event) => setFilter(event.target.value)} /></label>
      <div ref={listScroll} className="authoring-record-list" role="tabpanel" aria-labelledby={`authoring-view-${view}`}>
        {items.length === 0 ? <p className="authoring-empty">{t(view === "drafts" ? "authoring.workspace.noDrafts" : "authoring.workspace.noCalls")}</p> : null}
        {view === "drafts" ? visibleDrafts.map((draft) => <button key={draft.id} type="button"
          className="authoring-record" aria-pressed={selectedDraft?.id === draft.id} onClick={() => void openDraft(draft.id)}>
          <FileCode size={17} aria-hidden="true" />
          <span><strong>{draft.goal || t("authoring.workspace.untitledDraft")}</strong><small>{t("authoring.workspace.draftMeta", { revision: draft.revision, tests: draft.testCaseCount, suites: draft.suiteCount })}</small></span>
          <StatusBadge status={draft.state === "ACTIVE" ? "pending" : "idle"}>{draft.state}</StatusBadge>
        </button>) : visibleCalls.map((call) => <button key={call.callId} type="button"
          className="authoring-record" aria-pressed={selectedCall?.id === call.callId} onClick={() => void openCall(call.callId)}>
          <TerminalWindow size={17} aria-hidden="true" />
          <span><strong>{call.toolName}</strong><small>{call.purpose} · {call.durationMs === null ? "—" : `${call.durationMs} ms`}</small></span>
          <StatusBadge status={callBadge(call.status)}>{call.status}</StatusBadge>
        </button>)}
      </div>
    </aside>

    <div ref={detailScroll} className="authoring-workspace__detail">
      {detailState === "loading" && <div className="authoring-detail-state" role="status">{t("authoring.workspace.loadingDetail")}</div>}
      {detailState !== "loading" && view === "drafts" && selectedDraft === null && <div className="authoring-detail-state" role="status">{t("authoring.workspace.selectDraft")}</div>}
      {detailState !== "loading" && view === "calls" && selectedCall === null && <div className="authoring-detail-state" role="status">{t("authoring.workspace.selectCall")}</div>}
      {detailState !== "loading" && selectedDraft !== null && <div className="authoring-draft-editor">
        <header><div><h2>{t("authoring.workspace.draftTitle")}</h2><p>{selectedDraft.id} · r{selectedDraft.revision}</p></div>
          <div><Button variant="secondary" loading={action === "validate"} disabled={selectedDraft.state !== "ACTIVE"}
            title={selectedDraft.state === "ACTIVE" ? undefined : t("authoring.workspace.appliedReadonly")}
            onClick={() => void validateDraft()}>{t("authoring.workspace.validate")}</Button>
            <Button variant="secondary" loading={action === "execute"} disabled={validation?.status !== "VALID" || selectedDraft.state !== "ACTIVE"}
              title={validatedActionDisabledReason}
              onClick={() => void executeDraft()}>{t("authoring.workspace.execute")}</Button>
            {execution !== null && !terminalExecutionStatuses.has(execution.status) && <Button variant="secondary"
              loading={action === "cancel"} onClick={() => void cancelExecution()}>{t("authoring.workspace.cancel")}</Button>}
            <Button variant="secondary" loading={saving} disabled={selectedDraft.state !== "ACTIVE"}
              onClick={() => void saveDraft()}>{t("authoring.workspace.save")}</Button>
            <Button variant="primary" loading={action === "apply"} disabled={validation?.status !== "VALID" || selectedDraft.state !== "ACTIVE"}
              title={validatedActionDisabledReason}
              onClick={() => void applyDraft()}>{t("authoring.workspace.apply")}</Button></div></header>
        <FormField label={t("authoring.workspace.goal")} htmlFor="authoring-draft-goal">
          <input id="authoring-draft-goal" value={goal} disabled={selectedDraft.state !== "ACTIVE"}
            onChange={(event) => { setGoal(event.target.value); setValidation(null); }} />
        </FormField>
        <FormField label={t("authoring.workspace.definition")} htmlFor="authoring-draft-definition">
          <textarea id="authoring-draft-definition" className="authoring-json-editor" value={definitionText}
            disabled={selectedDraft.state !== "ACTIVE"}
            onChange={(event) => { setDefinitionText(event.target.value); setValidation(null); }} spellCheck={false} />
        </FormField>
        {message && <p className="authoring-inline-message" role="status">{message}</p>}
        {validation && <section className="authoring-validation" aria-label={t("authoring.workspace.validationResult")}>
          <h3><CheckCircle size={17} aria-hidden="true" />{validation.status}</h3>
          {validation.issues.length === 0 ? <p>{t("authoring.workspace.validationPassed")}</p>
            : <ul>{validation.issues.map((issue, index) => <li key={`${issue.code}-${index}`}><code>{issue.path}</code> {issue.message}</li>)}</ul>}
        </section>}
        {execution && <section className="authoring-validation" aria-label={t("authoring.workspace.executionResult")}>
          <h3>{t("authoring.workspace.executionResult")} · {execution.status}</h3>
          {"testCases" in execution && <pre>{JSON.stringify(execution.testCases, null, 2)}</pre>}
        </section>}
        {applyResult && <section className="authoring-validation" aria-label={t("authoring.workspace.applyResult")}>
          <h3>{t("authoring.workspace.applyResult")}</h3>
          <ul>{applyResult.assets.map((asset) => <li key={asset.draftLocalId}>
            <code>{asset.draftLocalId}</code> → <button type="button" className="authoring-asset-link"
              onClick={() => onOpenAsset(asset)}>{asset.formalAssetId} · r{asset.revision}</button>
          </li>)}</ul>
        </section>}
      </div>}
      {detailState !== "loading" && selectedCall !== null && <div className="authoring-call-detail">
        <header><div><h2>{selectedCall.toolName}</h2><p>{selectedCall.id}</p></div><StatusBadge status={callBadge(selectedCall.status)}>{selectedCall.status}</StatusBadge></header>
        <dl><div><dt>{t("authoring.workspace.purpose")}</dt><dd>{selectedCall.purpose}</dd></div>
          <div><dt>{t("authoring.workspace.duration")}</dt><dd>{selectedCall.durationMs === null ? "—" : `${selectedCall.durationMs} ms`}</dd></div></dl>
        <section><h3>{t("authoring.workspace.arguments")}</h3><pre>{JSON.stringify(selectedCall.arguments, null, 2)}</pre></section>
        <section><h3>{t("authoring.workspace.response")}</h3><pre>{JSON.stringify(selectedCall.response, null, 2)}</pre></section>
        {selectedCall.error && <section><h3>{t("authoring.workspace.error")}</h3><pre>{JSON.stringify(selectedCall.error, null, 2)}</pre></section>}
      </div>}
    </div>
  </section>;
}
