import { useEffect, useRef, useState, type FormEvent } from "react";
import { ShieldCheck, Warning, X } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import type {
  CatalogToolSummary,
  ConnectionAuthoringPolicy,
  ConnectionSummary,
  InspectorApiClient,
} from "../../api/api-client.js";
import type { AuthoringAccessMode } from "../../../shared/authoring/policy.js";
import { Disclosure } from "../../components/layout/Disclosure.js";
import { SearchableSelect } from "../../components/forms/SearchableSelect.js";
import { Select } from "../../components/forms/Select.js";
import { Dialog } from "../../components/overlays/Dialog.js";

interface AuthoringPolicyDialogProps {
  api: InspectorApiClient;
  projectId: string;
  connection: ConnectionSummary;
  onClose: () => void;
}

function message(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export function AuthoringPolicyDialog({ api, projectId, connection, onClose }: AuthoringPolicyDialogProps) {
  const { t } = useTranslation("servers");
  const closeButton = useRef<HTMLButtonElement>(null);
  const [policy, setPolicy] = useState<ConnectionAuthoringPolicy | null>(null);
  const [tools, setTools] = useState<CatalogToolSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [fullAccessConfirmed, setFullAccessConfirmed] = useState(false);

  useEffect(() => {
    let active = true;
    void Promise.all([
      api.getAuthoringPolicy(projectId, connection.id),
      api.listTools(projectId, connection.id),
    ]).then(([loadedPolicy, loadedTools]) => {
      if (!active) return;
      setPolicy(loadedPolicy);
      setTools(loadedTools.filter((tool) => tool.status !== "removed"));
    }).catch((cause: unknown) => {
      if (active) setError(message(cause, t("authoring.errors.load")));
    });
    return () => { active = false; };
  }, [api, connection.id, projectId, t]);

  function update(patch: Partial<ConnectionAuthoringPolicy>): void {
    setPolicy((current) => current === null ? null : { ...current, ...patch });
  }

  function addTool(list: "allowedTools" | "deniedTools", toolName: string | null): void {
    if (toolName === null || policy === null) return;
    update({ [list]: [...new Set([...policy[list], toolName])].sort() });
  }

  async function save(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (policy === null || (policy.mode === "FULL_ACCESS" && !fullAccessConfirmed)) return;
    setSaving(true);
    setError(null);
    try {
      await api.replaceAuthoringPolicy(projectId, connection.id, {
        expectedRevision: policy.revision,
        mode: policy.mode,
        allowedTools: policy.allowedTools,
        deniedTools: policy.deniedTools,
        requireCleanupForDraftMutations: policy.requireCleanupForDraftMutations,
        maxCallsPerMinute: policy.maxCallsPerMinute,
        maxConcurrentCalls: policy.maxConcurrentCalls,
        maxCallDurationMs: policy.maxCallDurationMs,
      });
      onClose();
    } catch (cause) {
      setError(message(cause, t("authoring.errors.save")));
      setSaving(false);
    }
  }

  const toolOptions = tools.map((tool) => ({ value: tool.name, label: tool.name,
    description: tool.currentSnapshot.definition.description }));
  const selectable = (list: "allowedTools" | "deniedTools") => toolOptions.filter((option) => !policy?.[list].includes(option.value));
  const showAllowed = policy?.mode === "READ_ONLY" || policy?.mode === "CUSTOM";

  return <Dialog titleId="authoring-policy-title" descriptionId="authoring-policy-description"
    initialFocusRef={closeButton} onClose={onClose} closeDisabled={saving} className="authoring-policy-dialog">
    <div className="dialog-header">
      <div>
        <p className="dialog-kicker"><ShieldCheck size={15} aria-hidden="true" /> AUTHORING MCP</p>
        <h3 id="authoring-policy-title">{t("authoring.title")}</h3>
        <p id="authoring-policy-description">{t("authoring.description", { name: connection.name })}</p>
      </div>
      <button ref={closeButton} type="button" className="dialog-close" aria-label={t("authoring.close")}
        disabled={saving} onClick={onClose}><X size={18} aria-hidden="true" /></button>
    </div>
    <form className="authoring-policy-form" onSubmit={(event) => void save(event)}>
      {error !== null && <p role="alert" className="connection-error dialog-error">{error}</p>}
      {policy === null && error === null ? <p role="status" className="authoring-policy-loading">{t("authoring.loading")}</p> : policy !== null && <>
        <div className="authoring-policy-mode">
          <label htmlFor="authoring-policy-mode">{t("authoring.mode.label")}</label>
          <Select id="authoring-policy-mode" value={policy.mode} onChange={(event) => {
            const mode = event.target.value as AuthoringAccessMode;
            update({ mode });
            setFullAccessConfirmed(false);
          }}>
            {(["DISABLED", "READ_ONLY", "CUSTOM", "FULL_ACCESS"] as const).map((mode) =>
              <option value={mode} key={mode}>{t(`authoring.mode.${mode}`)}</option>)}
          </Select>
          <small>{t(`authoring.modeDescription.${policy.mode}`)}</small>
        </div>

        {showAllowed && <Disclosure label={t("authoring.allowed.title")} defaultExpanded>
          <SearchableSelect value={null} onChange={(value) => addTool("allowedTools", value)}
            options={selectable("allowedTools")} ariaLabel={t("authoring.allowed.add")}
            placeholder={t("authoring.allowed.add")} searchPlaceholder={t("authoring.search")}
            emptyMessage={t("authoring.noTools")} />
          <ul className="authoring-tool-list">{policy.allowedTools.map((toolName) => <li key={toolName}>
            <code>{toolName}</code><button type="button" className="button-secondary"
              aria-label={t("authoring.allowed.remove", { name: toolName })}
              onClick={() => update({ allowedTools: policy.allowedTools.filter((name) => name !== toolName) })}>{t("authoring.remove")}</button>
          </li>)}</ul>
        </Disclosure>}

        {policy.mode === "CUSTOM" && <Disclosure label={t("authoring.denied.title")}>
          <SearchableSelect value={null} onChange={(value) => addTool("deniedTools", value)}
            options={selectable("deniedTools")} ariaLabel={t("authoring.denied.add")}
            placeholder={t("authoring.denied.add")} searchPlaceholder={t("authoring.search")}
            emptyMessage={t("authoring.noTools")} />
          <ul className="authoring-tool-list">{policy.deniedTools.map((toolName) => <li key={toolName}>
            <code>{toolName}</code><button type="button" className="button-secondary"
              aria-label={t("authoring.denied.remove", { name: toolName })}
              onClick={() => update({ deniedTools: policy.deniedTools.filter((name) => name !== toolName) })}>{t("authoring.remove")}</button>
          </li>)}</ul>
        </Disclosure>}

        {policy.mode === "FULL_ACCESS" && <label className="authoring-full-access-warning">
          <Warning size={20} weight="fill" aria-hidden="true" />
          <span><strong>{t("authoring.fullAccess.title")}</strong>
            <small>{t("authoring.fullAccess.warning", { name: connection.name })}</small>
            <span><input type="checkbox" checked={fullAccessConfirmed}
              onChange={(event) => setFullAccessConfirmed(event.target.checked)} />{t("authoring.fullAccess.confirm")}</span>
          </span>
        </label>}

        <Disclosure label={t("authoring.limits.title")}>
          <div className="authoring-policy-limits">
            <label>{t("authoring.limits.callsPerMinute")}<input type="number" min={1} max={600} value={policy.maxCallsPerMinute}
              onChange={(event) => update({ maxCallsPerMinute: Number(event.target.value) })} /></label>
            <label>{t("authoring.limits.concurrentCalls")}<input type="number" min={1} max={2} value={policy.maxConcurrentCalls}
              onChange={(event) => update({ maxConcurrentCalls: Number(event.target.value) })} /></label>
            <label>{t("authoring.limits.duration")}<input type="number" min={100} max={600000} value={policy.maxCallDurationMs}
              onChange={(event) => update({ maxCallDurationMs: Number(event.target.value) })} /></label>
          </div>
          <label className="authoring-cleanup-option"><input type="checkbox" checked={policy.requireCleanupForDraftMutations}
            onChange={(event) => update({ requireCleanupForDraftMutations: event.target.checked })} />
          {t("authoring.limits.requireCleanup")}</label>
        </Disclosure>
      </>}
      <div className="dialog-actions">
        <button type="button" className="button-secondary" disabled={saving} onClick={onClose}>{t("authoring.cancel")}</button>
        <button type="submit" disabled={saving || policy === null || (policy.mode === "FULL_ACCESS" && !fullAccessConfirmed)}>
          {saving ? t("authoring.saving") : t("authoring.save")}
        </button>
      </div>
    </form>
  </Dialog>;
}
