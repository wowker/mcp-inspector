import { useEffect, useMemo, useRef, useState } from "react";
import { EyeSlash, FloppyDisk, Plus, Trash } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import type {
  ConnectionSummary,
  EnvironmentProfile,
  EnvironmentProfilePreview,
  EnvironmentProfileVariable,
  InspectorApiClient,
} from "../../api/api-client.js";
import { confirmToast } from "../../app/AppToaster.js";
import { Button } from "../../components/actions/Button.js";
import { IconButton } from "../../components/actions/IconButton.js";
import { SearchableSelect } from "../../components/forms/SearchableSelect.js";
import { Select } from "../../components/forms/Select.js";
import { jsonValueSchema, type JsonValue } from "../../../shared/tool-definition.js";

interface Props {
  api: InspectorApiClient;
  projectId: string;
  connections: ConnectionSummary[];
}

type Scope = "project" | "server";
type OverrideMode = "value" | "unset";

function profileVariableValue(variable: EnvironmentProfileVariable): string {
  if (variable.mode === "unset") return "—";
  if (variable.secret) return "••••••••";
  return JSON.stringify(variable.value);
}

export function EnvironmentProfilesPanel({ api, projectId, connections }: Props) {
  const { t } = useTranslation("environment");
  const loadError = useRef(t("profiles.feedback.loadFailed"));
  loadError.current = t("profiles.feedback.loadFailed");
  const [profiles, setProfiles] = useState<EnvironmentProfile[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [parentProfileId, setParentProfileId] = useState("");
  const [scope, setScope] = useState<Scope>("project");
  const [connectionId, setConnectionId] = useState("");
  const [variables, setVariables] = useState<EnvironmentProfileVariable[]>([]);
  const [variableName, setVariableName] = useState("");
  const [variableValue, setVariableValue] = useState("");
  const [variableMode, setVariableMode] = useState<OverrideMode>("value");
  const [variableSecret, setVariableSecret] = useState(false);
  const [variableValueMode, setVariableValueMode] = useState<"text" | "json">("text");
  const [candidateProfileId, setCandidateProfileId] = useState("");
  const [activeProfileId, setActiveProfileId] = useState<string | null>(null);
  const [preview, setPreview] = useState<EnvironmentProfilePreview | null>(null);
  const [busy, setBusy] = useState(false);

  const selected = profiles.find(({ id }) => id === selectedId) ?? null;
  const variableOwner = scope === "server" ? connectionId || null : null;

  useEffect(() => {
    let active = true;
    void api.listEnvironmentProfiles(projectId).then((loaded) => {
      if (!active) return;
      setProfiles(loaded);
      setSelectedId((current) => loaded.some(({ id }) => id === current) ? current : loaded[0]?.id ?? "");
    }).catch((error: unknown) => {
      if (active) toast.error(error instanceof Error ? error.message : loadError.current);
    });
    return () => { active = false; };
  }, [api, projectId]);

  useEffect(() => {
    setConnectionId((current) => connections.some(({ id }) => id === current)
      ? current : connections[0]?.id ?? "");
  }, [connections]);

  useEffect(() => {
    if (selected === null) { setName(""); setDescription(""); setParentProfileId(""); return; }
    setName(selected.name); setDescription(selected.description); setParentProfileId(selected.parentProfileId ?? "");
  }, [selected?.id, selected?.revision]);

  useEffect(() => {
    if (selectedId === "" || (scope === "server" && connectionId === "")) {
      setVariables([]); return;
    }
    let active = true;
    void api.listEnvironmentProfileVariables(projectId, selectedId, variableOwner)
      .then((loaded) => { if (active) setVariables(loaded); })
      .catch((error: unknown) => { if (active) toast.error(error instanceof Error ? error.message : loadError.current); });
    return () => { active = false; };
  }, [api, projectId, selectedId, scope, connectionId, variableOwner]);

  useEffect(() => {
    if (connectionId === "") { setActiveProfileId(null); setCandidateProfileId(""); setPreview(null); return; }
    let active = true;
    void api.getConnectionEnvironmentProfile(projectId, connectionId).then((result) => {
      if (!active) return;
      setActiveProfileId(result.profileId);
      setCandidateProfileId(result.profileId ?? "");
      setPreview(result.preview);
    }).catch((error: unknown) => { if (active) toast.error(error instanceof Error ? error.message : loadError.current); });
    return () => { active = false; };
  }, [api, projectId, connectionId]);

  function newProfile(): void {
    setSelectedId(""); setName(""); setDescription(""); setParentProfileId(""); setVariables([]);
  }

  async function saveProfile(): Promise<void> {
    if (name.trim() === "") { toast.error(t("profiles.feedback.nameRequired")); return; }
    setBusy(true);
    try {
      const mutation = { name: name.trim(), description: description.trim(), parentProfileId: parentProfileId || null };
      const saved = selected === null
        ? await api.createEnvironmentProfile(projectId, mutation)
        : await api.updateEnvironmentProfile(projectId, selected.id, { ...mutation, revision: selected.revision });
      setProfiles((current) => [...current.filter(({ id }) => id !== saved.id), saved]
        .sort((left, right) => left.name.localeCompare(right.name)));
      setSelectedId(saved.id);
      toast.success(t("profiles.feedback.saved"));
    } catch (error) { toast.error(error instanceof Error ? error.message : t("profiles.feedback.saveFailed")); }
    finally { setBusy(false); }
  }

  function removeProfile(): void {
    if (selected === null) return;
    confirmToast({
      message: t("profiles.feedback.deletePrompt", { name: selected.name }),
      description: t("profiles.feedback.deleteDescription"),
      actionLabel: t("feedback.deleteAction"), cancelLabel: t("feedback.cancelAction"),
      onAction: () => {
        setBusy(true);
        void api.deleteEnvironmentProfile(projectId, selected.id).then(() => {
          setProfiles((current) => current.filter(({ id }) => id !== selected.id));
          setSelectedId(""); toast.success(t("profiles.feedback.deleted"));
        }).catch((error: unknown) => toast.error(error instanceof Error ? error.message : t("profiles.feedback.deleteFailed")))
          .finally(() => setBusy(false));
      },
    });
  }

  async function saveVariable(): Promise<void> {
    if (selectedId === "" || variableName.trim() === "") { toast.error(t("feedback.nameRequired")); return; }
    if (scope === "server" && connectionId === "") { toast.error(t("feedback.serverRequired")); return; }
    let parsedValue: JsonValue = variableValue;
    if (variableMode === "value" && variableValueMode === "json") {
      try {
        const parsed = jsonValueSchema.safeParse(JSON.parse(variableValue));
        if (!parsed.success) throw new Error();
        parsedValue = parsed.data;
      } catch { toast.error(t("feedback.invalidJson")); return; }
    }
    setBusy(true);
    try {
      const input = variableMode === "unset"
        ? { mode: "unset" as const }
        : { mode: "value" as const, value: parsedValue, secret: variableSecret };
      const saved = await api.setEnvironmentProfileVariable(
        projectId, selectedId, variableOwner, variableName.trim(), input,
      );
      setVariables((current) => [...current.filter(({ id }) => id !== saved.id), saved]
        .sort((left, right) => left.name.localeCompare(right.name)));
      setVariableName(""); setVariableValue(""); setVariableSecret(false); setVariableValueMode("text");
      toast.success(t("profiles.feedback.overrideSaved"));
    } catch (error) { toast.error(error instanceof Error ? error.message : t("profiles.feedback.saveFailed")); }
    finally { setBusy(false); }
  }

  async function loadPreview(): Promise<void> {
    if (connectionId === "") { toast.error(t("feedback.serverRequired")); return; }
    setBusy(true);
    try {
      setPreview(await api.previewConnectionEnvironmentProfile(projectId, connectionId, candidateProfileId || null));
    } catch (error) { toast.error(error instanceof Error ? error.message : t("profiles.feedback.previewFailed")); }
    finally { setBusy(false); }
  }

  async function activate(): Promise<void> {
    if (connectionId === "") { toast.error(t("feedback.serverRequired")); return; }
    setBusy(true);
    try {
      const result = await api.setConnectionEnvironmentProfile(projectId, connectionId, candidateProfileId || null);
      setActiveProfileId(result.profileId); setPreview(result.preview);
      toast.success(t("profiles.feedback.activated"));
    } catch (error) { toast.error(error instanceof Error ? error.message : t("profiles.feedback.activateFailed")); }
    finally { setBusy(false); }
  }

  const profileById = useMemo(() => new Map(profiles.map((profile) => [profile.id, profile])), [profiles]);

  return <div className="environment-profiles">
    <aside className="environment-profiles__rail" aria-label={t("profiles.listLabel")}>
      <div className="environment-profiles__rail-heading"><strong>{t("profiles.listTitle")}</strong>
        <IconButton label={t("profiles.new")} icon={<Plus size={17} />} onClick={newProfile} /></div>
      <button type="button" className="environment-profile-row" data-selected={selectedId === ""} onClick={newProfile}>
        <Plus size={16} aria-hidden="true" /><span>{t("profiles.new")}</span>
      </button>
      {profiles.map((profile) => <button key={profile.id} type="button" className="environment-profile-row"
        data-selected={selectedId === profile.id} onClick={() => setSelectedId(profile.id)}>
        <span>{profile.name}</span>{profile.parentProfileId !== null && <small>{t("profiles.inherits", { name: profileById.get(profile.parentProfileId)?.name ?? "—" })}</small>}
      </button>)}
      {profiles.length === 0 && <p className="environment-profiles__empty">{t("profiles.empty")}</p>}
    </aside>

    <div className="environment-profiles__main">
      <section className="environment-profile-section" aria-labelledby="profile-details-title">
        <div className="environment-profile-section__heading"><div><h2 id="profile-details-title">{selected === null ? t("profiles.createTitle") : t("profiles.editTitle")}</h2><p>{t("profiles.detailsHint")}</p></div>
          <div className="environment-profile-actions"><Button variant="primary" loading={busy} onClick={() => void saveProfile()}><FloppyDisk size={16} />{t("profiles.save")}</Button>
            {selected !== null && <Button variant="danger" disabled={busy} onClick={removeProfile}><Trash size={16} />{t("profiles.delete")}</Button>}</div></div>
        <div className="environment-profile-form">
          <label>{t("profiles.name")}<input className="ui-input" value={name} onChange={(event) => setName(event.target.value)} /></label>
          <label>{t("profiles.parent")}<SearchableSelect value={parentProfileId || null}
            options={profiles.filter(({ id }) => id !== selectedId).map((profile) => ({ value: profile.id, label: profile.name }))}
            onChange={(nextProfileId) => setParentProfileId(nextProfileId ?? "")} clearable
            placeholder={t("profiles.noParent")} searchPlaceholder={t("profiles.searchProfile")}
            emptyMessage={t("profiles.noMatchingProfiles")} clearLabel={t("profiles.clearParent")} /></label>
          <label className="environment-profile-form__description">{t("profiles.description")}<textarea className="ui-input" value={description} onChange={(event) => setDescription(event.target.value)} /></label>
        </div>
      </section>

      {selected !== null && <section className="environment-profile-section" aria-labelledby="profile-overrides-title">
        <div className="environment-profile-section__heading"><div><h2 id="profile-overrides-title">{t("profiles.overridesTitle")}</h2><p>{t("profiles.overridesHint")}</p></div></div>
        <div className="environment-profile-toolbar" role="group" aria-label={t("profiles.scopeLabel")}>
          <button type="button" data-selected={scope === "project"} onClick={() => setScope("project")}>{t("scope.project")}</button>
          <button type="button" data-selected={scope === "server"} onClick={() => setScope("server")}>{t("scope.server")}</button>
          {scope === "server" && <SearchableSelect ariaLabel={t("scope.selectServer")} value={connectionId || null}
            options={connections.map((connection) => ({ value: connection.id, label: connection.name }))}
            onChange={(nextConnectionId) => setConnectionId(nextConnectionId ?? "")}
            placeholder={t("scope.noServers")} searchPlaceholder={t("scope.searchServer")}
            emptyMessage={t("scope.noMatchingServers")} />}
        </div>
        <div className="environment-profile-variable-editor">
          <label>{t("editor.name")}<input className="ui-input" value={variableName} onChange={(event) => setVariableName(event.target.value)} /></label>
          <label>{t("profiles.mode")}<Select value={variableMode} onChange={(event) => setVariableMode(event.target.value as OverrideMode)}><option value="value">{t("profiles.modeValue")}</option><option value="unset">{t("profiles.modeUnset")}</option></Select></label>
          <label>{t("editor.type")}<Select disabled={variableMode === "unset"} value={variableValueMode} onChange={(event) => setVariableValueMode(event.target.value as "text" | "json")}><option value="text">{t("editor.text")}</option><option value="json">{t("editor.json")}</option></Select></label>
          <label>{t("editor.value")}<input className="ui-input" disabled={variableMode === "unset"} type={variableSecret ? "password" : "text"} value={variableValue} onChange={(event) => setVariableValue(event.target.value)} /></label>
          <label className="environment-editor__secret"><input type="checkbox" disabled={variableMode === "unset"} checked={variableSecret} onChange={(event) => setVariableSecret(event.target.checked)} />{t("editor.secret")}</label>
          <Button variant="secondary" disabled={busy} onClick={() => void saveVariable()}><Plus size={16} />{t("profiles.saveOverride")}</Button>
        </div>
        <div className="environment-profile-variable-list">{variables.map((variable) => <div key={variable.id} className="environment-profile-variable-row">
          <code>{variable.name}</code><span>{variable.mode === "unset" ? t("profiles.unsetBadge") : profileVariableValue(variable)}</span>
          {variable.secret && <EyeSlash size={15} aria-label={t("table.hiddenSecret")} />}
          <IconButton label={t("table.delete", { name: variable.name })} icon={<Trash size={16} />} disabled={busy}
            onClick={() => void api.deleteEnvironmentProfileVariable(projectId, selectedId, variableOwner, variable.name).then(() => setVariables((items) => items.filter(({ id }) => id !== variable.id))).catch((error: unknown) => toast.error(error instanceof Error ? error.message : t("feedback.deleteFailed")))} />
        </div>)}{variables.length === 0 && <p className="environment-profiles__empty">{t("profiles.overridesEmpty")}</p>}</div>
      </section>}

      <section className="environment-profile-section" aria-labelledby="profile-preview-title">
        <div className="environment-profile-section__heading"><div><h2 id="profile-preview-title">{t("profiles.previewTitle")}</h2><p>{t("profiles.previewHint")}</p></div></div>
        <div className="environment-profile-preview-controls">
          <SearchableSelect ariaLabel={t("scope.selectServer")} value={connectionId || null}
            options={connections.map((connection) => ({ value: connection.id, label: connection.name }))}
            onChange={(nextConnectionId) => setConnectionId(nextConnectionId ?? "")}
            placeholder={t("scope.noServers")} searchPlaceholder={t("scope.searchServer")}
            emptyMessage={t("scope.noMatchingServers")} />
          <SearchableSelect ariaLabel={t("profiles.previewProfile")} value={candidateProfileId || null}
            options={profiles.map((profile) => ({ value: profile.id, label: profile.name }))}
            onChange={(nextProfileId) => setCandidateProfileId(nextProfileId ?? "")} clearable
            placeholder={t("profiles.baseVariables")} searchPlaceholder={t("profiles.searchProfile")}
            emptyMessage={t("profiles.noMatchingProfiles")} clearLabel={t("profiles.clearPreviewProfile")} />
          <Button disabled={busy || connectionId === ""} onClick={() => void loadPreview()}>{t("profiles.preview")}</Button>
          <Button variant="primary" disabled={busy || connectionId === "" || (connections.find(({ id }) => id === connectionId)?.status === "connected")} onClick={() => void activate()}>{t("profiles.activate")}</Button>
          <span className="environment-profile-active">{t("profiles.active", { name: activeProfileId === null ? t("profiles.baseVariables") : profileById.get(activeProfileId)?.name ?? "—" })}</span>
        </div>
        {preview !== null && <div className="environment-profile-preview">
          <p>{t("profiles.chain")}: {preview.chain.length === 0 ? t("profiles.baseVariables") : preview.chain.map(({ name }) => name).join(" → ")}</p>
          {preview.references.length > 0 && <div className="environment-profile-references" aria-label={t("profiles.referencesTitle")}>
            {preview.references.map((reference) => <div key={reference.location} data-missing={reference.missing.length > 0}>
              <strong>{reference.location}</strong><span>{reference.variables.join(", ")}</span>
              <small>{reference.missing.length === 0 ? t("profiles.resolved") : t("profiles.missing", { names: reference.missing.join(", ") })}</small>
            </div>)}
          </div>}
          <table className="environment-table"><thead><tr><th>{t("table.name")}</th><th>{t("table.value")}</th><th>{t("table.scope")}</th><th>{t("profiles.source")}</th></tr></thead>
            <tbody>{preview.variables.map((variable) => <tr key={`${variable.scope}:${variable.name}`}><th><code>{variable.name}</code></th><td><code>{variable.secret ? "••••••••" : JSON.stringify(variable.value)}</code></td><td>{variable.scope === "project" ? t("table.project") : t("table.server")}</td><td>{variable.source === "base" ? t("profiles.baseVariables") : profileById.get(variable.sourceProfileId ?? "")?.name ?? t("profiles.profileSource")}</td></tr>)}</tbody></table>
          {preview.variables.length === 0 && <p className="environment-profiles__empty">{t("profiles.previewEmpty")}</p>}
        </div>}
      </section>
    </div>
  </div>;
}
