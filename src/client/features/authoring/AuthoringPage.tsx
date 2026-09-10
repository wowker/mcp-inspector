import { useEffect, useRef, useState } from "react";
import { Copy, Key, PlugsConnected, Power, ArrowsClockwise } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import type { AuthoringSettingsStatus, InspectorApiClient } from "../../api/api-client.js";
import { InspectorApiError } from "../../api/api-client.js";
import { Button } from "../../components/actions/Button.js";
import { StatusBadge } from "../../components/feedback/StatusBadge.js";
import { AuthoringWorkspace } from "./AuthoringWorkspace.js";
import "./authoring.css";

interface AuthoringPageProps { api: InspectorApiClient; projectId: string; active: boolean }
type SettingsLoadState = "loading" | "ready" | "unauthorized" | "interrupted" | "error";

const emptySettings: AuthoringSettingsStatus = {
  enabled: false, configured: false, tokenHint: null, tokenCreatedAt: null,
  tokenRotatedAt: null, updatedAt: null,
};

export function AuthoringPage({ api, projectId, active }: AuthoringPageProps) {
  const { t } = useTranslation("app");
  const [settings, setSettings] = useState(emptySettings);
  const [endpoint, setEndpoint] = useState("");
  const [issuedToken, setIssuedToken] = useState<string | null>(null);
  const [state, setState] = useState<SettingsLoadState>("loading");
  const [busy, setBusy] = useState(false);
  const loaded = useRef(false);

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

    {state === "loading" && <div className="authoring-settings-state" role="status">{t("authoring.loading")}</div>}
    {state !== "loading" && state !== "ready" && <div className="authoring-settings-state" role="alert">
      <strong>{t(`authoring.${state}Title`)}</strong><Button variant="secondary" onClick={() => void loadSettings()}>{t("authoring.retry")}</Button>
    </div>}
    {state === "ready" && <section className="authoring-connection" aria-labelledby="authoring-connection-title">
      <header><div><h2 id="authoring-connection-title">{t("authoring.connectionTitle")}</h2><p>{t("authoring.connectionHint")}</p></div></header>
      <div className="authoring-connection__fields">
        <label><span>{t("authoring.endpoint")}</span><span className="authoring-copy-field"><input readOnly value={endpoint} />
          <Button variant="quiet" onClick={() => void copy(endpoint)}><Copy size={16} />{t("authoring.copyEndpoint")}</Button></span></label>
        <label><span>{t("authoring.clientConfig")}</span><span className="authoring-copy-field"><textarea readOnly value={clientConfig} />
          <Button variant="quiet" onClick={() => void copy(clientConfig)}><Copy size={16} />{t("authoring.copyConfig")}</Button></span></label>
      </div>
      {issuedToken !== null && <div className="authoring-token" role="status"><Key size={18} aria-hidden="true" /><div>
        <strong>{t("authoring.tokenTitle")}</strong><p>{t("authoring.tokenWarning")}</p><code>{issuedToken}</code></div>
        <Button variant="secondary" onClick={() => void copy(issuedToken)}><Copy size={16} />{t("authoring.copyToken")}</Button></div>}
    </section>}
    <AuthoringWorkspace api={api} projectId={projectId} active={active} enabled={state === "ready" && settings.enabled} />
  </section>;
}
