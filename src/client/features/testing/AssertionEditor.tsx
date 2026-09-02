import { ArrowDown, ArrowUp, Plus, Trash } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import type { AssertionDefinition } from "../../../shared/testing/assertions.js";
import { Button } from "../../components/actions/Button.js";
import { IconButton } from "../../components/actions/IconButton.js";
import { FormField } from "../../components/forms/FormField.js";
import { Select } from "../../components/forms/Select.js";
import type { AssertionDraft } from "./test-case-draft.js";
import { assertionNeedsExpected, parseAssertionExpected } from "./test-case-draft.js";

interface Props {
  value: AssertionDraft[];
  onChange: (value: AssertionDraft[]) => void;
}

const sources: AssertionDefinition["source"][] = ["MCP_RESULT", "MCP_ERROR", "RUN", "HTTP", "WORKFLOW", "VARIABLE"];
const operators: AssertionDefinition["operator"][] = [
  "EXISTS", "NOT_EXISTS", "IS_NULL", "NOT_NULL", "EQUALS", "NOT_EQUALS", "DEEP_EQUALS", "SUBSET",
  "CONTAINS", "STARTS_WITH", "ENDS_WITH", "MATCHES_REGEX", "GT", "GTE", "LT", "LTE", "BETWEEN",
  "LENGTH_EQUALS", "LENGTH_GTE", "ARRAY_CONTAINS", "TYPE_IS", "MATCHES_SCHEMA", "STATUS_IS", "IS_ERROR_IS",
  "DURATION_LTE", "NETWORK_DURATION_LTE",
];

function newAssertion(index: number): AssertionDraft {
  return {
    definition: { id: `assertion-${Date.now()}-${index}`, source: "MCP_RESULT", path: "", operator: "EQUALS" },
    expectedText: "null",
  };
}

export function AssertionEditor({ value, onChange }: Props) {
  const { t } = useTranslation("testing");
  function update(index: number, patch: Partial<AssertionDraft["definition"]> & { expectedText?: string }): void {
    onChange(value.map((item, itemIndex) => itemIndex !== index ? item : {
      definition: { ...item.definition, ...patch },
      expectedText: patch.expectedText ?? item.expectedText,
    }));
  }
  function move(index: number, offset: -1 | 1): void {
    const target = index + offset;
    if (target < 0 || target >= value.length) return;
    const next = [...value];
    [next[index], next[target]] = [next[target]!, next[index]!];
    onChange(next);
  }
  return <section className="testing-assertions" aria-labelledby="testing-assertions-title">
    <div className="testing-section-heading">
      <h3 id="testing-assertions-title">{t("editor.assertions")}</h3>
      <Button variant="secondary" onClick={() => onChange([...value, newAssertion(value.length)])}>
        <Plus size={15} aria-hidden="true" />{t("assertion.add")}
      </Button>
    </div>
    {value.length === 0 && <p className="testing-empty-copy">{t("assertion.empty")}</p>}
    <div className="testing-assertion-list">
      {value.map((item, index) => {
        const invalidExpected = assertionNeedsExpected(item.definition.operator) && !parseAssertionExpected(item).ok;
        return <article key={item.definition.id} className="testing-assertion-item">
          <header><strong>{t("assertion.item", { index: index + 1 })}</strong><div>
            <IconButton label={t("assertion.moveUp", { index: index + 1 })} icon={<ArrowUp size={16} />} disabled={index === 0} onClick={() => move(index, -1)} />
            <IconButton label={t("assertion.moveDown", { index: index + 1 })} icon={<ArrowDown size={16} />} disabled={index === value.length - 1} onClick={() => move(index, 1)} />
            <IconButton label={t("assertion.remove", { index: index + 1 })} icon={<Trash size={16} />} onClick={() => onChange(value.filter((_, itemIndex) => itemIndex !== index))} />
          </div></header>
          <div className="testing-assertion-grid">
            <FormField htmlFor={`${item.definition.id}-source`} label={t("assertion.source")}><Select id={`${item.definition.id}-source`} value={item.definition.source}
              onChange={(event) => update(index, { source: event.target.value as AssertionDefinition["source"] })}>{sources.map((source) => <option key={source}>{source}</option>)}</Select></FormField>
            <FormField htmlFor={`${item.definition.id}-operator`} label={t("assertion.operator")}><Select id={`${item.definition.id}-operator`} value={item.definition.operator}
              onChange={(event) => update(index, { operator: event.target.value as AssertionDefinition["operator"] })}>{operators.map((operator) => <option key={operator}>{operator}</option>)}</Select></FormField>
            <FormField htmlFor={`${item.definition.id}-path`} label={t("assertion.path")}><input id={`${item.definition.id}-path`} className="ui-input" value={item.definition.path}
              placeholder={t("assertion.pathPlaceholder")} onChange={(event) => update(index, { path: event.target.value })} /></FormField>
            {assertionNeedsExpected(item.definition.operator) && <FormField htmlFor={`${item.definition.id}-expected`} label={t("assertion.expected")}
              error={invalidExpected ? t("assertion.invalidExpected") : undefined}><textarea id={`${item.definition.id}-expected`} className="ui-input" rows={2}
                value={item.expectedText} aria-invalid={invalidExpected || undefined} placeholder={t("assertion.expectedPlaceholder")}
                onChange={(event) => update(index, { expectedText: event.target.value })} /></FormField>}
            <FormField htmlFor={`${item.definition.id}-message`} label={t("assertion.message")}><input id={`${item.definition.id}-message`} className="ui-input"
              value={item.definition.message ?? ""} placeholder={t("assertion.messagePlaceholder")}
              onChange={(event) => update(index, { message: event.target.value || undefined })} /></FormField>
          </div>
        </article>;
      })}
    </div>
  </section>;
}
