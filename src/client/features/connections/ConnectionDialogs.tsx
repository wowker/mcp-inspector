import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import { Eye, EyeSlash, Plus, Trash, X } from "@phosphor-icons/react";
import type { ConnectionHeaderDraft } from "./ConnectionPanel.js";
import type { ConnectionAuthMode } from "../../../shared/connection-auth.js";

interface DialogSurfaceProps {
  children: ReactNode;
  labelledBy: string;
  describedBy?: string;
  initialFocusRef: React.RefObject<HTMLElement | null>;
  onClose: () => void;
  closeDisabled?: boolean;
}

function DialogSurface({
  children, labelledBy, describedBy, initialFocusRef, onClose, closeDisabled = false,
}: DialogSurfaceProps) {
  const surfaceRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    initialFocusRef.current?.focus();
  }, [initialFocusRef]);

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.key === "Escape" && !closeDisabled) {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = [...(surfaceRef.current?.querySelectorAll<HTMLElement>(
      "button, input, select, textarea, [tabindex]",
    ) ?? [])].filter((element) =>
      !element.hasAttribute("disabled") && element.getAttribute("tabindex") !== "-1");
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable.at(-1);
    if (event.shiftKey && event.target === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && event.target === last) {
      event.preventDefault();
      first?.focus();
    }
  }

  return (
    <div
      className="dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !closeDisabled) onClose();
      }}
    >
      <div
        ref={surfaceRef}
        className="dialog-surface"
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        onKeyDown={handleKeyDown}
      >
        {children}
      </div>
    </div>
  );
}

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
  const nameInput = useRef<HTMLInputElement>(null);
  const [visibleHeaderIds, setVisibleHeaderIds] = useState<ReadonlySet<number>>(() => new Set());
  const [bearerTokenVisible, setBearerTokenVisible] = useState(false);
  const title = mode === "create" ? "添加连接" : "编辑连接";
  const description = mode === "create"
    ? "保存连接配置后，可从列表中手动发起连接。"
    : "保存修改会断开当前连接，需要重新连接后才能继续调试。";

  return (
    <DialogSurface
      labelledBy="connection-dialog-title"
      describedBy="connection-dialog-description"
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
          aria-label={`关闭${title}弹窗`}
          disabled={submitting}
          onClick={onClose}
        ><X size={18} aria-hidden="true" /></button>
      </div>
      <form className="connection-dialog-form" onSubmit={onSubmit}>
        {error !== null && <p role="alert" className="connection-error dialog-error">{error}</p>}
        <div className="connection-fields">
          <label>
            <span>连接名称</span>
            <input
              ref={nameInput}
              value={name}
              onChange={(event) => onNameChange(event.target.value)}
              maxLength={120}
              placeholder="例如：商品服务 MCP"
              required
            />
          </label>
          <label>
            <span>MCP URL</span>
            <input
              value={url}
              onChange={(event) => onUrlChange(event.target.value)}
              type="url"
              placeholder="https://example.com/mcp"
              required
            />
          </label>
          <label>
            <span>请求超时（毫秒）</span>
            <input
              value={timeoutMs}
              onChange={(event) => onTimeoutChange(event.target.value)}
              type="number"
              min={100}
              max={600000}
              step={1}
              required
            />
          </label>
          <label>
            <span>认证方式</span>
            <select value={authMode} onChange={(event) => onAuthModeChange(event.target.value as ConnectionAuthMode)}>
              <option value="none">无认证</option>
              <option value="bearer">Bearer Token</option>
              <option value="oauth">OAuth 自动授权</option>
            </select>
            {authMode === "oauth" && <small>首次连接会打开浏览器完成授权。</small>}
          </label>
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
                  placeholder="请输入 Bearer Token"
                  required
                />
                <button
                  type="button"
                  aria-label={bearerTokenVisible ? "隐藏 Bearer Token" : "显示 Bearer Token"}
                  aria-pressed={bearerTokenVisible}
                  title={bearerTokenVisible ? "隐藏 Bearer Token" : "显示 Bearer Token"}
                  onClick={() => setBearerTokenVisible((visible) => !visible)}
                >{bearerTokenVisible
                    ? <EyeSlash size={17} aria-hidden="true" />
                    : <Eye size={17} aria-hidden="true" />}</button>
              </span>
              <small>连接、刷新 Tool 和调用 Tool 时自动发送 Authorization Header。</small>
            </div>
          )}
        </div>
        <section className="connection-headers" aria-labelledby="connection-headers-title">
          <div className="connection-headers__heading">
            <div>
              <h4 id="connection-headers-title">自定义 Headers</h4>
              <p>连接、刷新 Tool 和调用 Tool 时都会发送。敏感值仅保存在本地项目中。</p>
            </div>
            <button type="button" className="button-secondary" onClick={onAddHeader} disabled={submitting || headers.length >= 32}>
              <Plus size={15} weight="bold" aria-hidden="true" />添加 Header
            </button>
          </div>
          {headers.length === 0 ? (
            <p className="connection-headers__empty">未配置自定义 Header</p>
          ) : (
            <div className="connection-headers__list">
              {headers.map((header, index) => (
                <div className="connection-header-row" key={header.id}>
                  <label>
                    <span>名称</span>
                    <input
                      aria-label={`Header 名称 ${index + 1}`}
                      value={header.name}
                      onChange={(event) => onHeaderChange(header.id, "name", event.target.value)}
                      placeholder="例如 X-API-Key"
                      maxLength={256}
                      required
                    />
                  </label>
                  <label>
                    <span>值</span>
                    <input
                      aria-label={`Header 值 ${index + 1}`}
                      value={header.value}
                      onChange={(event) => onHeaderChange(header.id, "value", event.target.value)}
                      type={visibleHeaderIds.has(header.id) ? "text" : "password"}
                      autoComplete="off"
                      placeholder="输入 Header 值"
                      maxLength={8192}
                    />
                  </label>
                  <button
                    type="button"
                    className="connection-header-row__visibility"
                    aria-label={`${visibleHeaderIds.has(header.id) ? "隐藏" : "显示"} Header ${header.name || index + 1}`}
                    title={visibleHeaderIds.has(header.id) ? "隐藏 Header 值" : "显示 Header 值"}
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
                    aria-label={`删除 Header ${header.name || index + 1}`}
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
              {authMode === "oauth" ? "OAuth" : "Bearer Token"} 模式下 Authorization 由认证方式自动管理。
            </p>
          )}
        </section>
        <label className="connection-redaction-option">
          <input type="checkbox" aria-label="信息脱敏" checked={redactSensitiveInfo} disabled={submitting}
            onChange={(event) => onRedactSensitiveInfoChange(event.target.checked)} />
          <span><strong>信息脱敏</strong><small>隐藏 Authorization、Cookie、API Key 等敏感 HTTP Header。</small></span>
        </label>
        {!redactSensitiveInfo && <p role="alert" className="connection-redaction-warning">
          关闭后，敏感 Header 将以原文写入本地 SQLite 运行记录，并显示在调用详情中。
        </p>}
        <dl className="connection-fixed-options">
          <div><dt>传输方式</dt><dd>Streamable HTTP</dd></div>
        </dl>
        <div className="dialog-actions">
          <button type="button" className="button-secondary" disabled={submitting} onClick={onClose}>取消</button>
          <button type="submit" disabled={submitting}>
            {submitting ? "正在保存…" : mode === "create" ? "保存连接" : "保存修改"}
          </button>
        </div>
      </form>
    </DialogSurface>
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
  const cancelButton = useRef<HTMLButtonElement>(null);
  return (
    <DialogSurface
      labelledBy="delete-connection-dialog-title"
      describedBy="delete-connection-dialog-description"
      initialFocusRef={cancelButton}
      onClose={onClose}
      closeDisabled={deleting}
    >
      <div className="dialog-header dialog-header--compact">
        <div>
          <p className="dialog-kicker dialog-kicker--danger">DANGER ZONE</p>
          <h3 id="delete-connection-dialog-title">删除连接</h3>
          <p id="delete-connection-dialog-description">
            确认删除 {connectionName}？已保存的 Tool 快照也将从当前项目移除。
          </p>
        </div>
      </div>
      {error !== null && <p role="alert" className="connection-error dialog-error">{error}</p>}
      <div className="dialog-actions">
        <button ref={cancelButton} type="button" className="button-secondary" disabled={deleting} onClick={onClose}>取消</button>
        <button
          type="button"
          className="button-danger"
          disabled={deleting}
          aria-label={`确认删除 ${connectionName}`}
          onClick={onConfirm}
        >{deleting ? "正在删除…" : "确认删除"}</button>
      </div>
    </DialogSurface>
  );
}
