import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { PlugsConnected, Power, ArrowsClockwise } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import type { AuthoringSettingsStatus, InspectorApiClient } from "../../api/api-client.js";
import { InspectorApiError } from "../../api/api-client.js";
import { Button } from "../../components/actions/Button.js";
import { StatusBadge } from "../../components/feedback/StatusBadge.js";
import { AuthoringOverview } from "./AuthoringOverview.js";
import { AuthoringWorkspace, type AuthoringWorkspaceView } from "./AuthoringWorkspace.js";
import type { AuthoringAppliedAsset } from "../../../shared/authoring/apply.js";
import "./authoring.css";

interface AuthoringPageProps { api: InspectorApiClient; projectId: string; active: boolean;
  onOpenAsset?(asset: AuthoringAppliedAsset): void }
type SettingsLoadState = "loading" | "ready" | "unauthorized" | "interrupted" | "error";
type AuthoringPageView = "overview" | AuthoringWorkspaceView;

const emptySettings: AuthoringSettingsStatus = {
  enabled: false, configured: false, tokenHint: null, tokenCreatedAt: null,
  tokenRotatedAt: null, updatedAt: null,
};

export function AuthoringPage({ api, projectId, active, onOpenAsset = () => undefined }: AuthoringPageProps) {
  const { t } = useTranslation("app");
  const [settings, setSettings] = useState(emptySettings);
  const [endpoint, setEndpoint] = useState("");
  const [issuedToken, setIssuedToken] = useState<string | null>(null);
  const [state, setState] = useState<SettingsLoadState>("loading");
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<AuthoringPageView>("overview");
  const loaded = useRef(false);
  const loadedProject = useRef(projectId);

  useEffect(() => {
    if (loadedProject.current === projectId) return;
    loadedProject.current = projectId;
    setView("overview");
  }, [projectId]);

  async function loadSettings(): Promise<void> {
    setState("loading");
    try {
      const result = await api.getAuthoringSettings();
      setSettings(result.settings);
      setEndpoint(result.endpoint);
      setState("ready");
    } catch (error) {
      if (error instanceof InspectorApiError && error.status === 401) setState("unauthorized");
      else if (error instanceof DOMException && error.name === "AbortError") setState("interrupted");
      else setState("error");
    }
  }

  useEffect(() => {
    if (!active || loaded.current) return;
    loaded.current = true;
    void loadSettings();
  }, [active]);

  async function issueToken(mode: "enable" | "rotate"): Promise<void> {
    setBusy(true);
    try {
      const result = mode === "enable" ? await api.enableAuthoring() : await api.rotateAuthoringToken();
      setSettings(result.settings);
      setEndpoint(result.endpoint);
      setIssuedToken(result.token);
      setState("ready");
    } catch {
      setState("error");
    } finally {
      setBusy(false);
    }
  }

  async function disable(): Promise<void> {
    setBusy(true);
    try {
      const result = await api.disableAuthoring();
      setSettings(result.settings);
      setEndpoint(result.endpoint);
      setIssuedToken(null);
    } catch {
      setState("error");
    } finally {
      setBusy(false);
    }
  }

  async function copy(value: string): Promise<void> {
    await navigator.clipboard.writeText(value);
  }

  const clientConfig = JSON.stringify({
    mcpServers: { "mcp-inspector-authoring": { type: "streamable-http", url: endpoint, headers: {
      Authorization: `Bearer ${issuedToken ?? "<YOUR_TOKEN>"}`,
    } } },
  }, null, 2);

  function selectView(next: AuthoringPageView): void {
    setView(next);
  }

  function navigateViews(event: KeyboardEvent<HTMLButtonElement>, current: AuthoringPageView): void {
    const order: AuthoringPageView[] = ["overview", "drafts", "calls"];
    let index = order.indexOf(current);
    if (event.key === "ArrowRight" || event.key === "ArrowDown") index = (index + 1) % order.length;
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp") index = (index - 1 + order.length) % order.length;
    else if (event.key === "Home") index = 0;
    else if (event.key === "End") index = order.length - 1;
    else return;
    event.preventDefault();
    const next = order[index] ?? "overview";
    selectView(next);
    queueMicrotask(() => document.getElementById(`authoring-page-view-${next}`)?.focus());
  }

  return <section className="authoring-page" aria-labelledby="authoring-page-title">
    <header className="authoring-page__header">
      <div className="authoring-page__title"><span className="authoring-page__icon" aria-hidden="true"><PlugsConnected size={21} /></span>
        <div><h1 id="authoring-page-title">{t("authoring.title")}</h1><p>{t("authoring.summary")}</p></div>
        {state === "ready" && <StatusBadge status={settings.enabled ? "success" : "idle"}>{t(settings.enabled ? "authoring.enabled" : "authoring.disabled")}</StatusBadge>}
      </div>
      <div className="authoring-page__actions">
        {state === "ready" && !settings.enabled && <Button variant="primary" loading={busy} onClick={() => void issueToken("enable")}><Power size={16} />{t("authoring.enable")}</Button>}
        {state === "ready" && settings.enabled && <><Button variant="secondary" loading={busy} onClick={() => void issueToken("rotate")}><ArrowsClockwise size={16} />{t("authoring.rotate")}</Button>
          <Button variant="danger" disabled={busy} onClick={() => void disable()}><Power size={16} />{t("authoring.disable")}</Button></>}
      </div>
    </header>

    <nav className="authoring-page-tabs" role="tablist" aria-label={t("authoring.workspace.views")}>
      {(["overview", "drafts", "calls"] as const).map((item) => <button key={item}
        id={`authoring-page-view-${item}`} type="button" role="tab" aria-selected={view === item}
        aria-controls={item === "overview" ? "authoring-page-panel-overview" : "authoring-page-panel-workspace"}
        tabIndex={view === item ? 0 : -1} onClick={() => selectView(item)}
        onKeyDown={(event) => navigateViews(event, item)}>{t(`authoring.workspace.${item}`)}</button>)}
    </nav>

    {state === "loading" && <div className="authoring-settings-state" role="status">{t("authoring.loading")}</div>}
    {state !== "loading" && state !== "ready" && <div className="authoring-settings-state" role="alert">
      <strong>{t(`authoring.${state}Title`)}</strong><Button variant="secondary" onClick={() => void loadSettings()}>{t("authoring.retry")}</Button>
    </div>}
    {state === "ready" && <>
      <div id="authoring-page-panel-overview" role="tabpanel" aria-labelledby="authoring-page-view-overview" hidden={view !== "overview"}>
        <AuthoringOverview api={api} projectId={projectId} active={active && view === "overview"}
          settings={settings} endpoint={endpoint} clientConfig={clientConfig} issuedToken={issuedToken} onCopy={copy} />
      </div>
      <div id="authoring-page-panel-workspace" className="authoring-page__workspace-panel" role="tabpanel"
        aria-labelledby={`authoring-page-view-${view === "overview" ? "drafts" : view}`} hidden={view === "overview"}>
        <AuthoringWorkspace api={api} projectId={projectId} active={active && view !== "overview"}
          enabled={settings.enabled} view={view === "overview" ? "drafts" : view} onOpenAsset={onOpenAsset} />
      </div>
    </>}
  </section>;
}
