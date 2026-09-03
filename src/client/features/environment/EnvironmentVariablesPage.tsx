import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { EyeSlash, PencilSimple, Plus, Trash } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { confirmToast } from "../../app/AppToaster.js";
import type { ConnectionSummary, EnvironmentVariable, InspectorApiClient } from "../../api/api-client.js";
import { SearchableSelect } from "../../components/forms/SearchableSelect.js";
import { ModuleHelpPopover } from "../../components/overlays/ModuleHelpPopover.js";
import "./environment-variables.css";

interface Props {
  api: InspectorApiClient;
  projectId: string;
}

type Scope = "project" | "server";
type ValueMode = "text" | "json";
type View = "variables" | "profiles";

const EnvironmentProfilesPanel = lazy(async () => import("./EnvironmentProfilesPanel.js")
  .then((module) => ({ default: module.EnvironmentProfilesPanel })));

function visibleValue(variable: EnvironmentVariable): string {
  return variable.secret ? "••••••••" : JSON.stringify(variable.value);
}

export function EnvironmentVariablesPage({ api, projectId }: Props) {
  const { t, i18n } = useTranslation("environment");
  const loadErrors = useRef({ environment: t("feedback.loadFailed"), server: t("feedback.loadServerFailed") });
  loadErrors.current = { environment: t("feedback.loadFailed"), server: t("feedback.loadServerFailed") };
  const [scope, setScope] = useState<Scope>("project");
  const [view, setView] = useState<View>("variables");
  const [connections, setConnections] = useState<ConnectionSummary[]>([]);
  const [connectionId, setConnectionId] = useState("");
  const [projectVariables, setProjectVariables] = useState<EnvironmentVariable[]>([]);
  const [serverVariables, setServerVariables] = useState<EnvironmentVariable[]>([]);
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const [secret, setSecret] = useState(false);
  const [valueMode, setValueMode] = useState<ValueMode>("text");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    void Promise.all([api.listConnections(projectId), api.listEnvironmentVariables(projectId, null)])
      .then(([loadedConnections, variables]) => {
        if (!active) return;
        const safeConnections = Array.isArray(loadedConnections) ? loadedConnections : [];
        setConnections(safeConnections);
        setConnectionId((current) => safeConnections.some(({ id }) => id === current)
          ? current
          : safeConnections[0]?.id ?? "");
        setProjectVariables(Array.isArray(variables) ? variables : []);
      })
      .catch((error: unknown) => { if (active) toast.error(error instanceof Error ? error.message : loadErrors.current.environment); });
    return () => { active = false; };
  }, [api, projectId]);

  useEffect(() => {
    if (connectionId === "") { setServerVariables([]); return; }
    let active = true;
    void api.listEnvironmentVariables(projectId, connectionId).then((variables) => {
      if (active) setServerVariables(Array.isArray(variables) ? variables : []);
    }).catch((error: unknown) => { if (active) toast.error(error instanceof Error ? error.message : loadErrors.current.server); });
    return () => { active = false; };
  }, [api, connectionId, projectId]);

  const variables = scope === "project" ? projectVariables : serverVariables;
  const projectNames = useMemo(() => new Set(projectVariables.map((item) => item.name)), [projectVariables]);

  function resetEditor(): void {
    setName(""); setValue(""); setSecret(false); setValueMode("text");
  }

  function edit(variable: EnvironmentVariable): void {
    setName(variable.name);
    setSecret(variable.secret);
    setValue(variable.secret ? "" : typeof variable.value === "string" ? variable.value : JSON.stringify(variable.value, null, 2));
    setValueMode(!variable.secret && typeof variable.value !== "string" ? "json" : "text");
  }

  async function save(): Promise<void> {
    const normalizedName = name.trim();
    if (normalizedName === "") { toast.error(t("feedback.nameRequired")); return; }
    if (scope === "server" && connectionId === "") { toast.error(t("feedback.serverRequired")); return; }
    let parsed: unknown = value;
    if (valueMode === "json") {
      try { parsed = JSON.parse(value); } catch { toast.error(t("feedback.invalidJson")); return; }
    }
    setBusy(true);
    try {
      const owner = scope === "server" ? connectionId : null;
      const saved = await api.setEnvironmentVariable(projectId, owner, normalizedName, { value: parsed, secret });
      if (scope === "project") setProjectVariables((items) => [...items.filter((item) => item.name !== saved.name), saved]);
      else setServerVariables((items) => [...items.filter((item) => item.name !== saved.name), saved]);
      resetEditor();
      toast.success(t("feedback.saved"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("feedback.saveFailed"));
    } finally { setBusy(false); }
  }

  function remove(variable: EnvironmentVariable): void {
    confirmToast({
      message: t("feedback.deletePrompt", { name: variable.name }),
      description: t("feedback.deleteDescription"),
      actionLabel: t("feedback.deleteAction"),
      cancelLabel: t("feedback.cancelAction"),
      onAction: () => {
        setBusy(true);
        void api.deleteEnvironmentVariable(projectId, variable.connectionId, variable.name).then(() => {
          if (variable.connectionId === null) setProjectVariables((items) => items.filter(({ id }) => id !== variable.id));
          else setServerVariables((items) => items.filter(({ id }) => id !== variable.id));
          toast.success(t("feedback.deleted"));
        }).catch((error: unknown) => toast.error(error instanceof Error ? error.message : t("feedback.deleteFailed")))
          .finally(() => setBusy(false));
      },
    });
  }

  return <section className="environment-page" aria-labelledby="environment-page-title">
    <header className="page-heading environment-page__heading">
      <div><div className="module-heading-title"><h1 id="environment-page-title">{t("title")}</h1>
        <ModuleHelpPopover moduleName={t("title")} triggerLabel={t("help.trigger")} closeLabel={t("help.close")}
          summary={t("help.summary")} description={t("description")} sections={(["purpose", "configure", "use", "effect"] as const).map((section) => ({
            id: section, title: t(`help.sections.${section}`), items: [t(`help.${section}.one`), t(`help.${section}.two`)],
          }))} /></div><p>{t("description")}</p></div>
    </header>
    <div className="environment-page__view" role="tablist" aria-label={t("view.label")}>
      <button type="button" role="tab" aria-selected={view === "variables"} onClick={() => setView("variables")}>{t("view.variables")}</button>
      <button type="button" role="tab" aria-selected={view === "profiles"} onClick={() => setView("profiles")}>{t("view.profiles")}</button>
    </div>
    {view === "profiles" ? <Suspense fallback={<p className="environment-profiles__empty" role="status">{t("profiles.loading")}</p>}>
      <EnvironmentProfilesPanel api={api} projectId={projectId} connections={connections} />
    </Suspense> : <>
    <div className="environment-page__scope" role="tablist" aria-label={t("scope.label")}>
      <button type="button" role="tab" aria-selected={scope === "project"} onClick={() => setScope("project")}>{t("scope.project")}</button>
      <button type="button" role="tab" aria-selected={scope === "server"} onClick={() => setScope("server")}>{t("scope.server")}</button>
      {scope === "server" && <label>{t("scope.serverLabel")}
        <SearchableSelect ariaLabel={t("scope.selectServer")} value={connectionId || null}
          options={connections.map((connection) => ({ value: connection.id, label: connection.name }))}
          onChange={(nextConnectionId) => setConnectionId(nextConnectionId ?? "")}
          placeholder={t("scope.noServers")} searchPlaceholder={t("scope.searchServer")}
          emptyMessage={t("scope.noMatchingServers")} />
      </label>}
    </div>
    <p className="environment-page__hint">{t("hint.beforeReference")} <code>{"{{VARIABLE_NAME}}"}</code>{t("hint.afterReference")}</p>
    <div className="environment-editor">
      <label>{t("editor.name")}<input className="ui-input" aria-label={t("editor.nameAria")} placeholder={t("editor.namePlaceholder")} value={name} onChange={(event) => setName(event.target.value)} /></label>
      <label>{t("editor.value")}<input className="ui-input" aria-label={t("editor.valueAria")} type={secret ? "password" : "text"} placeholder={secret ? t("editor.secretValuePlaceholder") : t("editor.valuePlaceholder")} value={value} onChange={(event) => setValue(event.target.value)} /></label>
      <label>{t("editor.type")}<select className="ui-input" aria-label={t("editor.typeAria")} value={valueMode} onChange={(event) => setValueMode(event.target.value as ValueMode)}>
        <option value="text">{t("editor.text")}</option><option value="json">{t("editor.json")}</option>
      </select></label>
      <label className="environment-editor__secret"><input type="checkbox" checked={secret} onChange={(event) => setSecret(event.target.checked)} />{t("editor.secret")}</label>
      <button className="ui-button ui-button--primary" type="button" disabled={busy} onClick={() => void save()}><Plus size={15} aria-hidden="true" />{t("editor.save")}</button>
    </div>
    <div className="environment-table-wrap">
      <table className="environment-table"><thead><tr><th>{t("table.name")}</th><th>{t("table.value")}</th><th>{t("table.scope")}</th><th>{t("table.updatedAt")}</th><th><span className="sr-only">{t("table.actions")}</span></th></tr></thead>
        <tbody>{variables.map((variable) => <tr key={variable.id}><th><code>{variable.name}</code>{scope === "server" && projectNames.has(variable.name) && <small>{t("table.overridesProject")}</small>}</th>
          <td><code>{visibleValue(variable)}</code>{variable.secret && <EyeSlash size={15} aria-label={t("table.hiddenSecret")} />}</td>
          <td>{variable.connectionId === null ? t("table.project") : connections.find(({ id }) => id === variable.connectionId)?.name ?? t("table.server")}</td>
          <td>{new Date(variable.updatedAt).toLocaleString(i18n.language)}</td>
          <td><button type="button" aria-label={t("table.edit", { name: variable.name })} onClick={() => edit(variable)}><PencilSimple size={16} /></button>
            <button type="button" aria-label={t("table.delete", { name: variable.name })} disabled={busy} onClick={() => remove(variable)}><Trash size={16} /></button></td></tr>)}</tbody></table>
      {variables.length === 0 && <p className="environment-table__empty">{t("table.empty")}</p>}
    </div>
    </>}
  </section>;
}
