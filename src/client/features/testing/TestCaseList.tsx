import { MagnifyingGlass } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import type { TestCaseSummary } from "../../../shared/testing/test-case.js";
import { StatusBadge } from "../../components/feedback/StatusBadge.js";

interface Props {
  items: TestCaseSummary[];
  selectedId: string | null;
  loading: boolean;
  error: string | null;
  query: string;
  onQueryChange: (query: string) => void;
  onSelect: (id: string) => void;
  onRetry: () => void;
  onCreate: () => void;
}

export function TestCaseList({ items, selectedId, loading, error, query, onQueryChange, onSelect, onRetry, onCreate }: Props) {
  const { t } = useTranslation("testing");
  return <aside className="testing-case-list" aria-labelledby="testing-case-list-title">
    <header><h2 id="testing-case-list-title">{t("list.title")}</h2><span>{items.length}</span></header>
    <label className="testing-case-search"><MagnifyingGlass size={16} aria-hidden="true" />
      <span className="sr-only">{t("list.search")}</span>
      <input value={query} placeholder={t("list.search")} onChange={(event) => onQueryChange(event.target.value)} />
    </label>
    {loading && <p role="status" className="testing-list-status">{t("list.loading")}</p>}
    {!loading && error !== null && <div role="alert" className="testing-list-error"><strong>{t("list.loadFailed")}</strong><p>{error}</p>
      <button type="button" onClick={onRetry}>{t("list.loadFailed")}</button></div>}
    {!loading && error === null && items.length === 0 && <div className="testing-list-empty">
      <strong>{t("list.emptyTitle")}</strong><p>{t("list.emptyHint")}</p><button type="button" onClick={onCreate}>{t("newCase")}</button>
    </div>}
    {!loading && error === null && items.length > 0 && <ul>
      {items.map((item) => <li key={item.id}><button type="button" aria-current={selectedId === item.id ? "true" : undefined}
        onClick={() => onSelect(item.id)}><span><strong>{item.name}</strong><small>{item.description || t(item.kind === "scenario" ? "list.scenario" : "list.tool")}</small></span>
        <StatusBadge status={item.isEnabled ? "success" : "idle"}>{t(item.isEnabled ? "list.enabled" : "list.disabled")}</StatusBadge></button></li>)}
    </ul>}
  </aside>;
}
