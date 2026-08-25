import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { X } from "@phosphor-icons/react";
import type { InspectorApiClient, SavedItemKind } from "../../api/api-client.js";

export function SavedItemDialog({ api, projectId, connectionId, toolName, kind, payload, sourceRunId, onClose, onSaved }: {
  api: InspectorApiClient; projectId: string; connectionId: string; toolName: string; kind: SavedItemKind;
  payload: unknown; sourceRunId: string | null; onClose: () => void; onSaved: () => void;
}) {
  const titleId = useId(); const nameRef = useRef<HTMLInputElement>(null); const surfaceRef = useRef<HTMLElement>(null);
  const [name, setName] = useState(""); const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false); const [error, setError] = useState<string | null>(null);
  useEffect(() => { const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    nameRef.current?.focus(); return () => trigger?.focus(); }, []);
  useEffect(() => {
    function key(event: KeyboardEvent) { if (event.key === "Escape" && !saving) onClose(); }
    document.addEventListener("keydown", key); return () => document.removeEventListener("keydown", key);
  }, [onClose, saving]);
  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault(); if (saving || name.trim().length === 0) return;
    setSaving(true); setError(null);
    try {
      await api.createSavedItem(projectId, connectionId, toolName, { kind, name: name.trim(), description, payload, sourceRunId });
      onSaved();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "保存失败"); setSaving(false); }
  }
  const label = kind === "request" ? "请求" : "响应";
  return <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) onClose(); }}>
    <section ref={surfaceRef} className="dialog-surface saved-item-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId}
      onKeyDown={(event) => { if (event.key !== "Tab") return;
        const controls = [...(surfaceRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), textarea:not([disabled])') ?? [])];
        if (controls.length === 0) return; const first = controls[0]; const last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }}>
      <header className="dialog-header"><div><p className="dialog-kicker">{toolName}</p><h3 id={titleId}>保存{label}</h3>
        <p>保存为当前 Tool 的可复用测试资产。</p></div><button type="button" className="dialog-close" aria-label="关闭" disabled={saving} onClick={onClose}><X size={18} /></button></header>
      <form onSubmit={(event) => void submit(event)} className="saved-item-form">
        <label>名称 <input ref={nameRef} required maxLength={120} value={name} onChange={(event) => setName(event.target.value)} placeholder={`例如：${label}成功基线`} /></label>
        <label>描述 <textarea maxLength={1000} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="说明适用场景、前置条件或预期结果（可选）" /></label>
        {error !== null && <p className="dialog-error" role="alert">{error}</p>}
        <div className="dialog-actions"><button type="button" className="button-secondary" disabled={saving} onClick={onClose}>取消</button>
          <button type="submit" aria-label={`确认保存${label}`} disabled={saving || name.trim().length === 0}>{saving ? "保存中…" : `保存${label}`}</button></div>
      </form>
    </section>
  </div>;
}
