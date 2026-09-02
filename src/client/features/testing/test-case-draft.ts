import type { DebugTabSummary } from "../../api/api-client.js";
import type { AssertionDefinition } from "../../../shared/testing/assertions.js";
import type { TestCaseMutation, ToolTestCaseDefinition } from "../../../shared/testing/test-case.js";
import type { JsonObject } from "../../../shared/tool-definition.js";
import type { TestCaseCreationPreview } from "../../../shared/testing/creation-preview.js";

export type TestCasePreviewWarning = "SECRET_OMITTED" | "RESPONSE_TRUNCATED" | "BASELINE_UNAVAILABLE" |
  "TOOL_REMOVED" | "TOOL_DEFINITION_CHANGED";

export interface AssertionDraft {
  definition: AssertionDefinition;
  expectedText: string;
}

export interface ToolTestCaseDraft {
  id: string | null;
  revision: number | null;
  name: string;
  description: string;
  tagsText: string;
  isEnabled: boolean;
  connectionId: string;
  toolName: string;
  arguments: JsonObject;
  rawText: string;
  inputMode: "form" | "raw";
  assertions: AssertionDraft[];
  timeoutText: string;
  previewWarnings: TestCasePreviewWarning[];
}

export function newToolTestCaseDraft(): ToolTestCaseDraft {
  return {
    id: null, revision: null, name: "", description: "", tagsText: "", isEnabled: true,
    connectionId: "", toolName: "", arguments: {}, rawText: "", inputMode: "form",
    assertions: [], timeoutText: "30000", previewWarnings: [],
  };
}

export function draftFromDefinition(definition: ToolTestCaseDefinition): ToolTestCaseDraft {
  return {
    id: definition.id,
    revision: definition.revision,
    name: definition.name,
    description: definition.description,
    tagsText: definition.tags.join(", "),
    isEnabled: definition.isEnabled,
    connectionId: definition.target.connectionId,
    toolName: definition.target.toolName,
    arguments: definition.arguments,
    rawText: Object.keys(definition.arguments).length === 0 ? "" : JSON.stringify(definition.arguments, null, 2),
    inputMode: "form",
    assertions: definition.assertions.map((assertion) => ({
      definition: assertion,
      expectedText: assertion.expected === undefined ? "" : JSON.stringify(assertion.expected, null, 2),
    })),
    timeoutText: String(definition.timeoutMs),
    previewWarnings: [],
  };
}

export function draftFromPreview(preview: TestCaseCreationPreview): ToolTestCaseDraft {
  const draft = newToolTestCaseDraft();
  const definition = preview.definition;
  return {
    ...draft,
    name: definition.name,
    description: definition.description,
    tagsText: definition.tags.join(", "),
    isEnabled: definition.isEnabled,
    connectionId: definition.target.connectionId,
    toolName: definition.target.toolName,
    arguments: definition.arguments,
    rawText: Object.keys(definition.arguments).length === 0 ? "" : JSON.stringify(definition.arguments, null, 2),
    assertions: definition.assertions.map((assertion) => ({
      definition: assertion,
      expectedText: assertion.expected === undefined ? "" : JSON.stringify(assertion.expected, null, 2),
    })),
    timeoutText: String(definition.timeoutMs),
    previewWarnings: preview.warnings,
  };
}

export function assertionNeedsExpected(operator: AssertionDefinition["operator"]): boolean {
  return !["EXISTS", "NOT_EXISTS", "IS_NULL", "NOT_NULL"].includes(operator);
}

export function parseAssertionExpected(draft: AssertionDraft):
  { ok: true; value: AssertionDefinition } | { ok: false } {
  const definition = { ...draft.definition };
  if (!assertionNeedsExpected(definition.operator)) {
    delete definition.expected;
    return { ok: true, value: definition };
  }
  try {
    definition.expected = JSON.parse(draft.expectedText);
    return { ok: true, value: definition };
  } catch { return { ok: false }; }
}

export function mutationFromDraft(draft: ToolTestCaseDraft):
  { ok: true; value: TestCaseMutation } | { ok: false; reason: "required" | "timeout" | "assertion" } {
  const name = draft.name.trim();
  if (name === "" || draft.connectionId === "" || draft.toolName === "") return { ok: false, reason: "required" };
  const timeoutMs = Number(draft.timeoutText);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 3_600_000) return { ok: false, reason: "timeout" };
  const assertions: AssertionDefinition[] = [];
  for (const assertion of draft.assertions) {
    const parsed = parseAssertionExpected(assertion);
    if (!parsed.ok) return { ok: false, reason: "assertion" };
    assertions.push(parsed.value);
  }
  const tags = [...new Set(draft.tagsText.split(",").map((tag) => tag.trim()).filter(Boolean))].slice(0, 20);
  return { ok: true, value: {
    kind: "tool", name, description: draft.description, tags, isEnabled: draft.isEnabled,
    target: { connectionId: draft.connectionId, toolName: draft.toolName },
    arguments: draft.arguments,
    assertions,
    timeoutMs,
  } };
}

export function parameterTabFromDraft(projectId: string, draft: ToolTestCaseDraft): DebugTabSummary {
  return {
    id: `test-case-${draft.id ?? "new"}`,
    projectId,
    connectionId: draft.connectionId,
    toolName: draft.toolName,
    title: draft.name || draft.toolName,
    position: 0,
    pinned: false,
    inputMode: draft.inputMode,
    arguments: draft.arguments,
    rawText: draft.rawText,
    viewState: { editorScrollTop: 0, resultScrollTop: 0, splitRatio: 0.5 },
    lastRunId: null,
  };
}
