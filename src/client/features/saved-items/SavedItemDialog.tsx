import { useId, useRef, useState, type FormEvent } from "react";
import { X } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import type { InspectorApiClient, SavedItemKind } from "../../api/api-client.js";
import { Dialog } from "../../components/overlays/Dialog.js";

export function SavedItemDialog({ api, projectId, connectionId, toolName, kind, payload, sourceRunId, onClose, onSaved }: {
  api: InspectorApiClient; projectId: string; connectionId: string; toolName: string; kind: SavedItemKind;
  payload: unknown; sourceRunId: string | null; onClose: () => void; onSaved: () => void;
}) {
  const { t } = useTranslation("savedItems");
  const titleId = useId(); const nameRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(""); const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false); const [error, setError] = useState<string | null>(null);
  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault(); if (saving || name.trim().length === 0) return;
    setSaving(true); setError(null);
    try {
      await api.createSavedItem(projectId, connectionId, toolName, { kind, name: name.trim(), description, payload, sourceRunId });
      onSaved();
    } catch (reason) { setError(reason instanceof Error ? reason.message : t("errors.save")); setSaving(false); }
  }
  const label = t(`kind.${kind}`);
  return <Dialog className="saved-item-dialog" titleId={titleId} initialFocusRef={nameRef} onClose={onClose} closeDisabled={saving}>
      <header className="dialog-header"><div><p className="dialog-kicker">{toolName}</p><h3 id={titleId}>{t("dialog.title", { kind: label })}</h3>
        <p>{t("dialog.description")}</p></div><button type="button" className="dialog-close" aria-label={t("dialog.close")} disabled={saving} onClick={onClose}><X size={18} /></button></header>
      <form onSubmit={(event) => void submit(event)} className="saved-item-form">
        <label>{t("dialog.name")} <input ref={nameRef} required maxLength={120} value={name} onChange={(event) => setName(event.target.value)} placeholder={t("dialog.namePlaceholder", { kind: label })} /></label>
        <label>{t("dialog.descriptionLabel")} <textarea maxLength={1000} value={description} onChange={(event) => setDescription(event.target.value)} placeholder={t("dialog.descriptionPlaceholder")} /></label>
        {error !== null && <p className="dialog-error" role="alert">{error}</p>}
        <div className="dialog-actions"><button type="button" className="button-secondary" disabled={saving} onClick={onClose}>{t("dialog.cancel")}</button>
          <button type="submit" aria-label={t("dialog.confirm", { kind: label })} disabled={saving || name.trim().length === 0}>{saving ? t("dialog.saving") : t("dialog.save", { kind: label })}</button></div>
      </form>
  </Dialog>;
}
