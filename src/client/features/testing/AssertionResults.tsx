import { useTranslation } from "react-i18next";
import type { TestExecutionAssertionResult } from "../../../shared/testing/test-execution.js";
import { JsonViewer } from "../runs/JsonViewer.js";

function AssertionValue({ value, redacted = false }: {
  value: TestExecutionAssertionResult["actual"];
  redacted?: boolean;
}) {
  const { t } = useTranslation("testing");
  if (redacted) return <span className="testing-execution__empty-value">{t("execution.redacted")}</span>;
  if (value === undefined) return <span className="testing-execution__empty-value">—</span>;
  return <JsonViewer value={value} defaultExpanded="all" />;
}

export function AssertionResults({ assertions, headingId }: {
  assertions: TestExecutionAssertionResult[];
  headingId?: string;
}) {
  const { t } = useTranslation("testing");
  return <section className="testing-execution__assertions" aria-labelledby={headingId}>
    <h4 id={headingId}>{t("execution.assertions", { count: assertions.length })}</h4>
    {assertions.length === 0 ? <p className="testing-empty-copy">{t("execution.noAssertions")}</p>
      : assertions.map((assertion, index) => <article key={assertion.id} data-status={assertion.status}>
        <header><strong>{t("execution.assertion", { index: index + 1 })}</strong>
          <span>{t(`execution.assertionStatus.${assertion.status}`)}</span></header>
        <p><code>{assertion.definition.source}</code> · <code>{assertion.resolvedPath ?? (assertion.definition.path || "$")}</code>
          {" · "}{assertion.definition.operator}</p>
        {assertion.message !== null && <p>{assertion.message}</p>}
        <div className="testing-execution__values">
          <div><strong>{t("execution.actual")}</strong>
            <AssertionValue value={assertion.actual} redacted={assertion.isRedacted} /></div>
          <div><strong>{t("execution.expected")}</strong><AssertionValue value={assertion.expected} /></div>
        </div>
      </article>)}
  </section>;
}
