import type { AssertionDefinition } from "../../../shared/testing/assertions.js";
import {
  scenarioTestCaseMutationSchema,
  type ArgumentMapping,
  type ResponseExtractor,
  type ScenarioInputDefinition,
  type ScenarioStepDependent,
  type ScenarioStepDefinition,
  type ScenarioTestCaseDefinition,
  type TestCaseMutation,
  type ValueSource,
} from "../../../shared/testing/test-case.js";
import type { JsonObject } from "../../../shared/tool-definition.js";

export interface ScenarioStepDraft {
  id: string;
  name: string;
  connectionId: string;
  toolName: string;
  fixedArguments: JsonObject;
  mappings: ScenarioArgumentMappingDraft[];
  extractors: ResponseExtractor[];
  assertions: AssertionDefinition[];
  condition: AssertionDefinition | null;
  polling: ScenarioStepDefinition["polling"];
  onFailure: ScenarioStepDefinition["onFailure"];
}

export interface ScenarioArgumentMappingDraft extends ArgumentMapping {
  literalText?: string;
}

export interface ScenarioTestCaseDraft {
  id: string | null;
  revision: number | null;
  name: string;
  description: string;
  tagsText: string;
  isEnabled: boolean;
  inputs: ScenarioInputDefinition[];
  steps: ScenarioStepDraft[];
  cleanupSteps: ScenarioStepDraft[];
  assertions: AssertionDefinition[];
  failurePolicy: "STOP" | "CONTINUE";
}

export function newScenarioTestCaseDraft(): ScenarioTestCaseDraft {
  return { id: null, revision: null, name: "", description: "", tagsText: "", isEnabled: true,
    inputs: [], steps: [], cleanupSteps: [], assertions: [], failurePolicy: "STOP" };
}

function stepFromDefinition(step: ScenarioStepDefinition): ScenarioStepDraft {
  return { id: step.id, name: step.name, connectionId: step.target.connectionId,
    toolName: step.target.toolName, fixedArguments: step.fixedArguments, mappings: step.mappings.map((mapping) => ({
      ...mapping, literalText: mapping.source.kind === "LITERAL" ? JSON.stringify(mapping.source.value, null, 2) : undefined,
    })),
    extractors: step.extractors, assertions: step.assertions, condition: step.condition,
    polling: step.polling, onFailure: step.onFailure };
}

function mappingSource(mapping: ScenarioArgumentMappingDraft): ValueSource {
  if (mapping.source.kind !== "LITERAL" || mapping.literalText === undefined) return mapping.source;
  return { kind: "LITERAL", value: JSON.parse(mapping.literalText) };
}

function stepDefinition(step: ScenarioStepDraft): ScenarioStepDefinition {
  return { id: step.id, name: step.name.trim(), target: { connectionId: step.connectionId, toolName: step.toolName },
    fixedArguments: step.fixedArguments, mappings: step.mappings.map((mapping) => ({ targetPath: mapping.targetPath,
      source: mappingSource(mapping), isRequired: mapping.isRequired })), extractors: step.extractors,
    assertions: step.assertions, condition: step.condition, polling: step.polling, onFailure: step.onFailure };
}

export function draftFromScenarioDefinition(definition: ScenarioTestCaseDefinition): ScenarioTestCaseDraft {
  return { id: definition.id, revision: definition.revision, name: definition.name,
    description: definition.description, tagsText: definition.tags.join(", "), isEnabled: definition.isEnabled,
    inputs: definition.inputs, steps: definition.steps.map(stepFromDefinition),
    cleanupSteps: definition.cleanupSteps.map(stepFromDefinition), assertions: definition.assertions,
    failurePolicy: definition.failurePolicy };
}

export function addScenarioStep(
  draft: ScenarioTestCaseDraft,
  section: "main" | "cleanup",
  id: string,
): ScenarioTestCaseDraft {
  const collection = section === "main" ? draft.steps : draft.cleanupSteps;
  const next: ScenarioStepDraft = { id, name: `Step ${collection.length + 1}`, connectionId: "", toolName: "",
    fixedArguments: {}, mappings: [], extractors: [], assertions: [], condition: null, polling: null,
    onFailure: section === "cleanup" ? "CONTINUE" : "STOP" };
  return section === "main" ? { ...draft, steps: [...draft.steps, next] }
    : { ...draft, cleanupSteps: [...draft.cleanupSteps, next] };
}

export function moveScenarioStep(
  draft: ScenarioTestCaseDraft,
  section: "main" | "cleanup",
  index: number,
  offset: -1 | 1,
): ScenarioTestCaseDraft {
  const collection = [...(section === "main" ? draft.steps : draft.cleanupSteps)];
  const target = index + offset;
  if (index < 0 || index >= collection.length || target < 0 || target >= collection.length) return draft;
  [collection[index], collection[target]] = [collection[target]!, collection[index]!];
  return section === "main" ? { ...draft, steps: collection } : { ...draft, cleanupSteps: collection };
}

export function removeScenarioStep(
  draft: ScenarioTestCaseDraft,
  section: "main" | "cleanup",
  stepId: string,
): { ok: true; value: ScenarioTestCaseDraft } | { ok: false; dependents: ScenarioStepDependent[] } {
  const dependents = [...draft.steps, ...draft.cleanupSteps].flatMap((step) => step.mappings
    .filter(({ source }) => source.kind === "STEP_RESPONSE" && source.stepId === stepId)
    .map(({ targetPath }) => ({ stepId: step.id, stepName: step.name, mappingTargetPath: targetPath })));
  if (dependents.length > 0) return { ok: false, dependents };
  return { ok: true, value: section === "main"
    ? { ...draft, steps: draft.steps.filter(({ id }) => id !== stepId) }
    : { ...draft, cleanupSteps: draft.cleanupSteps.filter(({ id }) => id !== stepId) } };
}

export function scenarioMutationFromDraft(draft: ScenarioTestCaseDraft):
  { ok: true; value: TestCaseMutation } | { ok: false; reason: "required" | "invalid" } {
  let steps: ScenarioStepDefinition[];
  let cleanupSteps: ScenarioStepDefinition[];
  try { steps = draft.steps.map(stepDefinition); cleanupSteps = draft.cleanupSteps.map(stepDefinition); }
  catch { return { ok: false, reason: "invalid" }; }
  const mutation = {
    kind: "scenario" as const, name: draft.name.trim(), description: draft.description,
    tags: [...new Set(draft.tagsText.split(",").map((tag) => tag.trim()).filter(Boolean))].slice(0, 20),
    isEnabled: draft.isEnabled, inputs: draft.inputs, steps,
    cleanupSteps, assertions: draft.assertions,
    failurePolicy: draft.failurePolicy,
  };
  if (mutation.name === "" || mutation.steps.some((step) => step.name === "" || step.target.connectionId === "" || step.target.toolName === "")) {
    return { ok: false, reason: "required" };
  }
  const parsed = scenarioTestCaseMutationSchema.safeParse(mutation);
  return parsed.success ? { ok: true, value: parsed.data } : { ok: false, reason: "invalid" };
}

export function scenarioDraftIssues(draft: ScenarioTestCaseDraft): string[] {
  const parsed = scenarioMutationFromDraft(draft);
  if (parsed.ok) return [];
  if (parsed.reason === "required") return ["required"];
  try {
    const steps = draft.steps.map(stepDefinition);
    const cleanupSteps = draft.cleanupSteps.map(stepDefinition);
    const mutation = { kind: "scenario" as const, name: draft.name.trim(), description: draft.description,
      tags: [], isEnabled: draft.isEnabled, inputs: draft.inputs, steps, cleanupSteps,
      assertions: draft.assertions, failurePolicy: draft.failurePolicy };
    const result = scenarioTestCaseMutationSchema.safeParse(mutation);
    return result.success ? [] : result.error.issues.map(({ message }) => message);
  } catch { return ["Invalid JSON literal"]; }
}
