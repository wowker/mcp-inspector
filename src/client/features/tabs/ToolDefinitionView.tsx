import { useEffect, useRef, useState, type ReactNode } from "react";
import { Question } from "@phosphor-icons/react";
import { toast } from "sonner";
import type { ToolDetailSummary } from "../../api/api-client.js";
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

function schemaType(field: Record<string, unknown>): string {
  if (Array.isArray(field.type)) return field.type.map(String).join(" | ");
  if (typeof field.type === "string") return field.type;
  if (Array.isArray(field.enum)) return "enum";
  if (field.anyOf !== undefined || field.oneOf !== undefined || field.allOf !== undefined) return "组合结构";
  return "复杂结构";
}

function SchemaTable({ title, schema }: { title: string; schema: unknown }) {
  const record = schemaRecord(schema);
  const properties = schemaRecord(record.properties);
  const required = new Set(Array.isArray(record.required) ? record.required.filter((item): item is string => typeof item === "string") : []);
  const entries = Object.entries(properties);
  return <section className="definition-schema" aria-labelledby={`${title.replaceAll(" ", "-")}-title`}>
    <div className="definition-section-heading">
      <div><p className="definition-kicker">JSON Schema</p><h3 id={`${title.replaceAll(" ", "-")}-title`}>{title}</h3></div>
      <span>{entries.length} 个字段</span>
    </div>
    {entries.length === 0 ? <p className="definition-empty">没有声明顶层字段，可在 Raw JSON 中查看完整结构。</p> :
      <div className="definition-schema-table-wrap"><table aria-label={`${title} 字段`} className="definition-schema-table">
        <thead><tr><th scope="col">字段</th><th scope="col">类型</th><th scope="col">约束</th><th scope="col">说明</th></tr></thead>
        <tbody>{entries.map(([name, value]) => {
          const field = schemaRecord(value);
          return <tr key={name}>
            <th scope="row"><code>{name}</code></th>
            <td><span className="type-chip">{schemaType(field)}</span></td>
            <td>{required.has(name) ? <span className="required-chip">必填</span> : <span className="optional-chip">可选</span>}</td>
            <td>{typeof field.description === "string" ? field.description : "未提供"}</td>
          </tr>;
        })}</tbody>
      </table></div>}
    <details className="definition-raw"><summary>查看 Raw JSON</summary><pre>{JSON.stringify(schema ?? {}, null, 2)}</pre></details>
  </section>;
}

const annotationLabels = {
  readOnlyHint: ["只读", "可写"],
  destructiveHint: ["破坏性操作", "非破坏性"],
  idempotentHint: ["幂等", "非幂等"],
  openWorldHint: ["开放世界", "封闭世界"],
} as const;

export function ToolDefinitionView({ detail }: { detail: ToolDetailSummary }) {
  const [historyHelpOpen, setHistoryHelpOpen] = useState(false);
  const historyHelpRef = useRef<HTMLDivElement>(null);
  const snapshot = detail.tool.currentSnapshot;
  const definition = snapshot.definition;
  const annotations = definition.annotations ?? {};
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
      toast.success("已复制");
    } catch {
      toast.error("复制失败，请手动复制 Raw JSON");
    }
  }

  return <article className="tool-definition" aria-label={`${definition.name} Tool 定义`} tabIndex={0}>
    <header className="tool-definition__header">
      <div><h2>{detail.tool.name}</h2>
        {definition.title !== undefined && <p className="tool-definition__title">{definition.title}</p>}</div>
      <div className="definition-copy"><button type="button" onClick={() => void copyDefinition()}>复制完整定义</button></div>
    </header>

    <section className="tool-description" aria-label="Tool 说明">
      {descriptionSections(definition.description).map((section, index) => <section key={`${section.title}:${index}`}>
        <h3>{section.title}</h3>{section.content.length > 0 && <p>{inlineDescription(section.content)}</p>}
      </section>)}
    </section>

    <dl className="definition-metadata">
      <div><dt>Schema 哈希</dt><dd title={snapshot.contentHash}><code>{snapshot.contentHash}</code></dd></div>
      <div><dt>快照时间</dt><dd><time dateTime={snapshot.createdAt}>{new Date(snapshot.createdAt).toLocaleString()}</time></dd></div>
      <div><dt>状态</dt><dd><span className={`definition-status definition-status--${detail.tool.status}`}>{detail.tool.status === "current" ? "当前" : detail.tool.status === "changed" ? "已变更" : "已移除"}</span></dd></div>
    </dl>

    <section className="definition-behavior" aria-labelledby="tool-behavior-title">
      <div className="definition-section-heading"><div><p className="definition-kicker">BEHAVIOR</p><h3 id="tool-behavior-title">调用特性</h3></div></div>
      {behaviors.length === 0 ? <p className="definition-empty">Server 未提供行为注解。</p> : <ul>{behaviors.map((behavior) => <li key={behavior.key}
        className={behavior.warning ? "annotation-chip annotation-chip--warning" : "annotation-chip"}>{behavior.label}</li>)}</ul>}
      <details className="definition-raw"><summary>查看 Annotations 与协议扩展</summary><pre>{JSON.stringify({
        annotations: definition.annotations ?? {}, execution: definition.execution ?? {}, _meta: definition._meta ?? {},
      }, null, 2)}</pre></details>
    </section>

    <SchemaTable title="Input Schema" schema={definition.inputSchema} />
    <SchemaTable title="Output Schema" schema={definition.outputSchema ?? {}} />

    <section className="definition-history" aria-labelledby="definition-history-title">
      <div className="definition-section-heading"><div><p className="definition-kicker">VERSIONS</p><h3 id="definition-history-title">历史快照</h3></div>
        <div className="definition-history-heading-actions" ref={historyHelpRef}><span>{detail.snapshots.length} 条</span>
          <button type="button" className="definition-history-help" aria-label="了解历史快照" aria-expanded={historyHelpOpen}
            onClick={() => setHistoryHelpOpen((current) => !current)}><Question size={16} weight="bold" aria-hidden="true" /></button>
          {historyHelpOpen && <p className="definition-history-help-popover" role="tooltip">每次 Tool 定义内容发生变化时，Inspector 会保存一份不可变快照，用于对比版本，并准确还原历史调用当时使用的描述和参数 Schema。重复刷新且内容未变化时不会新增快照。</p>}
        </div>
      </div>
      {detail.snapshots.length === 0 ? <p className="definition-empty">暂无历史变化。</p> : <ol>{detail.snapshots.map((item) =>
        <li key={item.id}><time dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleString()}</time><code>{item.contentHash}</code></li>)}</ol>}
    </section>
  </article>;
}
