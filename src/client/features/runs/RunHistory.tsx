import { useEffect, useRef, useState } from "react";
import { Broom, PushPin, Trash } from "@phosphor-icons/react";
import type { InspectorApiClient, RunListFilter, RunSummary } from "../../api/api-client.js";
import { IconButton } from "../../components/actions/IconButton.js";
import { useTranslation } from "react-i18next";

interface Props { api: InspectorApiClient; projectId: string; tabId?: string; connectionId?: string; toolName?: string;
  filter?: RunListFilter; allowPinning?: boolean; onOpen: (run: RunSummary) => void;
  hideHeading?: boolean; compactId?: boolean; selectedId?: string; refreshKey?: number;
  onDelete?: (run: RunSummary) => void; onClear?: () => void; actionsDisabled?: boolean }
export function RunHistory({ api, projectId, tabId, connectionId, toolName, filter: requestedFilter,
  allowPinning = false, onOpen, hideHeading = false, compactId = false, selectedId, refreshKey = 0,
  onDelete, onClear, actionsDisabled = false }: Props) {
  const { t } = useTranslation("runs");
  const [runs, setRuns] = useState<RunSummary[]>([]); const [cursor, setCursor] = useState<string | null | undefined>(undefined);
  const [loading, setLoading] = useState(true); const [error, setError] = useState<string | null>(null); const generation = useRef(0);
  const [pinningId, setPinningId] = useState<string | null>(null);
  const filter: RunListFilter | undefined = tabId === undefined
    ? requestedFilter
    : { ...requestedFilter, tabId, ...(connectionId === undefined ? {} : { connectionId }),
      ...(toolName === undefined ? {} : { toolName }) };
  useEffect(() => {
    const current = ++generation.current; setRuns([]); setCursor(undefined); setLoading(true); setError(null);
    void api.listRuns(projectId, undefined, filter).then((page) => { if (generation.current !== current) return;
      setRuns(page.runs); setCursor(page.nextCursor); setLoading(false);
    }).catch((cause: unknown) => { if (generation.current === current) { setError(cause instanceof Error ? cause.message : t("history.loadFailed")); setLoading(false); } });
    return () => { generation.current += 1; };
  }, [api, projectId, tabId, connectionId, toolName, requestedFilter?.connectionId, requestedFilter?.toolName,
    requestedFilter?.status, requestedFilter?.origin,
    requestedFilter?.pinned, requestedFilter?.createdFrom, requestedFilter?.createdTo, requestedFilter?.limit, refreshKey]);
  async function more(): Promise<void> {
    if (cursor === null || cursor === undefined || loading) return; const current = generation.current; const requested = cursor; setLoading(true);
    try { const page = await api.listRuns(projectId, requested, filter); if (generation.current !== current) return;
      setRuns((items) => [...items, ...page.runs.filter((candidate) => !items.some(({ id }) => id === candidate.id))]); setCursor(page.nextCursor);
    } catch (cause) { if (generation.current === current) setError(cause instanceof Error ? cause.message : t("history.loadFailed")); }
    finally { if (generation.current === current) setLoading(false); }
  }
  async function setPinned(run: RunSummary): Promise<void> {
    if (pinningId !== null) return;
    const current = generation.current;
    setPinningId(run.id);
    setError(null);
    try {
      const updated = await api.setRunPinned(projectId, run.id, !run.pinned);
      if (generation.current !== current) return;
      setRuns((items) => filter?.pinned === true && !updated.pinned
        ? items.filter(({ id }) => id !== updated.id)
        : items.map((item) => item.id === updated.id ? updated : item));
    } catch (cause) {
      if (generation.current === current) setError(cause instanceof Error ? cause.message : t("history.pinFailed"));
    } finally {
      if (generation.current === current) setPinningId(null);
    }
  }
  const visible = runs;
  return <section className="run-history" aria-label={tabId === undefined ? t("history.projectAria") : t("history.tabAria")}>
    {!hideHeading && <h2>{tabId === undefined ? t("history.title") : t("history.tabTitle")}</h2>}
    {onClear !== undefined && <div className="run-history__actions"><button type="button"
      disabled={actionsDisabled || loading || visible.length === 0} onClick={onClear}>
      <Broom size={15} aria-hidden="true" />{t("history.clear")}</button></div>}
    {error !== null && <p role="alert">{error}</p>}
    {visible.length === 0 && !loading && <p>{t("history.empty")}</p>}
    <ol>{visible.map((run) => <li key={run.id} className="history-run-row"><button type="button" className={`history-run${selectedId === run.id ? " is-selected" : ""}`}
      aria-current={selectedId === run.id ? "true" : undefined} aria-label={t("history.openAria", { id: run.id })} onClick={() => onOpen(run)}>
      <span className="history-run__primary"><strong title={run.toolName}>{run.toolName}</strong>
        <span className="history-run__id">{compactId ? run.id.slice(-8) : run.id}</span></span>
      <span className={`status-chip status-chip--${run.status}`}>{t(`status.${run.status}`, { defaultValue: run.status })}</span>
      <span className="history-run__meta"><time>{new Date(run.createdAt).toLocaleString()}</time>
        <span>{run.durationMs === null ? t("history.notRecorded") : `${run.durationMs} ms`}</span></span></button>
      {allowPinning && <IconButton size="compact" className="history-run__pin"
        label={run.pinned ? t("history.unpinAria", { id: run.id }) : t("history.pinAria", { id: run.id })}
        disabled={pinningId !== null} aria-pressed={run.pinned}
        icon={<PushPin size={16} weight={run.pinned ? "fill" : "regular"} aria-hidden="true" />}
        onClick={() => { void setPinned(run); }} />}
      {onDelete !== undefined && <IconButton size="compact" className="history-run__delete"
        label={t("history.deleteAria", { id: run.id })} disabled={actionsDisabled}
        icon={<Trash size={16} aria-hidden="true" />} onClick={() => onDelete(run)} />}</li>)}</ol>
    {loading && <p role="status">{t("history.loading")}</p>}
    {cursor !== null && cursor !== undefined && <button type="button" disabled={loading} onClick={() => void more()}>{t("history.more")}</button>}
  </section>;
}
