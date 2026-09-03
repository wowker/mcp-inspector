import { useState } from "react";
import { ClockCounterClockwise, FunnelSimple } from "@phosphor-icons/react";
import type { InspectorApiClient, RunDetail, RunListFilter, RunSummary } from "../../api/api-client.js";
import { Button } from "../../components/actions/Button.js";
import { Select } from "../../components/forms/Select.js";
import { RunHistory } from "./RunHistory.js";
import { RunResultPanel } from "./RunResultPanel.js";
import { ReplayDialog } from "./ReplayDialog.js";
import { ComparisonDialog } from "./ComparisonDialog.js";
import { ModuleHelpPopover } from "../../components/overlays/ModuleHelpPopover.js";
import { useRunEvents } from "./use-run-events.js";
import { useTranslation } from "react-i18next";

export function RunHistoryPage({ api, projectId, onOpenDebug, onCreateTest }: {
  api: InspectorApiClient;
  projectId: string;
  onOpenDebug: (run: RunDetail) => Promise<void>;
  onCreateTest?: (run: RunDetail) => void;
}) {
  const { t } = useTranslation("runs");
  const [selected, setSelected] = useState<RunSummary | null>(null);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);
  const [replaySource, setReplaySource] = useState<RunDetail | null>(null);
  const [comparisonReplayId, setComparisonReplayId] = useState<string | null>(null);
  const [draft, setDraft] = useState({ toolName: "", connectionId: "", status: "", origin: "", pinned: "", createdFrom: "", createdTo: "" });
  const [filter, setFilter] = useState<RunListFilter>({});
  const [filterError, setFilterError] = useState<string | null>(null);
  const observed = useRunEvents(api, projectId, selected?.id ?? null);

  async function openDebug(run: RunDetail): Promise<void> {
    if (openingId !== null) return;
    setOpeningId(run.id);
    setOpenError(null);
    try {
      await onOpenDebug(run);
    } catch (error) {
      setOpenError(error instanceof Error ? error.message : t("page.openFailed"));
    } finally {
      setOpeningId(null);
    }
  }

  function applyFilters(): void {
    if (draft.connectionId !== "" && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(draft.connectionId)) {
      setFilterError(t("page.filters.invalidConnection"));
      return;
    }
    setFilterError(null);
    setSelected(null);
    setFilter({
      ...(draft.toolName.trim() === "" ? {} : { toolName: draft.toolName.trim() }),
      ...(draft.connectionId === "" ? {} : { connectionId: draft.connectionId }),
      ...(draft.status === "" ? {} : { status: draft.status as NonNullable<RunListFilter["status"]> }),
      ...(draft.origin === "" ? {} : { origin: draft.origin as NonNullable<RunListFilter["origin"]> }),
      ...(draft.pinned === "" ? {} : { pinned: draft.pinned === "true" }),
      ...(draft.createdFrom === "" ? {} : { createdFrom: new Date(draft.createdFrom).toISOString() }),
      ...(draft.createdTo === "" ? {} : { createdTo: new Date(draft.createdTo).toISOString() }),
    });
  }

  function resetFilters(): void {
    setDraft({ toolName: "", connectionId: "", status: "", origin: "", pinned: "", createdFrom: "", createdTo: "" });
    setFilterError(null);
    setSelected(null);
    setFilter({});
  }

  return <section className="history-page" aria-labelledby="history-page-title">
    <header className="page-heading page-heading--compact history-page__heading">
      <div><div className="module-heading-title"><h1 id="history-page-title">{t("page.title")}</h1>
        <ModuleHelpPopover moduleName={t("page.title")} triggerLabel={t("page.help.trigger")} closeLabel={t("page.help.close")}
          summary={t("page.help.summary")} description={t("page.description")} sections={(["purpose", "configure", "use", "effect"] as const).map((section) => ({
            id: section, title: t(`page.help.sections.${section}`), items: [t(`page.help.${section}.one`), t(`page.help.${section}.two`)],
          }))} /></div><p>{t("page.description")}</p></div>
    </header>
    <div className="history-page__layout">
      <aside className="history-page__list" aria-label={t("page.listAria")}>
        <section className="history-filters" aria-labelledby="history-filters-title">
          <div className="history-filters__heading"><FunnelSimple size={16} aria-hidden="true" />
            <h2 id="history-filters-title">{t("page.filters.title")}</h2>
            <ModuleHelpPopover moduleName={t("page.filterHelp.title")} triggerLabel={t("page.filterHelp.trigger")}
              closeLabel={t("page.filterHelp.close")} summary={t("page.filterHelp.summary")}
              sections={(["toolName", "connectionId", "status", "origin", "pinned", "time"] as const).map((section) => ({
                id: section, title: t(`page.filterHelp.sections.${section}`), items: [t(`page.filterHelp.items.${section}`)],
              }))} /></div>
          <div className="history-filters__grid">
            <label>{t("page.filters.toolName")}<input value={draft.toolName} onChange={(event) => setDraft({ ...draft, toolName: event.target.value })} /></label>
            <label>{t("page.filters.connectionId")}<input className="ui-mono" value={draft.connectionId}
              onChange={(event) => setDraft({ ...draft, connectionId: event.target.value.trim() })} /></label>
            <label>{t("page.filters.status")}<Select value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value })}>
              <option value="">{t("page.filters.all")}</option>{(["queued", "connecting", "authorizing", "running", "succeeded", "failed", "cancelled", "interrupted"] as const)
                .map((status) => <option key={status} value={status}>{t(`status.${status}`)}</option>)}</Select></label>
            <label>{t("page.filters.origin")}<Select value={draft.origin} onChange={(event) => setDraft({ ...draft, origin: event.target.value })}>
              <option value="">{t("page.filters.all")}</option><option value="ORIGINAL">{t("page.filters.original")}</option>
              <option value="REPLAY">{t("page.filters.replay")}</option></Select></label>
            <label>{t("page.filters.pinned")}<Select value={draft.pinned} onChange={(event) => setDraft({ ...draft, pinned: event.target.value })}>
              <option value="">{t("page.filters.all")}</option><option value="true">{t("page.filters.pinnedOnly")}</option>
              <option value="false">{t("page.filters.unpinnedOnly")}</option></Select></label>
            <label>{t("page.filters.from")}<input type="datetime-local" value={draft.createdFrom}
              onChange={(event) => setDraft({ ...draft, createdFrom: event.target.value })} /></label>
            <label>{t("page.filters.to")}<input type="datetime-local" value={draft.createdTo}
              onChange={(event) => setDraft({ ...draft, createdTo: event.target.value })} /></label>
          </div>
          {filterError !== null && <p className="history-filters__error" role="alert">{filterError}</p>}
          <div className="history-filters__actions"><Button variant="quiet" onClick={resetFilters}>{t("page.filters.reset")}</Button>
            <Button variant="secondary" onClick={applyFilters}>{t("page.filters.apply")}</Button></div>
        </section>
        <RunHistory api={api} projectId={projectId} filter={filter} allowPinning onOpen={setSelected}
          hideHeading compactId selectedId={selected?.id} />
      </aside>
      <div className="history-page__detail">
        {openError !== null && <p role="alert">{openError}</p>}
        {selected === null ? <div className="history-page__empty" role="status">
          <ClockCounterClockwise size={24} aria-hidden="true" />
          <div><strong>{t("page.selectTitle")}</strong><p>{t("page.selectDescription")}</p></div>
        </div> : observed.error !== null ? <p role="alert">{observed.error}</p>
          : observed.run === null ? <p role="status">{t("page.loadingDetail")}</p>
          : <RunResultPanel run={observed.run} openingDebug={openingId === observed.run.id} onCreateTest={onCreateTest}
            onReplay={setReplaySource} onCompare={(run) => setComparisonReplayId(run.id)}
            onOpenDebug={(run) => { void openDebug(run); }} />}
      </div>
      {replaySource !== null && <ReplayDialog api={api} projectId={projectId} source={replaySource}
        onClose={() => setReplaySource(null)} onStarted={(run) => { setReplaySource(null); setSelected(run); }} />}
      {comparisonReplayId !== null && <ComparisonDialog api={api} projectId={projectId} replayRunId={comparisonReplayId}
        onClose={() => setComparisonReplayId(null)} />}
    </div>
  </section>;
}
