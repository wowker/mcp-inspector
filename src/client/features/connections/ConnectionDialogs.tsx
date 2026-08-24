import { useEffect, useRef, type FormEvent, type KeyboardEvent, type ReactNode } from "react";

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
  authMode: "none" | "oauth";
  submitting: boolean;
  error: string | null;
  onNameChange: (value: string) => void;
  onUrlChange: (value: string) => void;
  onTimeoutChange: (value: string) => void;
  onAuthModeChange: (value: "none" | "oauth") => void;
  onSubmit: (event: FormEvent) => void;
  onClose: () => void;
}

export function ConnectionFormDialog({
  mode, name, url, timeoutMs, authMode, submitting, error,
  onNameChange, onUrlChange, onTimeoutChange, onAuthModeChange, onSubmit, onClose,
}: ConnectionFormDialogProps) {
  const nameInput = useRef<HTMLInputElement>(null);
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
        >×</button>
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
            <select value={authMode} onChange={(event) => onAuthModeChange(event.target.value as "none" | "oauth")}>
              <option value="none">无认证</option>
              <option value="oauth">OAuth 自动授权</option>
            </select>
            {authMode === "oauth" && <small>首次连接会打开浏览器完成授权。</small>}
          </label>
        </div>
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
