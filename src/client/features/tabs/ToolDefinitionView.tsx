import { useEffect, useRef, useState, type ReactNode } from "react";
import { Question } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import type { ToolDetailSummary } from "../../api/api-client.js";
import { Button } from "../../components/actions/Button.js";
import { IconButton } from "../../components/actions/IconButton.js";
import { StatusBadge, type StatusBadgeStatus } from "../../components/feedback/StatusBadge.js";
import { Disclosure } from "../../components/layout/Disclosure.js";
import { descriptionSections } from "../tools/tool-description.js";

function inlineDescription(text: string): ReactNode[] {
  const tokens = text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g);
  return tokens.filter(Boolean).map((token, index) => {
    if (token.startsWith("`") && token.endsWith("`")) return <code key={index}>{token.slice(1, -1)}</code>;
    if (token.startsWith("**") && token.endsWith("**")) return <strong key={index}>{token.slice(2, -2)}</strong>;
    return token;
  });
}

function schemaRecord(schema: unknown): Record<string, unknown> {
  return typeof schema === "object" && schema !== null && !Array.isArray(schema)
    ? schema as Record<string, unknown>
    : {};
}

function schemaType(field: Record<string, unknown>, combined: string, complex: string): string {
  if (Array.isArray(field.type)) return field.type.map(String).join(" | ");
  if (typeof field.type === "string") return field.type;
  if (Array.isArray(field.enum)) return "enum";
  if (field.anyOf !== undefined || field.oneOf !== undefined || field.allOf !== undefined) return combined;
  return complex;
}

function SchemaTable({ title, schema }: { title: string; schema: unknown }) {
  const { t } = useTranslation("tools");
  const record = schemaRecord(schema);
  const properties = schemaRecord(record.properties);
  const required = new Set(Array.isArray(record.required) ? record.required.filter((item): item is string => typeof item === "string") : []);
  const entries = Object.entries(properties);
  return <section className="definition-schema" aria-labelledby={`${title.replaceAll(" ", "-")}-title`}>
    <div className="definition-section-heading">
      <div><p className="definition-kicker">JSON Schema</p><h3 id={`${title.replaceAll(" ", "-")}-title`}>{title}</h3></div>
      <span>{t("definition.fieldCount", { count: entries.length })}</span>
    </div>
    {entries.length === 0 ? <p className="definition-empty">{t("definition.noTopFields")}</p> :
      <div className="definition-schema-table-wrap"><table aria-label={t("definition.fieldsAria", { title })} className="definition-schema-table">
        <thead><tr><th scope="col">{t("definition.columns.field")}</th><th scope="col">{t("definition.columns.type")}</th><th scope="col">{t("definition.columns.constraint")}</th><th scope="col">{t("definition.columns.description")}</th></tr></thead>
        <tbody>{entries.map(([name, value]) => {
          const field = schemaRecord(value);
          return <tr key={name}>
            <th scope="row"><code>{name}</code></th>
            <td><span className="type-chip">{schemaType(field, t("definition.combined"), t("definition.complex"))}</span></td>
            <td>{required.has(name) ? <span className="required-chip">{t("definition.required")}</span> : <span className="optional-chip">{t("definition.optional")}</span>}</td>
            <td>{typeof field.description === "string" ? field.description : t("definition.unavailable")}</td>
          </tr>;
        })}</tbody>
      </table></div>}
    <Disclosure className="definition-raw" label={t("definition.viewRaw")}>
      <pre>{JSON.stringify(schema ?? {}, null, 2)}</pre>
    </Disclosure>
  </section>;
}

export function ToolDefinitionView({ detail }: { detail: ToolDetailSummary }) {
  const { t, i18n } = useTranslation("tools");
  const [historyHelpOpen, setHistoryHelpOpen] = useState(false);
  const historyHelpRef = useRef<HTMLDivElement>(null);
  const snapshot = detail.tool.currentSnapshot;
  const definition = snapshot.definition;
  const annotations = definition.annotations ?? {};
  const annotationLabels = {
    readOnlyHint: [t("definition.annotations.readOnly"), t("definition.annotations.writable")],
    destructiveHint: [t("definition.annotations.destructive"), t("definition.annotations.nonDestructive")],
    idempotentHint: [t("definition.annotations.idempotent"), t("definition.annotations.nonIdempotent")],
    openWorldHint: [t("definition.annotations.openWorld"), t("definition.annotations.closedWorld")],
  } as const;
  const statusPresentation: Record<ToolDetailSummary["tool"]["status"], { label: string; status: StatusBadgeStatus }> = {
    current: { label: t("definition.status.current"), status: "success" },
    changed: { label: t("definition.status.changed"), status: "warning" },
    removed: { label: t("definition.status.removed"), status: "danger" },
  };
  const displayedStatus = statusPresentation[detail.tool.status];
  const behaviors = Object.entries(annotationLabels).flatMap(([key, labels]) => {
    const value = annotations[key as keyof typeof annotationLabels];
    return typeof value === "boolean" ? [{ key, label: labels[value ? 0 : 1], warning: key === "destructiveHint" && value }] : [];
  });

  useEffect(() => { setHistoryHelpOpen(false); }, [snapshot.id]);
  useEffect(() => {
    if (!historyHelpOpen) return;
    function dismiss(event: PointerEvent): void {
      if (event.target instanceof Node && !historyHelpRef.current?.contains(event.target)) setHistoryHelpOpen(false);
    }
    function escape(event: KeyboardEvent): void { if (event.key === "Escape") setHistoryHelpOpen(false); }
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", dismiss); document.removeEventListener("keydown", escape); };
  }, [historyHelpOpen]);

  async function copyDefinition(): Promise<void> {
    try {
      await navigator.clipboard.writeText(JSON.stringify(definition, null, 2));
      toast.success(t("definition.copied"));
    } catch {
      toast.error(t("definition.copyFailed"));
    }
  }

  return <article className="tool-definition" aria-label={t("definition.aria", { name: definition.name })} tabIndex={0}>
    <header className="tool-definition__header">
      <div><h2>{detail.tool.name}</h2>
        {definition.title !== undefined && <p className="tool-definition__title">{definition.title}</p>}</div>
      <div className="definition-copy"><Button variant="primary" onClick={() => void copyDefinition()}>{t("definition.copyComplete")}</Button></div>
    </header>

    <section className="tool-description" aria-label={t("definition.descriptionAria")}>
      {descriptionSections(definition.description, {
        fallbackTitle: t("definition.descriptionFallbackTitle"), unavailable: t("definition.descriptionUnavailable"),
      }).map((section, index) => <section key={`${section.title}:${index}`}>
        <h3>{section.title}</h3>{section.content.length > 0 && <p>{inlineDescription(section.content)}</p>}
      </section>)}
    </section>

    <dl className="definition-metadata">
      <div><dt>{t("definition.schemaHash")}</dt><dd title={snapshot.contentHash}><code>{snapshot.contentHash}</code></dd></div>
      <div><dt>{t("definition.snapshotTime")}</dt><dd><time dateTime={snapshot.createdAt}>{new Date(snapshot.createdAt).toLocaleString(i18n.language)}</time></dd></div>
      <div><dt>{t("definition.statusLabel")}</dt><dd><StatusBadge status={displayedStatus.status}>{displayedStatus.label}</StatusBadge></dd></div>
    </dl>

    <section className="definition-behavior" aria-labelledby="tool-behavior-title">
      <div className="definition-section-heading"><div><p className="definition-kicker">BEHAVIOR</p><h3 id="tool-behavior-title">{t("definition.behavior")}</h3></div></div>
      {behaviors.length === 0 ? <p className="definition-empty">{t("definition.noAnnotations")}</p> : <ul>{behaviors.map((behavior) => <li key={behavior.key}
        className={behavior.warning ? "annotation-chip annotation-chip--warning" : "annotation-chip"}>{behavior.label}</li>)}</ul>}
      <Disclosure className="definition-raw" label={t("definition.viewExtensions")}><pre>{JSON.stringify({
        annotations: definition.annotations ?? {}, execution: definition.execution ?? {}, _meta: definition._meta ?? {},
      }, null, 2)}</pre></Disclosure>
    </section>

    <SchemaTable title="Input Schema" schema={definition.inputSchema} />
    <SchemaTable title="Output Schema" schema={definition.outputSchema ?? {}} />

    <section className="definition-history" aria-labelledby="definition-history-title">
      <div className="definition-section-heading"><div><p className="definition-kicker">VERSIONS</p><h3 id="definition-history-title">{t("definition.history")}</h3></div>
        <div className="definition-history-heading-actions" ref={historyHelpRef}><span>{t("definition.historyCount", { count: detail.snapshots.length })}</span>
          <IconButton className="definition-history-help" size="compact" label={t("definition.historyHelp")}
            icon={<Question size={16} weight="bold" aria-hidden="true" />} aria-expanded={historyHelpOpen}
            onClick={() => setHistoryHelpOpen((current) => !current)} />
          {historyHelpOpen && <p className="definition-history-help-popover" role="tooltip">{t("definition.historyExplanation")}</p>}
        </div>
      </div>
      {detail.snapshots.length === 0 ? <p className="definition-empty">{t("definition.noHistory")}</p> : <ol>{detail.snapshots.map((item) =>
        <li key={item.id}><time dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleString(i18n.language)}</time><code>{item.contentHash}</code></li>)}</ol>}
    </section>
  </article>;
}
