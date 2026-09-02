import { FloppyDisk, Play, Stop, Trash } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import type { CatalogToolSummary, ConnectionSummary, DebugTabSummary } from "../../api/api-client.js";
import { Button } from "../../components/actions/Button.js";
import { FormField } from "../../components/forms/FormField.js";
import { Select } from "../../components/forms/Select.js";
import { ParameterEditor } from "../tabs/ParameterEditor.js";
import { AssertionEditor } from "./AssertionEditor.js";
import type { ToolTestCaseDraft } from "./test-case-draft.js";
import { parameterTabFromDraft } from "./test-case-draft.js";
import type { JsonObject } from "../../../shared/tool-definition.js";

interface Props {
  projectId: string;
  draft: ToolTestCaseDraft;
  connections: ConnectionSummary[];
  tools: CatalogToolSummary[];
  tool: CatalogToolSummary | null;
  loadingTools: boolean;
  saving: boolean;
  onChange: (draft: ToolTestCaseDraft) => void;
  onConnectionChange: (connectionId: string) => void;
  onToolChange: (toolName: string) => void;
  onSave: () => void;
  onCancel: () => void;
  onDelete?: () => void;
  canExecute: boolean;
  executing: boolean;
  onExecute: () => void;
  onCancelExecution: () => void;
}

export function ToolTestCaseEditor({ projectId, draft, connections, tools, tool, loadingTools, saving,
  onChange, onConnectionChange, onToolChange, onSave, onCancel, onDelete,
  canExecute, executing, onExecute, onCancelExecution }: Props) {
  const { t } = useTranslation("testing");
  const tab = parameterTabFromDraft(projectId, draft);
  function updateParameter(patch: Partial<DebugTabSummary>): void {
    onChange({ ...draft,
      arguments: (patch.arguments as JsonObject | undefined) ?? draft.arguments,
      rawText: patch.rawText ?? draft.rawText,
      inputMode: patch.inputMode ?? draft.inputMode,
    });
  }
  return <article className="testing-editor" aria-labelledby="testing-editor-title">
    <header className="testing-editor__header"><div>
      <h2 id="testing-editor-title">{t(draft.id === null ? "editor.createTitle" : "editor.editTitle")}</h2>
      <p>{t("editor.intro")}</p>
    </div><div className="testing-editor__actions">
      {draft.id !== null && (executing
        ? <Button variant="secondary" onClick={onCancelExecution}><Stop size={15} weight="fill" />{t("execution.cancel")}</Button>
        : <Button variant="primary" disabled={!canExecute} onClick={onExecute}><Play size={15} weight="fill" />{t("execution.run")}</Button>)}
      {onDelete !== undefined && <Button variant="danger" onClick={onDelete}><Trash size={15} />{t("editor.delete")}</Button>}
      <Button variant="secondary" onClick={onCancel}>{t("editor.cancel")}</Button>
      <Button variant="primary" loading={saving} loadingLabel={t("editor.saving")} onClick={onSave}>
        <FloppyDisk size={15} />{t("editor.save")}
      </Button>
    </div></header>

    {draft.previewWarnings.length > 0 && <section className="testing-preview-warning" role="status" aria-labelledby="testing-preview-title">
      <strong id="testing-preview-title">{t("editor.previewTitle")}</strong><ul>{draft.previewWarnings.map((warning) => <li key={warning}>{t({
        SECRET_OMITTED: "editor.warningSecret", RESPONSE_TRUNCATED: "editor.warningTruncated", BASELINE_UNAVAILABLE: "editor.warningBaseline",
        TOOL_REMOVED: "editor.warningToolRemoved", TOOL_DEFINITION_CHANGED: "editor.warningToolChanged",
      }[warning])}</li>)}</ul>
    </section>}

    <section className="testing-editor-section" aria-labelledby="testing-basics-title">
      <h3 id="testing-basics-title">{t("editor.basics")}</h3>
      <div className="testing-basics-grid">
        <FormField htmlFor="testing-name" label={t("editor.name")} required><input id="testing-name" className="ui-input" maxLength={120}
          value={draft.name} placeholder={t("editor.namePlaceholder")} onChange={(event) => onChange({ ...draft, name: event.target.value })} /></FormField>
        <FormField htmlFor="testing-tags" label={t("editor.tags")} description={t("editor.tagsHint")}><input id="testing-tags" className="ui-input"
          value={draft.tagsText} onChange={(event) => onChange({ ...draft, tagsText: event.target.value })} /></FormField>
        <FormField htmlFor="testing-description" label={t("editor.description")} className="testing-field--wide"><textarea id="testing-description" className="ui-input" rows={3}
          maxLength={2000} value={draft.description} placeholder={t("editor.descriptionPlaceholder")}
          onChange={(event) => onChange({ ...draft, description: event.target.value })} /></FormField>
        <label className="testing-enabled"><input type="checkbox" checked={draft.isEnabled}
          onChange={(event) => onChange({ ...draft, isEnabled: event.target.checked })} /><span>{t("editor.enabled")}</span></label>
      </div>
    </section>

    <section className="testing-editor-section" aria-labelledby="testing-target-title">
      <h3 id="testing-target-title">{t("editor.target")}</h3>
      <div className="testing-target-grid">
        <FormField htmlFor="testing-connection" label={t("editor.connection")} required><Select id="testing-connection" value={draft.connectionId}
          onChange={(event) => onConnectionChange(event.target.value)}><option value="">{t("editor.selectConnection")}</option>
          {connections.map((connection) => <option key={connection.id} value={connection.id}>{connection.name}</option>)}</Select></FormField>
        <FormField htmlFor="testing-tool" label={t("editor.tool")} required><Select id="testing-tool" value={draft.toolName} disabled={draft.connectionId === "" || loadingTools}
          onChange={(event) => onToolChange(event.target.value)}><option value="">{loadingTools ? t("editor.loadingTools") : t("editor.selectTool")}</option>
          {tools.map((item) => <option key={item.name} value={item.name}>{item.name}</option>)}</Select></FormField>
      </div>
      {!loadingTools && draft.connectionId !== "" && tools.length === 0 && <p role="status" className="testing-empty-copy">{t("editor.noTools")}</p>}
      {tool?.status === "removed" && <p role="alert" className="testing-warning">{t("editor.toolRemoved")}</p>}
      {tool?.status === "changed" && <p role="status" className="testing-warning">{t("editor.toolChanged")}</p>}
    </section>

    {tool !== null && tool.status !== "removed" && <section className="testing-editor-section testing-arguments" aria-labelledby="testing-arguments-title">
      <h3 id="testing-arguments-title">{t("editor.arguments")}</h3>
      <ParameterEditor tab={tab} schema={tool.currentSnapshot.definition.inputSchema} onChange={updateParameter} showExecute={false} />
    </section>}

    <AssertionEditor value={draft.assertions} onChange={(assertions) => onChange({ ...draft, assertions })} />

    <section className="testing-editor-section" aria-labelledby="testing-timeout-title">
      <h3 id="testing-timeout-title">{t("editor.timeout")}</h3>
      <FormField htmlFor="testing-timeout" label={t("editor.timeoutMs")}><input id="testing-timeout" className="ui-input" type="number" min={1} max={3600000}
        value={draft.timeoutText} onChange={(event) => onChange({ ...draft, timeoutText: event.target.value })} /></FormField>
    </section>
  </article>;
}
