import { useEffect, useId, useRef, useState } from "react";
import { Copy, FileArrowDown, Flask, Trash } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import type { InspectorApiClient, SavedItemDetail, SavedItemKind, SavedItemSummary } from "../../api/api-client.js";
import { JsonViewer } from "../runs/JsonViewer.js";

function date(value: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

export function SavedItemsView({ api, projectId, connectionId, toolName, refreshKey = 0, onLoadRequest, onCreateTest }: {
  api: InspectorApiClient; projectId: string; connectionId: string; toolName: string; refreshKey?: number;
  onLoadRequest: (argumentsValue: Record<string, unknown>) => void;
  onCreateTest?: (item: SavedItemDetail) => void;
}) {
  const { t, i18n } = useTranslation("savedItems");
  const loadError = useRef(t("errors.load"));
  loadError.current = t("errors.load");
  const tabsId = useId();
  const [items, setItems] = useState<SavedItemSummary[] | null>(null); const [kind, setKind] = useState<SavedItemKind>("request");
  const [nextCursor, setNextCursor] = useState<string | null>(null); const [loadingMore, setLoadingMore] = useState(false);
  const [selected, setSelected] = useState<SavedItemDetail | null>(null); const [loadingId, setLoadingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null); const [confirmId, setConfirmId] = useState<string | null>(null);
  const scope = useRef(0); const detailRequest = useRef(0);
  useEffect(() => {
    const current = ++scope.current; detailRequest.current += 1; setItems(null); setSelected(null); setNextCursor(null); setError(null);
    void api.listSavedItems(projectId, connectionId, toolName).then((value) => { if (scope.current === current) { setItems(value.items); setNextCursor(value.nextCursor); } })
      .catch((reason: unknown) => { if (scope.current === current) setError(reason instanceof Error ? reason.message : loadError.current); });
    return () => { if (scope.current === current) scope.current += 1; };
  }, [api, connectionId, projectId, refreshKey, toolName]);
  const visible = items?.filter((item) => item.kind === kind) ?? [];
  async function open(item: SavedItemSummary): Promise<void> {
    const current = scope.current; const request = ++detailRequest.current; setLoadingId(item.id); setError(null);
    try { const value = await api.getSavedItem(projectId, connectionId, toolName, item.id);
      if (scope.current === current && detailRequest.current === request) setSelected(value); }
    catch (reason) { if (scope.current === current && detailRequest.current === request) setError(reason instanceof Error ? reason.message : t("errors.loadDetail")); }
    finally { if (scope.current === current && detailRequest.current === request) setLoadingId(null); }
  }
  async function more(): Promise<void> {
    if (nextCursor === null || loadingMore) return; const current = scope.current; setLoadingMore(true);
    try { const page = await api.listSavedItems(projectId, connectionId, toolName, nextCursor);
      if (scope.current === current) { setItems((value) => [...(value ?? []), ...page.items]); setNextCursor(page.nextCursor); }
    } catch (reason) { if (scope.current === current) setError(reason instanceof Error ? reason.message : t("errors.loadMore")); }
    finally { if (scope.current === current) setLoadingMore(false); }
  }
  async function remove(item: SavedItemSummary): Promise<void> {
    const current = scope.current;
    try { await api.deleteSavedItem(projectId, connectionId, toolName, item.id);
      if (scope.current === current) { setItems((value) => value?.filter(({ id }) => id !== item.id) ?? null);
        if (selected?.id === item.id) setSelected(null); setConfirmId(null); }
    } catch (reason) { if (scope.current === current) setError(reason instanceof Error ? reason.message : t("errors.delete")); }
  }
  async function copy(value: unknown): Promise<void> {
    try { await navigator.clipboard.writeText(JSON.stringify(value, null, 2)); }
    catch { setError(t("errors.copy")); }
  }
  const kindLabel = (value: SavedItemKind): string => t(`kind.${value}`);
  const kindListLabel = (value: SavedItemKind): string => t(value === "request" ? "kind.requests" : "kind.responses");
  const kindPluralLabel = (value: SavedItemKind): string => t(value === "request" ? "kind.requestPlural" : "kind.responsePlural");
  return <section className="saved-items-view" aria-label={t("view.label", { toolName })}>
    <header className="saved-items-header"><div role="tablist" aria-label={t("view.typeLabel")} onKeyDown={(event) => {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        event.preventDefault(); const next = kind === "request" ? "response" : "request"; detailRequest.current += 1;
        setKind(next); setSelected(null); setLoadingId(null); setConfirmId(null);
        document.getElementById(`${tabsId}-${next}`)?.focus();
      }}>
        {(["request", "response"] as const).map((value) => <button key={value} id={`${tabsId}-${value}`}
          aria-controls={`${tabsId}-panel`} type="button" role="tab" tabIndex={kind === value ? 0 : -1} aria-selected={kind === value}
          onClick={() => { detailRequest.current += 1; setKind(value); setSelected(null); setLoadingId(null); setConfirmId(null); }}>{kindListLabel(value)} {items?.filter((item) => item.kind === value).length ?? 0}</button>)}</div></header>
    {error !== null && <p role="alert" className="saved-items-error">{error}</p>}
    {items === null && error === null ? <p role="status" className="saved-items-status">{t("view.loading")}</p>
      : <div id={`${tabsId}-panel`} role="tabpanel" aria-labelledby={`${tabsId}-${kind}`} className="saved-items-layout"><div className="saved-items-list" aria-label={t("view.listLabel", { kind: kindPluralLabel(kind) })}>
        {visible.length === 0 ? <div className="saved-items-empty"><strong>{t("view.emptyTitle", { kind: kindPluralLabel(kind) })}</strong><p>{t("view.emptyDescription")}</p></div>
          : visible.map((item) => <div className={`saved-item-row${selected?.id === item.id ? " is-selected" : ""}`} key={item.id}>
            <button type="button" className="saved-item-main" onClick={() => void open(item)} aria-label={`${item.name}，${item.description || t("view.noDescription")}`}>
              <span><strong>{item.name}</strong><small>{item.description || t("view.noDescription")}</small></span><time>{date(item.createdAt, i18n.language)}</time>
            </button><div className="saved-item-actions">{confirmId === item.id ? <><button type="button" className="button-danger" onClick={() => void remove(item)} aria-label={t("view.confirmDelete", { name: item.name })}>{t("view.confirmDeleteAction")}</button>
              <button type="button" className="button-secondary" onClick={() => setConfirmId(null)}>{t("view.cancel")}</button></>
              : <button type="button" className="icon-button" aria-label={t("view.delete", { name: item.name })} onClick={() => setConfirmId(item.id)}><Trash size={15} /></button>}</div>
          </div>)}{nextCursor !== null && <button type="button" className="saved-items-more" disabled={loadingMore} onClick={() => void more()}>{loadingMore ? t("view.loadingMore") : t("view.loadMore")}</button>}</div>
        <section className="saved-item-detail" aria-live="polite">
          {loadingId !== null ? <p role="status">{t("view.reading")}</p> : selected === null ? <div className="saved-items-empty"><strong>{t("view.selectTitle")}</strong><p>{t("view.selectDescription")}</p></div>
            : <><header><div><span>{kindLabel(selected.kind)}</span><h3>{selected.name}</h3><p>{selected.description || t("view.noDescription")}</p></div>
              <div>{selected.kind === "request" && <button type="button" onClick={() => onLoadRequest(selected.payload as Record<string, unknown>)}><FileArrowDown size={16} />{t("view.loadIntoTab")}</button>}
                {onCreateTest !== undefined && <button type="button" onClick={() => onCreateTest(selected)}><Flask size={16} />{t("view.createTest")}</button>}
                <button type="button" className="button-secondary" onClick={() => void copy(selected.payload)}><Copy size={16} />{t("view.copyJson")}</button></div></header>
              <JsonViewer value={selected.payload} label={t("view.jsonLabel", { kind: kindLabel(selected.kind) })} /></>}
        </section></div>}
  </section>;
}
