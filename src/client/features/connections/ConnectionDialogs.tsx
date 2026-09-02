import { useRef, useState, type FormEvent } from "react";
import { Eye, EyeSlash, Plus, Trash, X } from "@phosphor-icons/react";
import type { ConnectionHeaderDraft } from "./ConnectionPanel.js";
import type { ConnectionAuthMode } from "../../../shared/connection-auth.js";
import { Dialog } from "../../components/overlays/Dialog.js";
import { Select } from "../../components/forms/Select.js";
import { FormField } from "../../components/forms/FormField.js";
import { useTranslation } from "react-i18next";

interface ConnectionFormDialogProps {
  mode: "create" | "edit";
  name: string;
  url: string;
  timeoutMs: string;
  authMode: ConnectionAuthMode;
  bearerToken: string;
  headers: ConnectionHeaderDraft[];
  redactSensitiveInfo: boolean;
  submitting: boolean;
  error: string | null;
  onNameChange: (value: string) => void;
  onUrlChange: (value: string) => void;
  onTimeoutChange: (value: string) => void;
  onAuthModeChange: (value: ConnectionAuthMode) => void;
  onBearerTokenChange: (value: string) => void;
  onRedactSensitiveInfoChange: (value: boolean) => void;
  onAddHeader: () => void;
  onHeaderChange: (id: number, field: "name" | "value", value: string) => void;
  onRemoveHeader: (id: number) => void;
  onSubmit: (event: FormEvent) => void;
  onClose: () => void;
}

export function ConnectionFormDialog({
  mode, name, url, timeoutMs, authMode, bearerToken, headers, redactSensitiveInfo, submitting, error,
  onNameChange, onUrlChange, onTimeoutChange, onAuthModeChange, onBearerTokenChange,
  onRedactSensitiveInfoChange, onAddHeader, onHeaderChange, onRemoveHeader, onSubmit, onClose,
}: ConnectionFormDialogProps) {
  const { t } = useTranslation("servers");
  const nameInput = useRef<HTMLInputElement>(null);
  const [visibleHeaderIds, setVisibleHeaderIds] = useState<ReadonlySet<number>>(() => new Set());
  const [bearerTokenVisible, setBearerTokenVisible] = useState(false);
  const title = mode === "create" ? t("form.createTitle") : t("form.editTitle");
  const description = mode === "create"
    ? t("form.createDescription")
    : t("form.editDescription");

  return (
    <Dialog
      titleId="connection-dialog-title"
      descriptionId="connection-dialog-description"
      initialFocusRef={nameInput}
      onClose={onClose}
      closeDisabled={submitting}
    >
      <div className="dialog-header">
        <div>
          <p className="dialog-kicker">MCP SERVER</p>
          <h3 id="connection-dialog-title">{title}</h3>
          <p id="connection-dialog-description">{description}</p>
        </div>
        <button
          type="button"
          className="dialog-close"
          aria-label={t("form.closeAria", { title })}
          disabled={submitting}
          onClick={onClose}
        ><X size={18} aria-hidden="true" /></button>
      </div>
      <form className="connection-dialog-form" onSubmit={onSubmit}>
        {error !== null && <p role="alert" className="connection-error dialog-error">{error}</p>}
        <div className="connection-fields">
          <FormField label={t("form.name")} htmlFor="connection-name" required>
            <input
              id="connection-name"
              ref={nameInput}
              value={name}
              onChange={(event) => onNameChange(event.target.value)}
              maxLength={120}
              placeholder={t("form.namePlaceholder")}
              required
            />
          </FormField>
          <FormField label={t("form.url")} htmlFor="connection-url" required>
            <input
              id="connection-url"
              value={url}
              onChange={(event) => onUrlChange(event.target.value)}
              type="url"
              placeholder="https://example.com/mcp"
              required
            />
          </FormField>
          <FormField label={t("form.timeout")} htmlFor="connection-timeout" required>
            <input
              id="connection-timeout"
              value={timeoutMs}
              onChange={(event) => onTimeoutChange(event.target.value)}
              type="number"
              min={100}
              max={600000}
              step={1}
              required
            />
          </FormField>
          <FormField label={t("form.authMode")} htmlFor="connection-auth-mode"
            description={authMode === "oauth" ? t("form.oauthDescription") : undefined}>
            <Select id="connection-auth-mode" value={authMode} onChange={(event) => onAuthModeChange(event.target.value as ConnectionAuthMode)}>
              <option value="none">{t("form.auth.none")}</option>
              <option value="bearer">{t("form.auth.bearer")}</option>
              <option value="oauth">{t("form.auth.oauth")}</option>
            </Select>
          </FormField>
          {authMode === "bearer" && (
            <div className="connection-bearer-token">
              <label htmlFor="connection-bearer-token">Bearer Token</label>
              <span className="connection-secret-input">
                <input
                  id="connection-bearer-token"
                  value={bearerToken}
                  onChange={(event) => onBearerTokenChange(event.target.value)}
                  type={bearerTokenVisible ? "text" : "password"}
                  autoComplete="off"
                  maxLength={8192}
                  placeholder={t("form.tokenPlaceholder")}
                  required
                />
                <button
                  type="button"
                  aria-label={bearerTokenVisible ? t("form.hideToken") : t("form.showToken")}
                  aria-pressed={bearerTokenVisible}
                  title={bearerTokenVisible ? t("form.hideToken") : t("form.showToken")}
                  onClick={() => setBearerTokenVisible((visible) => !visible)}
                >{bearerTokenVisible
                    ? <EyeSlash size={17} aria-hidden="true" />
                    : <Eye size={17} aria-hidden="true" />}</button>
              </span>
              <small>{t("form.tokenHint", { variable: "{{VARIABLE_NAME}}" })}</small>
            </div>
          )}
        </div>
        <section className="connection-headers" aria-labelledby="connection-headers-title">
          <div className="connection-headers__heading">
            <div>
              <h4 id="connection-headers-title">{t("form.headersTitle")}</h4>
              <p>{t("form.headersDescription", { variable: "{{VARIABLE_NAME}}" })}</p>
            </div>
            <button type="button" className="button-secondary" onClick={onAddHeader} disabled={submitting || headers.length >= 32}>
              <Plus size={15} weight="bold" aria-hidden="true" />{t("form.addHeader")}
            </button>
          </div>
          {headers.length === 0 ? (
            <p className="connection-headers__empty">{t("form.noHeaders")}</p>
          ) : (
            <div className="connection-headers__list">
              {headers.map((header, index) => (
                <div className="connection-header-row" key={header.id}>
                  <label>
                    <span>{t("form.headerName")}</span>
                    <input
                      aria-label={t("form.headerNameAria", { index: index + 1 })}
                      value={header.name}
                      onChange={(event) => onHeaderChange(header.id, "name", event.target.value)}
                      placeholder={t("form.headerNamePlaceholder")}
                      maxLength={256}
                      required
                    />
                  </label>
                  <label>
                    <span>{t("form.headerValue")}</span>
                    <input
                      aria-label={t("form.headerValueAria", { index: index + 1 })}
                      value={header.value}
                      onChange={(event) => onHeaderChange(header.id, "value", event.target.value)}
                      type={visibleHeaderIds.has(header.id) ? "text" : "password"}
                      autoComplete="off"
                      placeholder={t("form.headerValuePlaceholder")}
                      maxLength={8192}
                    />
                  </label>
                  <button
                    type="button"
                    className="connection-header-row__visibility"
                    aria-label={t(visibleHeaderIds.has(header.id) ? "form.hideHeader" : "form.showHeader", { name: header.name || index + 1 })}
                    title={t(visibleHeaderIds.has(header.id) ? "form.hideHeaderTitle" : "form.showHeaderTitle")}
                    aria-pressed={visibleHeaderIds.has(header.id)}
                    disabled={submitting}
                    onClick={() => setVisibleHeaderIds((current) => {
                      const next = new Set(current);
                      if (next.has(header.id)) next.delete(header.id);
                      else next.add(header.id);
                      return next;
                    })}
                  >
                    {visibleHeaderIds.has(header.id)
                      ? <EyeSlash size={17} aria-hidden="true" />
                      : <Eye size={17} aria-hidden="true" />}
                  </button>
                  <button
                    type="button"
                    className="connection-header-row__remove"
                    aria-label={t("form.deleteHeader", { name: header.name || index + 1 })}
                    disabled={submitting}
                    onClick={() => onRemoveHeader(header.id)}
                  >
                    <Trash size={17} aria-hidden="true" />
                  </button>
                </div>
              ))}
            </div>
          )}
          {authMode !== "none" && (
            <p className="connection-headers__notice">
              {t("form.managedAuthorization", { mode: authMode === "oauth" ? "OAuth" : "Bearer Token" })}
            </p>
          )}
        </section>
        <label className="connection-redaction-option">
          <input type="checkbox" aria-label={t("form.redaction")} checked={redactSensitiveInfo} disabled={submitting}
            onChange={(event) => onRedactSensitiveInfoChange(event.target.checked)} />
          <span><strong>{t("form.redaction")}</strong><small>{t("form.redactionDescription")}</small></span>
        </label>
        {!redactSensitiveInfo && <p role="alert" className="connection-redaction-warning">
          {t("form.redactionWarning")}
        </p>}
        <dl className="connection-fixed-options">
          <div><dt>{t("form.transport")}</dt><dd>Streamable HTTP</dd></div>
        </dl>
        <div className="dialog-actions">
          <button type="button" className="button-secondary" disabled={submitting} onClick={onClose}>{t("form.cancel")}</button>
          <button type="submit" disabled={submitting}>
            {submitting ? t("form.saving") : mode === "create" ? t("form.saveCreate") : t("form.saveEdit")}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

interface DeleteConnectionDialogProps {
  connectionName: string;
  deleting: boolean;
  error: string | null;
  onConfirm: () => void;
  onClose: () => void;
}

export function DeleteConnectionDialog({
  connectionName, deleting, error, onConfirm, onClose,
}: DeleteConnectionDialogProps) {
  const { t } = useTranslation("servers");
  const cancelButton = useRef<HTMLButtonElement>(null);
  return (
    <Dialog
      titleId="delete-connection-dialog-title"
      descriptionId="delete-connection-dialog-description"
      initialFocusRef={cancelButton}
      onClose={onClose}
      closeDisabled={deleting}
    >
      <div className="dialog-header dialog-header--compact">
        <div>
          <p className="dialog-kicker dialog-kicker--danger">DANGER ZONE</p>
          <h3 id="delete-connection-dialog-title">{t("delete.title")}</h3>
          <p id="delete-connection-dialog-description">
            {t("delete.description", { name: connectionName })}
          </p>
        </div>
      </div>
      {error !== null && <p role="alert" className="connection-error dialog-error">{error}</p>}
      <div className="dialog-actions">
        <button ref={cancelButton} type="button" className="button-secondary" disabled={deleting} onClick={onClose}>{t("delete.cancel")}</button>
        <button
          type="button"
          className="button-danger"
          disabled={deleting}
          aria-label={t("delete.confirmAria", { name: connectionName })}
          onClick={onConfirm}
        >{deleting ? t("delete.deleting") : t("delete.confirm")}</button>
      </div>
    </Dialog>
  );
}
