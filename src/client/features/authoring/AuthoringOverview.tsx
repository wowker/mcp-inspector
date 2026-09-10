import { useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle, Copy, FileCode, Key, MagnifyingGlass, ShieldCheck, TerminalWindow } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import type {
  CatalogToolSummary,
  ConnectionAuthoringPolicy,
  ConnectionSummary,
  InspectorApiClient,
  AuthoringSettingsStatus,
} from "../../api/api-client.js";
import { authoringPolicyAllowsTool } from "../../../shared/authoring/policy.js";
import { Button } from "../../components/actions/Button.js";
import { StatusBadge } from "../../components/feedback/StatusBadge.js";
import { Select } from "../../components/forms/Select.js";
import { AuthoringPolicyDialog } from "../connections/AuthoringPolicyDialog.js";

interface AuthoringOverviewProps {
  api: InspectorApiClient;
  projectId: string;
  active: boolean;
  settings: AuthoringSettingsStatus;
  endpoint: string;
  clientConfig: string;
  issuedToken: string | null;
  onCopy(value: string): Promise<void>;
}

type OverviewState = "idle" | "loading" | "ready" | "error";

export function AuthoringOverview({ api, projectId, active, settings, endpoint, clientConfig,
  issuedToken, onCopy }: AuthoringOverviewProps) {
  const { t } = useTranslation("app");
  const [state, setState] = useState<OverviewState>("idle");
  const [connections, setConnections] = useState<ConnectionSummary[]>([]);
  const [policies, setPolicies] = useState<ConnectionAuthoringPolicy[]>([]);
  const [tools, setTools] = useState<CatalogToolSummary[]>([]);
  const [toolState, setToolState] = useState<OverviewState>("idle");
  const [selectedConnectionId, setSelectedConnectionId] = useState("");
  const [filter, setFilter] = useState("");
  const [draftCount, setDraftCount] = useState(0);
  const [callCount, setCallCount] = useState(0);
  const [editingPolicy, setEditingPolicy] = useState(false);
  const projectRef = useRef(projectId);
  const requestSequence = useRef(0);
  projectRef.current = projectId;

  async function loadOverview(targetProjectId = projectId): Promise<void> {
    const sequence = ++requestSequence.current;
    setState("loading");
    try {
      const [loadedConnections, draftPage, callPage] = await Promise.all([
        api.listConnections(targetProjectId),
        api.listAuthoringDrafts(targetProjectId),
        api.listAuthoringCalls(targetProjectId),
      ]);
      const policyResults = await Promise.all(loadedConnections.map((connection) =>
        api.getAuthoringPolicy(targetProjectId, connection.id)));
      const loadedPolicies = policyResults.filter((policy): policy is ConnectionAuthoringPolicy => policy !== undefined);
      if (projectRef.current !== targetProjectId || sequence !== requestSequence.current) return;
      setConnections(loadedConnections);
      setPolicies(loadedPolicies);
      setDraftCount(draftPage.items.length);
      setCallCount(callPage.items.length);
      setSelectedConnectionId((current) => loadedConnections.some(({ id }) => id === current)
        ? current : loadedConnections[0]?.id ?? "");
      setState("ready");
    } catch {
      if (projectRef.current === targetProjectId && sequence === requestSequence.current) setState("error");
    }
  }

  useEffect(() => {
    requestSequence.current += 1;
    setConnections([]);
    setPolicies([]);
    setTools([]);
    setToolState("idle");
    setSelectedConnectionId("");
    setFilter("");
    setDraftCount(0);
    setCallCount(0);
    setState("idle");
  }, [projectId]);

  useEffect(() => {
    if (active && state === "idle") void loadOverview(projectId);
  }, [active, projectId, state]);

  useEffect(() => {
    let current = true;
    setTools([]);
    setToolState(selectedConnectionId === "" ? "idle" : "loading");
    if (selectedConnectionId === "") return () => { current = false; };
    void api.listTools(projectId, selectedConnectionId).then((loadedTools) => {
      if (current && projectRef.current === projectId) {
        setTools(loadedTools.filter(({ status }) => status !== "removed"));
        setToolState("ready");
      }
    }).catch(() => { if (current) { setTools([]); setToolState("error"); } });
    return () => { current = false; };
  }, [api, projectId, selectedConnectionId]);

  const selectedConnection = connections.find(({ id }) => id === selectedConnectionId) ?? null;
  const selectedPolicy = policies.find(({ connectionId }) => connectionId === selectedConnectionId) ?? null;
  const authorizedTools = selectedPolicy === null ? [] : tools.filter(({ name }) =>
    authoringPolicyAllowsTool(selectedPolicy, name));
  const normalizedFilter = filter.trim().toLocaleLowerCase();
  const visibleTools = useMemo(() => normalizedFilter === "" ? tools : tools.filter((tool) =>
    tool.name.toLocaleLowerCase().includes(normalizedFilter) ||
    (tool.currentSnapshot.definition.description ?? "").toLocaleLowerCase().includes(normalizedFilter)),
  [normalizedFilter, tools]);
  const activePolicyCount = policies.filter(({ mode }) => mode !== "DISABLED").length;

  return <section className="authoring-overview" aria-label={t("authoring.overview.label")}>
    <div className="authoring-overview__cards">
      <section className="authoring-overview-card authoring-overview-card--endpoint">
        <header><div><p className="authoring-overview-card__eyebrow">{t("authoring.overview.endpointEyebrow")}</p>
          <h2>{t("authoring.overview.endpointTitle")}</h2></div></header>
        <p>{t("authoring.overview.endpointHint")}</p>
        <div className="authoring-overview-copy"><input aria-label={t("authoring.endpoint")} value={endpoint} readOnly /><Button variant="quiet"
          aria-label={t("authoring.copyEndpoint")} onClick={() => void onCopy(endpoint)}><Copy size={16} /></Button></div>
        <dl className="authoring-overview-meta">
          <div><dt>{t("authoring.overview.authentication")}</dt><dd><Key size={15} />Bearer Token</dd></div>
          <div><dt>{t("authoring.overview.network")}</dt><dd>127.0.0.1</dd></div>
          <div><dt>{t("authoring.overview.tokenState")}</dt><dd>{settings.configured ? settings.tokenHint : t("authoring.overview.notConfigured")}</dd></div>
        </dl>
      </section>

      <section className="authoring-overview-card authoring-overview-card--config">
        <header><div><p className="authoring-overview-card__eyebrow">{t("authoring.overview.clientEyebrow")}</p>
          <h2>{t("authoring.clientConfig")}</h2></div>
          <Button variant="secondary" onClick={() => void onCopy(clientConfig)}><Copy size={16} />{t("authoring.copyConfig")}</Button></header>
        <p>{t("authoring.overview.clientHint")}</p>
        <pre tabIndex={0} aria-label={t("authoring.clientConfig")}><code>{clientConfig}</code></pre>
      </section>
    </div>

    {issuedToken !== null && <div className="authoring-token" role="status"><Key size={18} aria-hidden="true" /><div>
      <strong>{t("authoring.tokenTitle")}</strong><p>{t("authoring.tokenWarning")}</p><code>{issuedToken}</code></div>
      <Button variant="secondary" onClick={() => void onCopy(issuedToken)}><Copy size={16} />{t("authoring.copyToken")}</Button></div>}

    {state === "loading" || state === "idle" ? <div className="authoring-overview-state" role="status">{t("authoring.overview.loading")}</div>
      : state === "error" ? <div className="authoring-overview-state" role="alert"><span>{t("authoring.overview.error")}</span>
        <Button variant="secondary" onClick={() => void loadOverview()}>{t("authoring.retry")}</Button></div>
      : <div className="authoring-overview__lower">
        <section className="authoring-tool-access">
          <header><div><p className="authoring-overview-card__eyebrow">{t("authoring.overview.policyEyebrow")}</p>
            <h2>{t("authoring.overview.policyTitle")}</h2></div>
            {selectedConnection !== null && <Button variant="secondary" onClick={() => setEditingPolicy(true)}><ShieldCheck size={16} />{t("authoring.overview.configurePolicy")}</Button>}</header>
          <div className="authoring-tool-access__toolbar">
            <label><span>{t("authoring.overview.server")}</span><Select value={selectedConnectionId}
              onChange={(event) => setSelectedConnectionId(event.target.value)}>
              {connections.length === 0 && <option value="">{t("authoring.overview.noServers")}</option>}
              {connections.map((connection) => <option key={connection.id} value={connection.id}>{connection.name}</option>)}
            </Select></label>
            <label className="authoring-overview-filter"><span className="sr-only">{t("authoring.overview.filterTools")}</span>
              <MagnifyingGlass size={16} aria-hidden="true" /><input type="search" value={filter}
                placeholder={t("authoring.overview.filterTools")} onChange={(event) => setFilter(event.target.value)} /></label>
          </div>
          <div className="authoring-tool-access__summary">
            <StatusBadge status={selectedPolicy?.mode === "DISABLED" ? "idle" : "success"}>{selectedPolicy?.mode ?? "DISABLED"}</StatusBadge>
            <span>{t("authoring.overview.availableTools", { authorized: authorizedTools.length, total: tools.length })}</span>
          </div>
          <div className="authoring-tool-table-scroll" tabIndex={0} aria-label={t("authoring.overview.policyTitle")}><table className="authoring-tool-table">
            <thead><tr><th>{t("authoring.overview.tool")}</th><th>{t("authoring.overview.description")}</th>
              <th>{t("authoring.overview.permission")}</th><th>{t("authoring.overview.status")}</th></tr></thead>
            <tbody>{toolState === "loading" && <tr><td colSpan={4} className="authoring-tool-table__state">{t("authoring.overview.loadingTools")}</td></tr>}
            {toolState === "error" && <tr><td colSpan={4} className="authoring-tool-table__state">{t("authoring.overview.toolsError")}</td></tr>}
            {toolState !== "loading" && toolState !== "error" && visibleTools.length === 0 && <tr><td colSpan={4} className="authoring-tool-table__state">{t(connections.length === 0 ? "authoring.overview.noServers" : "authoring.overview.noTools")}</td></tr>}
            {visibleTools.map((tool) => {
              const allowed = selectedPolicy !== null && authoringPolicyAllowsTool(selectedPolicy, tool.name);
              const readOnly = tool.currentSnapshot.definition.annotations?.readOnlyHint === true;
              return <tr key={tool.name}><td><code>{tool.name}</code></td>
                <td><span className="authoring-tool-description">{tool.currentSnapshot.definition.description || "—"}</span></td>
                <td>{t(readOnly ? "authoring.overview.readOnly" : "authoring.overview.mayWrite")}</td>
                <td><StatusBadge status={allowed ? "success" : "idle"}>{t(allowed ? "authoring.overview.authorized" : "authoring.overview.blocked")}</StatusBadge></td></tr>;
            })}</tbody>
          </table></div>
        </section>

        <aside className="authoring-lifecycle">
          <header><p className="authoring-overview-card__eyebrow">{t("authoring.overview.runtimeEyebrow")}</p><h2>{t("authoring.overview.runtimeTitle")}</h2></header>
          <ol>
            <li><CheckCircle size={18} /><span><strong>{t("authoring.overview.serviceStep")}</strong><small>{endpoint}</small></span></li>
            <li><ShieldCheck size={18} /><span><strong>{t("authoring.overview.policyStep")}</strong><small>{t("authoring.overview.activePolicies", { active: activePolicyCount, total: connections.length })}</small></span></li>
            <li><TerminalWindow size={18} /><span><strong>{t("authoring.overview.toolsStep")}</strong><small>{selectedConnection?.name ?? t("authoring.overview.noServers")}</small></span></li>
            <li><FileCode size={18} /><span><strong>{t("authoring.overview.assetsStep")}</strong><small>{t("authoring.overview.draftCount", { count: draftCount })} · {t("authoring.overview.callCount", { count: callCount })}</small></span></li>
          </ol>
          <p className="authoring-lifecycle__note"><ShieldCheck size={17} />{t("authoring.overview.securityNote")}</p>
        </aside>
      </div>}

    {editingPolicy && selectedConnection !== null && <AuthoringPolicyDialog api={api} projectId={projectId}
      connection={selectedConnection} onClose={() => { setEditingPolicy(false); void loadOverview(); }} />}
  </section>;
}
