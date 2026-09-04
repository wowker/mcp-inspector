import { ArrowDown, ArrowUp, DotsSixVertical, MagnifyingGlass, Play, Plus, Stop, Trash, X } from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import type { InspectorApiClient } from "../../api/api-client.js";
import { jsonValueSchema, type JsonObject } from "../../../shared/tool-definition.js";
import type { ScenarioTestCaseDefinition, TestCaseDefinition, TestCaseSummary } from "../../../shared/testing/test-case.js";
import type { TestSuiteDefinition, TestSuiteSummary } from "../../../shared/testing/test-suite.js";
import type { TestSuiteExecutionDetail } from "../../../shared/testing/test-suite-execution.js";
import { Button } from "../../components/actions/Button.js";
import { StatusBadge } from "../../components/feedback/StatusBadge.js";
import { Dialog } from "../../components/overlays/Dialog.js";
import { ModuleHelpPopover } from "../../components/overlays/ModuleHelpPopover.js";
import { filterSearchableOptions } from "../../components/forms/SearchableSelect.js";

interface Props { api: InspectorApiClient; projectId: string; active?: boolean }
interface Draft { id: string | null; revision: number | null; name: string; description: string; tags: string;
  concurrency: number; stopOnFailure: boolean; members: TestSuiteDefinition["members"] }
const emptyDraft = (): Draft => ({ id: null, revision: null, name: "", description: "", tags: "",
  concurrency: 1, stopOnFailure: false, members: [] });
const terminal = new Set(["PASSED", "FAILED", "ERROR", "CANCELLED", "INTERRUPTED"]);

async function listAllTestCases(api: InspectorApiClient, projectId: string): Promise<TestCaseSummary[]> {
  const items: TestCaseSummary[] = [];
  const seenCursors = new Set<string>();
  let cursor: string | undefined;
  do {
    const page = await api.listTestCases(projectId, { limit: 100, ...(cursor === undefined ? {} : { cursor }) });
    items.push(...page.items);
    if (items.length > 1_000 || (page.nextCursor !== null && seenCursors.has(page.nextCursor))) {
      throw new Error("Invalid test case pagination response");
    }
    cursor = page.nextCursor ?? undefined;
    if (cursor !== undefined) seenCursors.add(cursor);
  } while (cursor !== undefined);
  return items;
}

async function loadScenarioDetails(api: InspectorApiClient, projectId: string,
  testCaseIds: readonly string[]): Promise<TestCaseDefinition[]> {
  const details: TestCaseDefinition[] = [];
  for (let index = 0; index < testCaseIds.length; index += 8) {
    details.push(...await Promise.all(testCaseIds.slice(index, index + 8)
      .map((testCaseId) => api.getTestCase(projectId, testCaseId))));
  }
  return details;
}

export function TestSuitesPage({ api, projectId, active = true }: Props) {
  const { t } = useTranslation("testing");
  const version = useRef(0);
  const detailVersion = useRef(0);
  const executionVersion = useRef(0);
  const [suites, setSuites] = useState<TestSuiteSummary[]>([]);
  const [cases, setCases] = useState<TestCaseSummary[]>([]);
  const [caseDetails, setCaseDetails] = useState<Record<string, TestCaseDefinition>>({});
  const [memberInputs, setMemberInputs] = useState<Record<string, Record<string, string>>>({});
  const [draft, setDraft] = useState<Draft | null>(null);
  const [execution, setExecution] = useState<TestSuiteExecutionDetail | null>(null);
  const [saving, setSaving] = useState(false);
  const [memberQuery, setMemberQuery] = useState("");
  const [draggedMemberId, setDraggedMemberId] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [destructiveOpen, setDestructiveOpen] = useState(false);
  const wasActive = useRef(active);

  const reload = useCallback(() => {
    const current = ++version.current;
    void Promise.all([api.listTestSuites(projectId), listAllTestCases(api, projectId)])
      .then(([suitePage, caseItems]) => { if (version.current === current) { setSuites(suitePage.items); setCases(caseItems); } })
      .catch(() => toast.error(t("suite.loadFailed")));
  }, [api, projectId, t]);
  useEffect(() => {
    setDraft(null); setExecution(null); setCaseDetails({}); setMemberInputs({}); setDeleteOpen(false); setDestructiveOpen(false);
    detailVersion.current += 1; executionVersion.current += 1; reload();
    return () => { version.current += 1; detailVersion.current += 1; executionVersion.current += 1; };
  }, [projectId]);
  useEffect(() => {
    if (active && !wasActive.current) reload();
    wasActive.current = active;
  }, [active, reload]);

  async function select(id: string) {
    const current = ++detailVersion.current;
    executionVersion.current += 1;
    try {
      const value = await api.getTestSuite(projectId, id);
      if (detailVersion.current !== current) return;
      const scenarioIds = new Set(cases.filter(({ kind }) => kind === "scenario").map(({ id: testCaseId }) => testCaseId));
      const details = await loadScenarioDetails(api, projectId,
        value.members.map(({ testCaseId }) => testCaseId).filter((testCaseId) => scenarioIds.has(testCaseId)));
      if (detailVersion.current !== current) return;
      setCaseDetails(Object.fromEntries(details.map((detail) => [detail.id, detail])));
      setMemberInputs(Object.fromEntries(value.members.map((member) => {
        const detail = details.find(({ id: testCaseId }) => testCaseId === member.testCaseId);
        return [member.id, detail?.kind === "scenario" ? Object.fromEntries(detail.inputs.map((input) => [
          input.name, input.defaultValue === undefined ? "" : JSON.stringify(input.defaultValue, null, 2),
        ])) : {}];
      })));
      setDraft({ id: value.id, revision: value.revision, name: value.name, description: value.description,
        tags: value.tags.join(", "), concurrency: value.executionPolicy.concurrency,
        stopOnFailure: value.executionPolicy.stopOnFailure, members: value.members });
      setExecution(null);
    } catch { if (detailVersion.current === current) toast.error(t("suite.loadFailed")); }
  }
  const selected = useMemo(() => new Set(draft?.members.map(({ testCaseId }) => testCaseId) ?? []), [draft?.members]);
  const candidateCases = useMemo(() => {
    const candidates = cases.filter((item) => !selected.has(item.id));
    const byId = new Map(candidates.map((item) => [item.id, item]));
    return filterSearchableOptions(candidates.map((item) => ({
      value: item.id, label: item.name, keywords: [item.description, ...item.tags],
    })), memberQuery).flatMap(({ value }) => {
      const item = byId.get(value);
      return item === undefined ? [] : [item];
    });
  }, [cases, memberQuery, selected]);
  function toggle(testCaseId: string) {
    if (draft === null) return;
    const existing = draft.members.find(({ testCaseId: id }) => id === testCaseId);
    const added = existing === undefined ? { id: crypto.randomUUID(), testCaseId, position: draft.members.length, isEnabled: true } : null;
    const members = added !== null
      ? [...draft.members, added]
      : draft.members.filter(({ testCaseId: id }) => id !== testCaseId)
        .map((member, position) => ({ ...member, position }));
    setDraft({ ...draft, members });
    if (existing !== undefined) {
      setMemberInputs((current) => { const next = { ...current }; delete next[existing.id]; return next; });
      return;
    }
    const summary = cases.find(({ id }) => id === testCaseId);
    if (summary?.kind !== "scenario" || added === null) return;
    const current = detailVersion.current;
    void api.getTestCase(projectId, testCaseId).then((detail) => {
      if (detailVersion.current !== current || detail.kind !== "scenario") return;
      setCaseDetails((values) => ({ ...values, [detail.id]: detail }));
      setMemberInputs((values) => ({ ...values, [added.id]: Object.fromEntries(detail.inputs.map((input) => [
        input.name, input.defaultValue === undefined ? "" : JSON.stringify(input.defaultValue, null, 2),
      ])) }));
    }).catch(() => toast.error(t("suite.loadMemberFailed")));
  }
  function moveMember(memberId: string, targetIndex: number) {
    if (draft === null) return;
    const sourceIndex = draft.members.findIndex(({ id }) => id === memberId);
    if (sourceIndex < 0 || targetIndex < 0 || targetIndex >= draft.members.length || sourceIndex === targetIndex) return;
    const members = [...draft.members];
    const [member] = members.splice(sourceIndex, 1);
    if (member === undefined) return;
    members.splice(targetIndex, 0, member);
    setDraft({ ...draft, members: members.map((item, position) => ({ ...item, position })) });
  }
  async function save() {
    if (draft === null) return;
    if (draft.name.trim() === "") { toast.error(t("suite.requiredName")); return; }
    if (draft.members.length === 0) { toast.error(t("suite.requiredMember")); return; }
    setSaving(true);
    const definition = { name: draft.name.trim(), description: draft.description,
      tags: draft.tags.split(",").map((tag) => tag.trim()).filter(Boolean), members: draft.members,
      executionPolicy: { concurrency: draft.concurrency, stopOnFailure: draft.stopOnFailure } };
    try {
      const saved = draft.id === null
        ? await api.createTestSuite(projectId, definition)
        : await api.updateTestSuite(projectId, draft.id, { revision: draft.revision!, definition });
      await select(saved.id); reload(); toast.success(t("suite.saved"));
    } catch { toast.error(t("suite.saveFailed")); }
    finally { setSaving(false); }
  }
  async function run(confirmDestructive = false) {
    if (draft?.id === null || draft === null) return;
    const inputsByMember: Record<string, JsonObject> = {};
    for (const member of draft.members.filter(({ isEnabled }) => isEnabled)) {
      const detail = caseDetails[member.testCaseId];
      if (detail?.kind !== "scenario") continue;
      const values: JsonObject = {};
      for (const input of detail.inputs) {
        const text = memberInputs[member.id]?.[input.name]?.trim() ?? "";
        if (text === "") {
          if (input.isRequired && input.defaultValue === undefined) {
            toast.error(t("execution.requiredInput", { name: input.name })); return;
          }
          continue;
        }
        try {
          const parsed = jsonValueSchema.safeParse(JSON.parse(text));
          if (!parsed.success) throw new Error("Invalid JSON value");
          values[input.name] = parsed.data;
        } catch { toast.error(t("execution.invalidInput", { name: input.name })); return; }
      }
      if (Object.keys(values).length > 0) inputsByMember[member.id] = values;
    }
    const current = ++executionVersion.current;
    try {
      const request = {
        ...(confirmDestructive ? { confirmDestructive: true } : {}),
        ...(Object.keys(inputsByMember).length > 0 ? { inputsByMember } : {}),
      };
      let value = await api.startTestSuiteExecution(projectId, draft.id, crypto.randomUUID(),
        Object.keys(request).length === 0 ? undefined : request);
      if (executionVersion.current !== current) return;
      setDestructiveOpen(false);
      setExecution(value);
      while (!terminal.has(value.status)) {
        await new Promise((resolve) => setTimeout(resolve, 250));
        if (executionVersion.current !== current) return;
        value = await api.getTestSuiteExecution(projectId, value.id);
        if (executionVersion.current === current) setExecution(value);
      }
    } catch (error) {
      if (executionVersion.current !== current) return;
      if (!confirmDestructive && error instanceof Error && error.message === "Destructive Tool confirmation is required") {
        setDestructiveOpen(true); return;
      }
      toast.error(error instanceof Error ? error.message : t("suite.runFailed"));
    }
  }
  async function cancel() {
    if (execution === null) return;
    const current = ++executionVersion.current;
    try {
      await api.cancelTestSuiteExecution(projectId, execution.id);
      const latest = await api.getTestSuiteExecution(projectId, execution.id);
      if (executionVersion.current === current) setExecution(latest);
    }
    catch { toast.error(t("execution.cancelFailed")); }
  }
  async function remove() {
    if (draft?.id === null || draft === null) return;
    setSaving(true);
    try {
      await api.deleteTestSuite(projectId, draft.id);
      detailVersion.current += 1; executionVersion.current += 1;
      setSuites((current) => current.filter(({ id }) => id !== draft.id));
      setDraft(null); setExecution(null); setDeleteOpen(false); toast.success(t("suite.deleted"));
    } catch { toast.error(t("suite.deleteFailed")); }
    finally { setSaving(false); }
  }
  function createSuite() {
    detailVersion.current += 1; executionVersion.current += 1; setDraft(emptyDraft()); setExecution(null); setCaseDetails({}); setMemberInputs({});
  }

  return <section className="testing-page suite-page" aria-labelledby="suite-page-title">
    <header className="page-heading testing-page__heading testing-page__heading--compact"><div><div className="module-heading-title"><h1 id="suite-page-title">{t("suite.title")}</h1>
      <ModuleHelpPopover moduleName={t("suite.title")} triggerLabel={t("help.suite.trigger")} closeLabel={t("help.suite.close")}
        summary={t("help.suite.summary")} description={t("suite.description")} sections={(["purpose", "configure", "use", "effect"] as const).map((section) => ({
          id: section, title: t(`help.sections.${section}`), items: [t(`help.suite.${section}.one`), t(`help.suite.${section}.two`)],
        }))} /></div><p>{t("suite.description")}</p></div></header>
    <div className="testing-workspace">
      <aside className="testing-case-list" aria-label={t("suite.list")}><header><h2>{t("suite.list")}</h2><span>{suites.length}</span></header>
        <div className="testing-list-create-actions testing-list-create-actions--single"><Button variant="primary" onClick={createSuite}><Plus size={16} />{t("suite.new")}</Button></div>
        {suites.length === 0 ? <p className="testing-list-status">{t("suite.empty")}</p> : <ul>{suites.map((suite) => <li key={suite.id}>
          <button type="button" aria-current={draft?.id === suite.id ? "true" : undefined} onClick={() => void select(suite.id)}>
            <span><strong>{suite.name}</strong><small>{t("suite.memberCount", { count: suite.memberCount })}</small></span></button></li>)}</ul>}
      </aside>
      <div className="testing-editor-shell">{draft === null ? <div className="testing-editor-placeholder"><p>{t("suite.selectHint")}</p></div> : <div className="testing-editor">
        <header className="testing-editor__header"><div><h2>{draft.id === null ? t("suite.new") : draft.name}</h2><p>{t("suite.editorHint")}</p></div>
          <div className="testing-editor__actions">{draft.id !== null && (execution !== null && !terminal.has(execution.status)
            ? <Button variant="danger" onClick={() => void cancel()}><Stop size={15} />{t("execution.cancel")}</Button>
            : <Button variant="primary" onClick={() => void run()}><Play size={15} />{t("suite.run")}</Button>)}
            <Button variant="secondary" loading={saving} onClick={() => void save()}>{t("suite.save")}</Button>
            {draft.id !== null && <Button variant="danger" aria-label={t("suite.delete")} onClick={() => setDeleteOpen(true)}><Trash size={15} />{t("suite.delete")}</Button>}</div></header>
        <section className="testing-editor-section suite-basics"><label>{t("editor.name")}<input className="ui-input" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></label>
          <label>{t("editor.description")}<input className="ui-input" value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} /></label>
          <label>{t("editor.tags")}<input className="ui-input" value={draft.tags} onChange={(e) => setDraft({ ...draft, tags: e.target.value })} /></label>
          <label>{t("suite.concurrency")}<input className="ui-input" type="number" inputMode="numeric" min={1} max={8} step={1}
            value={draft.concurrency} onChange={(event) => {
              const value = Number(event.target.value);
              const concurrency = Number.isFinite(value) ? Math.min(8, Math.max(1, Math.trunc(value))) : 1;
              setDraft({ ...draft, concurrency });
            }} /></label>
          <label className="testing-enabled"><input type="checkbox" checked={draft.stopOnFailure} onChange={(e) => setDraft({ ...draft, stopOnFailure: e.target.checked })} />{t("suite.stopOnFailure")}</label></section>
        <section className="testing-editor-section"><h3>{t("suite.members")}</h3>
          <div className="suite-member-workspace">
            <section className="suite-member-column" aria-label={t("suite.candidates")}><header><h4>{t("suite.candidates")}</h4>
              <label className="suite-member-search"><MagnifyingGlass size={15} aria-hidden="true" /><span className="sr-only">{t("suite.searchMembers")}</span>
                <input className="ui-input" aria-label={t("suite.searchMembers")} value={memberQuery}
                  onChange={(event) => setMemberQuery(event.target.value)} /></label></header>
              {candidateCases.length === 0 ? <p className="testing-empty-copy">{t("suite.noCandidates")}</p> : <ul>{candidateCases.map((item) => <li key={item.id}>
                <span><strong>{item.name}</strong><small>{t(item.kind === "scenario" ? "list.scenario" : "list.tool")}</small></span>
                <Button variant="quiet" aria-label={t("suite.addMember", { name: item.name })} onClick={() => toggle(item.id)}><Plus size={15} aria-hidden="true" />{t("suite.addMember", { name: item.name })}</Button>
              </li>)}</ul>}
            </section>
            <section className="suite-member-column" aria-label={t("suite.selectedMembers")}><header><h4>{t("suite.selectedMembers")}</h4><span>{draft.members.length}</span></header>
              {draft.members.length === 0 ? <p className="testing-empty-copy">{t("suite.noMembers")}</p> : <ol>{draft.members.map((member, index) => {
                const item = cases.find(({ id }) => id === member.testCaseId);
                const detail = caseDetails[member.testCaseId];
                const name = item?.name ?? member.testCaseId;
                return <li key={member.id} draggable aria-label={t("suite.memberAria", { name })}
                  data-dragging={draggedMemberId === member.id || undefined}
                  onDragStart={(event) => { setDraggedMemberId(member.id); event.dataTransfer?.setData("text/plain", member.id); }}
                  onDragEnd={() => setDraggedMemberId(null)} onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => { event.preventDefault(); const sourceId = draggedMemberId ?? event.dataTransfer?.getData("text/plain") ?? "";
                    moveMember(sourceId, index); setDraggedMemberId(null); }}>
                  <div className="suite-member-summary"><span className="suite-member-drag-handle" title={t("suite.dragMember", { name })}>
                    <DotsSixVertical size={16} aria-hidden="true" /></span><label>
                  <input type="checkbox" checked={member.isEnabled} aria-label={t("suite.memberEnabled", { name })}
                    onChange={(event) => setDraft({ ...draft, members: draft.members.map((value) => value.id === member.id ? { ...value, isEnabled: event.target.checked } : value) })} />
                  <span><strong>{name}</strong><small>{item === undefined ? "" : t(item.kind === "scenario" ? "list.scenario" : "list.tool")}</small></span></label>
                  <div className="suite-member-actions"><Button variant="quiet" aria-label={t("suite.moveMemberUp", { name })} disabled={index === 0}
                    onClick={() => moveMember(member.id, index - 1)}><ArrowUp size={15} aria-hidden="true" /></Button>
                    <Button variant="quiet" aria-label={t("suite.moveMemberDown", { name })} disabled={index === draft.members.length - 1}
                      onClick={() => moveMember(member.id, index + 1)}><ArrowDown size={15} aria-hidden="true" /></Button>
                    <Button variant="quiet" aria-label={t("suite.removeMember", { name })} onClick={() => toggle(member.testCaseId)}><X size={15} aria-hidden="true" /></Button></div></div>
                  {detail?.kind === "scenario" && <ScenarioMemberInputs memberId={member.id} definition={detail}
                    values={memberInputs[member.id] ?? {}} onChange={(inputName, value) => setMemberInputs((current) => ({
                      ...current, [member.id]: { ...current[member.id], [inputName]: value },
                    }))} />}
                </li>;
              })}</ol>}
            </section>
          </div>
        </section>
        {execution !== null && <section className="suite-report"><header><h3>{t("suite.report")}</h3><StatusBadge status={execution.status === "PASSED" ? "success" : terminal.has(execution.status) ? "danger" : "pending"}>{t(`execution.status.${execution.status}`)}</StatusBadge></header>
          <ol>{execution.items.map((item) => <li key={item.id}><span>{cases.find(({ id }) => id === item.testCaseId)?.name ?? item.testCaseId}</span><StatusBadge status={item.status === "PASSED" ? "success" : terminal.has(item.status) ? "danger" : "pending"}>{t(`execution.status.${item.status}`)}</StatusBadge></li>)}</ol></section>}
      </div>}</div>
    </div>
    {deleteOpen && <Dialog titleId="suite-delete-title" descriptionId="suite-delete-description" onClose={() => setDeleteOpen(false)} closeDisabled={saving}>
      <div className="testing-delete-dialog"><h2 id="suite-delete-title">{t("suite.deleteTitle")}</h2>
        <p id="suite-delete-description">{t("suite.deleteDescription")}</p><div>
          <Button variant="secondary" onClick={() => setDeleteOpen(false)}>{t("editor.cancel")}</Button>
          <Button variant="danger" loading={saving} onClick={() => void remove()}>{t("suite.deleteConfirm")}</Button>
        </div></div>
    </Dialog>}
    {destructiveOpen && draft !== null && <Dialog titleId="suite-destructive-title" descriptionId="suite-destructive-description" onClose={() => setDestructiveOpen(false)}>
      <div className="testing-delete-dialog"><h2 id="suite-destructive-title">{t("suite.destructiveTitle")}</h2>
        <p id="suite-destructive-description">{t("suite.destructiveDescription", {
          name: draft.name, count: draft.members.filter(({ isEnabled }) => isEnabled).length,
        })}</p><div>
          <Button variant="secondary" onClick={() => setDestructiveOpen(false)}>{t("editor.cancel")}</Button>
          <Button variant="danger" onClick={() => void run(true)}>{t("execution.confirmRun")}</Button>
        </div></div>
    </Dialog>}
  </section>;
}

function ScenarioMemberInputs({ memberId, definition, values, onChange }: {
  memberId: string; definition: ScenarioTestCaseDefinition; values: Record<string, string>;
  onChange: (name: string, value: string) => void;
}) {
  const { t } = useTranslation("testing");
  if (definition.inputs.length === 0) return null;
  return <div className="suite-member-inputs" aria-label={t("suite.memberInputs", { name: definition.name })}>
    {definition.inputs.map((input) => <label key={`${memberId}:${input.name}`}>
      <span>{input.name}{input.isRequired && <span aria-hidden="true"> *</span>}</span>
      {input.description !== "" && <small>{input.description}</small>}
      <textarea className="ui-input" rows={2} value={values[input.name] ?? ""}
        placeholder={t("execution.inputJsonPlaceholder")} onChange={(event) => onChange(input.name, event.target.value)} />
    </label>)}
  </div>;
}
