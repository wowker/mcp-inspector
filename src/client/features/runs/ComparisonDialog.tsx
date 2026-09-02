import { useEffect, useId, useRef, useState } from "react";
import { ArrowsLeftRight, Clipboard, FloppyDisk, X } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import type { RunComparison, StructuralChange } from "../../../shared/run-comparison.js";
import type { InspectorApiClient } from "../../api/api-client.js";
import { Button } from "../../components/actions/Button.js";
import { Dialog } from "../../components/overlays/Dialog.js";

function lines(value: string): string[] {
  return value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function json(value: unknown): string {
  try { return JSON.stringify(value); } catch { return "[unserializable]"; }
}

function ChangeList({ title, changes }: { title: string; changes: StructuralChange[] }) {
  const { t } = useTranslation("runs");
  return <section className="comparison-dialog__changes"><h4>{title}<span>{changes.length}</span></h4>
    {changes.length === 0 ? <p className="comparison-dialog__empty">{t("comparison.noChanges")}</p>
      : <ol>{changes.map((change) => <li key={`${change.kind}:${change.path}`}>
        <header><code>{change.path}</code><span>{t(`comparison.kind.${change.kind}`)}</span></header>
        <div>{change.source !== undefined && <pre aria-label={t("comparison.sourceValue")}>{json(change.source)}</pre>}
          {change.replay !== undefined && <pre aria-label={t("comparison.replayValue")}>{json(change.replay)}</pre>}</div>
      </li>)}</ol>}
  </section>;
}

export function ComparisonDialog({ api, projectId, replayRunId, onClose }: {
  api: InspectorApiClient;
  projectId: string;
  replayRunId: string;
  onClose: () => void;
}) {
  const { t } = useTranslation("runs");
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  const generation = useRef(0);
  const [comparison, setComparison] = useState<RunComparison | null>(null);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [previewing, setPreviewing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load(signal?: AbortSignal): Promise<void> {
    const current = ++generation.current;
    setLoading(true); setError(null);
    try {
      const value = await api.getRunComparison(projectId, replayRunId, undefined, signal);
      if (generation.current !== current) return;
      setComparison(value);
      setDraft(value.ruleExpressions.join("\n"));
    } catch (cause) {
      if (generation.current !== current || signal?.aborted) return;
      setError(cause instanceof Error ? cause.message : t("comparison.loadFailed"));
    } finally { if (generation.current === current) setLoading(false); }
  }

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => { generation.current += 1; controller.abort(); };
  }, [api, projectId, replayRunId]);

  async function preview(): Promise<void> {
    if (previewing || saving) return;
    const current = ++generation.current;
    setPreviewing(true); setError(null);
    try {
      const value = await api.getRunComparison(projectId, replayRunId, lines(draft));
      if (generation.current !== current) return;
      setComparison(value); setDraft(value.ruleExpressions.join("\n"));
    } catch (cause) {
      if (generation.current === current) setError(cause instanceof Error ? cause.message : t("comparison.previewFailed"));
    } finally { if (generation.current === current) setPreviewing(false); }
  }

  async function save(): Promise<void> {
    if (previewing || saving) return;
    const current = ++generation.current;
    setSaving(true); setError(null);
    try {
      await api.replaceComparisonRules(projectId, lines(draft));
      const value = await api.getRunComparison(projectId, replayRunId);
      if (generation.current !== current) return;
      setComparison(value); setDraft(value.ruleExpressions.join("\n"));
      toast.success(t("comparison.saved"));
    } catch (cause) {
      if (generation.current === current) setError(cause instanceof Error ? cause.message : t("comparison.saveFailed"));
    } finally { if (generation.current === current) setSaving(false); }
  }

  async function copy(): Promise<void> {
    if (comparison === null) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(comparison, null, 2));
      toast.success(t("comparison.copied"));
    } catch { setError(t("comparison.copyFailed")); }
  }

  const material = comparison?.diff?.changes.filter(({ ignored }) => !ignored) ?? [];
  const ignored = comparison?.diff?.changes.filter(({ ignored }) => ignored) ?? [];
  return <Dialog className="comparison-dialog" titleId={titleId} initialFocusRef={closeRef}
    onClose={onClose} closeDisabled={saving}>
    <header className="dialog-header"><div><p className="dialog-kicker">STRUCTURAL DIFF</p>
      <h3 id={titleId}>{t("comparison.title")}</h3><p>{t("comparison.description")}</p></div>
      <button ref={closeRef} type="button" className="dialog-close" aria-label={t("comparison.close")}
        disabled={saving} onClick={onClose}><X size={18} aria-hidden="true" /></button></header>
    <div className="comparison-dialog__body">
      {loading && <p role="status">{t("comparison.loading")}</p>}
      {error !== null && <p className="dialog-error" role="alert">{error}</p>}
      {comparison !== null && <>
        <dl className="comparison-dialog__identity"><div><dt>{t("comparison.sourceRun")}</dt><dd><code>{comparison.sourceRunId ?? "—"}</code></dd></div>
          <div><dt>{t("comparison.replayRun")}</dt><dd><code>{comparison.replayRunId}</code></dd></div></dl>
        {!comparison.comparable && <p className="comparison-dialog__unavailable" role="status">
          {t(`comparison.reason.${comparison.unavailableReason ?? "REPLAY_RESPONSE_INVALID"}`)}
        </p>}
        {comparison.diff?.truncated && <p className="comparison-dialog__warning" role="status">{t("comparison.truncated")}</p>}
        {comparison.comparable && <div className="comparison-dialog__diff">
          <ChangeList title={t("comparison.materialChanges")} changes={material} />
          <ChangeList title={t("comparison.ignoredChanges")} changes={ignored} />
        </div>}
        <section className="comparison-dialog__rules"><div><h4>{t("comparison.rules")}</h4><p>{t("comparison.rulesHint")}</p></div>
          <textarea aria-label={t("comparison.rulesAria")} value={draft} onChange={(event) => setDraft(event.target.value)}
            placeholder={'$["requestId"]\n$["items"][*]["updatedAt"]'} rows={5} />
          <div><Button variant="secondary" loading={previewing} loadingLabel={t("comparison.previewing")}
            disabled={saving} onClick={() => void preview()}><ArrowsLeftRight size={16} aria-hidden="true" />{t("comparison.preview")}</Button>
            <Button variant="primary" loading={saving} loadingLabel={t("comparison.saving")}
              disabled={previewing} onClick={() => void save()}><FloppyDisk size={16} aria-hidden="true" />{t("comparison.save")}</Button></div>
        </section>
      </>}
    </div>
    <div className="dialog-actions"><Button variant="quiet" onClick={() => void copy()} disabled={comparison === null}>
      <Clipboard size={16} aria-hidden="true" />{t("comparison.copy")}</Button>
      <Button variant="secondary" disabled={saving} onClick={onClose}>{t("comparison.closeAction")}</Button></div>
  </Dialog>;
}
