import { FloppyDisk, Play, Stop, Trash } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { CatalogToolSummary, ConnectionSummary, DebugTabSummary } from "../../api/api-client.js";
import { Button } from "../../components/actions/Button.js";
import { FormField } from "../../components/forms/FormField.js";
import { SearchableSelect } from "../../components/forms/SearchableSelect.js";
import { Switch } from "../../components/forms/Switch.js";
import { Disclosure } from "../../components/layout/Disclosure.js";
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
  const [basicsExpanded, setBasicsExpanded] = useState(draft.id === null);
  const [configurationExpanded, setConfigurationExpanded] = useState(draft.id === null);
  const [argumentsExpanded, setArgumentsExpanded] = useState(draft.id === null);
  const [assertionsExpanded, setAssertionsExpanded] = useState(false);
  const tab = parameterTabFromDraft(projectId, draft);
  useEffect(() => {
    const expanded = draft.id === null;
    setBasicsExpanded(expanded);
    setConfigurationExpanded(expanded);
    setArgumentsExpanded(expanded);
    setAssertionsExpanded(false);
  }, [draft.id]);
  useEffect(() => {
    if (draft.id !== null) setArgumentsExpanded(false);
  }, [draft.id, draft.revision]);
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
      <Button variant="primary" loading={saving} loadingLabel={t("editor.saving")} onClick={onSave}>
        <FloppyDisk size={15} />{t("editor.save")}
      </Button>
      <Button variant="secondary" onClick={onCancel}>{t("editor.cancel")}</Button>
      {onDelete !== undefined && <Button variant="danger" onClick={onDelete}><Trash size={15} />{t("editor.delete")}</Button>}
    </div></header>

    {draft.previewWarnings.length > 0 && <section className="testing-preview-warning" role="status" aria-labelledby="testing-preview-title">
      <strong id="testing-preview-title">{t("editor.previewTitle")}</strong><ul>{draft.previewWarnings.map((warning) => <li key={warning}>{t({
        SECRET_OMITTED: "editor.warningSecret", RESPONSE_TRUNCATED: "editor.warningTruncated", BASELINE_UNAVAILABLE: "editor.warningBaseline",
        TOOL_REMOVED: "editor.warningToolRemoved", TOOL_DEFINITION_CHANGED: "editor.warningToolChanged",
      }[warning])}</li>)}</ul>
    </section>}

    <Disclosure label={t("editor.basics")} expanded={basicsExpanded} onExpandedChange={setBasicsExpanded}
      className="testing-basics-disclosure" contentClassName="testing-basics-grid">
        <FormField htmlFor="testing-name" label={t("editor.name")} required><input id="testing-name" className="ui-input" maxLength={120}
          value={draft.name} placeholder={t("editor.namePlaceholder")} onChange={(event) => onChange({ ...draft, name: event.target.value })} /></FormField>
        <FormField htmlFor="testing-description" label={t("editor.description")} className="testing-field--wide"><textarea id="testing-description" className="ui-input" rows={3}
          maxLength={2000} value={draft.description} placeholder={t("editor.descriptionPlaceholder")}
          onChange={(event) => onChange({ ...draft, description: event.target.value })} /></FormField>
        <Switch className="testing-enabled" checked={draft.isEnabled} label={t("editor.enabled")}
          onLabel={t("editor.enabledOn")} offLabel={t("editor.enabledOff")}
          showState={false}
          onChange={(isEnabled) => onChange({ ...draft, isEnabled })} />
    </Disclosure>

    <Disclosure label={t("editor.configuration")} expanded={configurationExpanded} onExpandedChange={setConfigurationExpanded}
      className="testing-basics-disclosure" contentClassName="testing-configuration-grid">
      <FormField htmlFor="testing-connection" label={t("editor.connection")} required><SearchableSelect id="testing-connection"
        value={draft.connectionId || null} options={connections.map((connection) => ({ value: connection.id, label: connection.name }))}
        onChange={(connectionId) => onConnectionChange(connectionId ?? "")} placeholder={t("editor.selectConnection")}
        searchPlaceholder={t("editor.searchConnection")} emptyMessage={t("editor.noConnections")}
        clearable clearLabel={t("editor.clearConnection")} required /></FormField>
      <FormField htmlFor="testing-tool" label={t("editor.tool")} required><SearchableSelect id="testing-tool"
        value={draft.toolName || null} options={tools.map((item) => ({ value: item.name, label: item.name, keywords: [item.currentSnapshot.definition.description ?? ""] }))}
        onChange={(toolName) => onToolChange(toolName ?? "")} disabled={draft.connectionId === ""} loading={loadingTools}
        placeholder={loadingTools ? t("editor.loadingTools") : t("editor.selectTool")} searchPlaceholder={t("editor.searchTool")}
        emptyMessage={t("editor.noTools")} loadingMessage={t("editor.loadingTools")}
        clearable clearLabel={t("editor.clearTool")} required /></FormField>
      <FormField htmlFor="testing-timeout" label={t("editor.timeoutMs")}><input id="testing-timeout" className="ui-input" type="number" min={1} max={3600000}
        value={draft.timeoutText} onChange={(event) => onChange({ ...draft, timeoutText: event.target.value })} /></FormField>
      {!loadingTools && draft.connectionId !== "" && tools.length === 0 && <p role="status" className="testing-empty-copy">{t("editor.noTools")}</p>}
      {tool?.status === "removed" && <p role="alert" className="testing-warning">{t("editor.toolRemoved")}</p>}
      {tool?.status === "changed" && <p role="status" className="testing-warning">{t("editor.toolChanged")}</p>}
    </Disclosure>

    {tool !== null && tool.status !== "removed" && <Disclosure label={t("editor.arguments")}
      expanded={argumentsExpanded} onExpandedChange={setArgumentsExpanded}
      className="testing-basics-disclosure testing-arguments-disclosure">
      <ParameterEditor tab={tab} schema={tool.currentSnapshot.definition.inputSchema} onChange={updateParameter}
        showExecute={false} expanded showExpandToggle={false} />
    </Disclosure>}

    <Disclosure label={t("editor.assertions")} expanded={assertionsExpanded} onExpandedChange={setAssertionsExpanded}
      className="testing-basics-disclosure testing-assertions-disclosure">
      <AssertionEditor value={draft.assertions} onChange={(assertions) => onChange({ ...draft, assertions })} hideTitle />
    </Disclosure>

  </article>;
}
