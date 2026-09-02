import { useEffect, useId, useRef, useState } from "react";
import { ArrowClockwise, Warning, X } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import type { ReplayPreflight, RunDetail, RunSummary } from "../../../shared/run-replay.js";
import { InspectorApiError, type InspectorApiClient } from "../../api/api-client.js";
import { Button } from "../../components/actions/Button.js";
import { Dialog } from "../../components/overlays/Dialog.js";
import { JsonViewer } from "./JsonViewer.js";

export function ReplayDialog({ api, projectId, source, onClose, onStarted }: {
  api: InspectorApiClient;
  projectId: string;
  source: RunDetail;
  onClose: () => void;
  onStarted: (run: RunSummary) => void;
}) {
  const { t } = useTranslation("runs");
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  const scopeGeneration = useRef(0);
  const loadGeneration = useRef(0);
  const [preflight, setPreflight] = useState<ReplayPreflight | null>(null);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [driftConfirmed, setDriftConfirmed] = useState(false);
  const [riskConfirmed, setRiskConfirmed] = useState(false);

  async function load(signal?: AbortSignal, preserveError = false): Promise<void> {
    const current = ++loadGeneration.current;
    setLoading(true);
    if (!preserveError) setError(null);
    try {
      const value = await api.getReplayPreflight(projectId, source.id, signal);
      if (loadGeneration.current !== current) return;
      setPreflight(value);
      setDriftConfirmed(false);
      setRiskConfirmed(false);
    } catch (cause) {
      if (loadGeneration.current !== current || signal?.aborted) return;
      setPreflight(null);
      setError(cause instanceof Error ? cause.message : t("replay.loadFailed"));
    } finally {
      if (loadGeneration.current === current) setLoading(false);
    }
  }

  useEffect(() => {
    scopeGeneration.current += 1;
    const controller = new AbortController();
    void load(controller.signal);
    return () => { scopeGeneration.current += 1; loadGeneration.current += 1; controller.abort(); };
  }, [api, projectId, source.id]);

  const needsDrift = preflight?.requiredConfirmations.includes("SCHEMA_DRIFT") === true;
  const needsRisk = preflight?.requiredConfirmations.includes("SIDE_EFFECT_RISK") === true;
  const blocked = preflight === null || preflight.blockers.length > 0 ||
    (needsDrift && !driftConfirmed) || (needsRisk && !riskConfirmed);

  async function start(): Promise<void> {
    if (preflight === null || starting || blocked) return;
    const scope = scopeGeneration.current;
    setStarting(true);
    setError(null);
    try {
      const run = await api.startReplay(projectId, source.id, {
        idempotencyKey: crypto.randomUUID(),
        preflightDigest: preflight.digest,
        confirmSchemaDrift: driftConfirmed,
        confirmSideEffects: riskConfirmed,
      });
      if (scopeGeneration.current !== scope) return;
      onStarted(run);
    } catch (cause) {
      if (scopeGeneration.current !== scope) return;
      if (cause instanceof InspectorApiError && cause.code === "REPLAY_STALE_PREFLIGHT") {
        setError(t("replay.staleRefreshed"));
        await load(undefined, true);
      } else {
        setError(cause instanceof Error ? cause.message : t("replay.startFailed"));
      }
    } finally {
      if (scopeGeneration.current === scope) setStarting(false);
    }
  }

  return <Dialog className="replay-dialog" titleId={titleId} initialFocusRef={closeRef}
    onClose={onClose} closeDisabled={starting}>
    <header className="dialog-header"><div><p className="dialog-kicker">{t("replay.kicker")}</p>
      <h3 id={titleId}>{t("replay.title")}</h3><p>{t("replay.description")}</p></div>
      <button ref={closeRef} type="button" className="dialog-close" aria-label={t("replay.close")}
        disabled={starting} onClick={onClose}><X size={18} aria-hidden="true" /></button></header>
    <div className="replay-dialog__body">
      {loading && <p role="status">{t("replay.loading")}</p>}
      {error !== null && <p className="dialog-error" role="alert">{error}</p>}
      {preflight !== null && <>
        <dl className="replay-dialog__identity"><div><dt>{t("replay.connection")}</dt><dd><code>{preflight.connectionId}</code></dd></div>
          <div><dt>Tool</dt><dd><code>{preflight.toolName}</code></dd></div></dl>
        <section className="replay-dialog__arguments"><h4>{t("replay.arguments")}</h4>
          <JsonViewer value={preflight.arguments} label={t("replay.argumentsAria")} defaultExpanded="all" /></section>
        {preflight.blockers.length > 0 && <section className="replay-dialog__blockers" role="alert"><h4>{t("replay.blockers")}</h4>
          <ul>{preflight.blockers.map((blocker) => <li key={blocker.code}>{blocker.message}</li>)}</ul></section>}
        <section className="replay-dialog__risk"><div><Warning size={17} aria-hidden="true" /><h4>{t("replay.riskTitle")}</h4>
          <span>{t(`replay.risk.${preflight.sideEffectRisk}`)}</span></div>
          {needsRisk && <label><input type="checkbox" checked={riskConfirmed}
            onChange={(event) => setRiskConfirmed(event.target.checked)} />{t("replay.confirmRisk")}</label>}</section>
        {preflight.schemaChanges.length > 0 && <section className="replay-dialog__drift"><h4>{t("replay.driftTitle")}</h4>
          <ul>{preflight.schemaChanges.map((change) => <li key={`${change.kind}:${change.path}`}><code>{change.path}</code>
            <span>{t(`replay.change.${change.kind}`)}</span></li>)}</ul>
          {needsDrift && <label><input type="checkbox" checked={driftConfirmed}
            onChange={(event) => setDriftConfirmed(event.target.checked)} />{t("replay.confirmDrift")}</label>}</section>}
      </>}
    </div>
    <div className="dialog-actions"><Button variant="quiet" disabled={starting} onClick={onClose}>{t("replay.cancel")}</Button>
      <Button variant="primary" loading={starting} loadingLabel={t("replay.starting")} disabled={loading || blocked}
        onClick={() => void start()}><ArrowClockwise size={16} aria-hidden="true" />{t("replay.start")}</Button></div>
  </Dialog>;
}
