import { createHash, randomUUID } from "node:crypto";
import { validateArguments, validateJsonSchema } from "../../shared/json-schema.js";
import { canonicalJson } from "../tools/tool-service.js";
import { parseAssertionPath } from "../../shared/testing/assertion-engine.js";
import { linearRegexTest, UnsupportedRegexError } from "../../shared/testing/linear-regex.js";
import type { AssertionDefinition } from "../../shared/testing/assertions.js";
import type { JsonObject, JsonValue } from "../../shared/tool-definition.js";
import {
  expectationClaimHasAuthorityConflict,
  type AutomationDraftDefinition,
} from "../../shared/authoring/draft.js";
import {
  draftValidationResultSchema,
  validateDraftInputSchema,
  type AuthoringValidationIssue,
  type DraftValidationResult,
  type ValidateDraftInput,
} from "../../shared/authoring/validation.js";
import type { ToolTarget } from "../../shared/testing/test-case.js";
import { parseScenarioPath } from "../testing/scenario-runner.js";
import type { TestCaseService } from "../testing/test-case-service.js";
import type { TestSuiteService } from "../testing/test-suite-service.js";
import type { ToolService } from "../tools/tool-service.js";
import type { AuthoringPolicyService } from "./authoring-policy-service.js";
import type { AuthoringDraftService } from "./authoring-draft-service.js";
import { AuthoringDraftValidationRepository } from "./authoring-draft-validation-repository.js";
import type { ProjectService } from "../projects/project-service.js";

const noExpected = new Set(["EXISTS", "NOT_EXISTS", "IS_NULL", "NOT_NULL"]);
const sensitiveKey = /(?:^|[-_])(authorization|token|secret|password|passwd|cookie|api[-_]?key)(?:$|[-_])/iu;
const maxValidationIssues = 200;
const maxValidatedTools = 2_000;

export interface AuthoringDraftValidator {
  validate(input: ValidateDraftInput): DraftValidationResult;
}

export class AuthoringDraftValidationStaleError extends Error {
  constructor() { super("Authoring Draft validation revision is stale"); this.name = "AuthoringDraftValidationStaleError"; }
}

function pointer(segments: Array<string | number>): string {
  return segments.length === 0 ? "" : `/${segments.map((segment) => String(segment)
    .replaceAll("~", "~0").replaceAll("/", "~1")).join("/")}`;
}

function issue(code: string, path: string, message: string, resolution?: string,
  severity: "ERROR" | "WARNING" = "ERROR"): AuthoringValidationIssue {
  return { code, path, message, ...(resolution === undefined ? {} : { resolution }), severity };
}

function validatePath(value: string, path: string, issues: AuthoringValidationIssue[], assertion = false): void {
  try { assertion ? parseAssertionPath(value) : parseScenarioPath(value); }
  catch (error) {
    issues.push(issue("INVALID_JSON_PATH", path, error instanceof Error ? error.message : "JSON path is invalid"));
  }
}

function validateAssertion(assertion: AssertionDefinition, path: string, issues: AuthoringValidationIssue[]): void {
  validatePath(assertion.path, `${path}.path`, issues, true);
  const hasExpected = assertion.expected !== undefined;
  if (noExpected.has(assertion.operator) && hasExpected) {
    issues.push(issue("ASSERTION_OPERAND_INVALID", `${path}.expected`, `${assertion.operator} does not accept an expected value`));
    return;
  }
  if (!noExpected.has(assertion.operator) && !hasExpected) {
    issues.push(issue("ASSERTION_OPERAND_REQUIRED", `${path}.expected`, `${assertion.operator} requires an expected value`));
    return;
  }
  const expected = assertion.expected;
  const numericOperators = new Set([
    "GT", "GTE", "LT", "LTE", "LENGTH_EQUALS", "LENGTH_GTE", "DURATION_LTE", "NETWORK_DURATION_LTE",
  ]);
  if (numericOperators.has(assertion.operator) && (typeof expected !== "number" || !Number.isFinite(expected))) {
    issues.push(issue("ASSERTION_OPERAND_INVALID", `${path}.expected`, `${assertion.operator} requires a numeric expected value`));
  }
  if (assertion.operator === "BETWEEN" && (!Array.isArray(expected) || expected.length !== 2 ||
      expected.some((value) => typeof value !== "number"))) {
    issues.push(issue("ASSERTION_OPERAND_INVALID", `${path}.expected`, "BETWEEN requires two numeric bounds"));
  }
  if (assertion.operator === "TYPE_IS" && (typeof expected !== "string" ||
      !["null", "boolean", "number", "integer", "string", "array", "object"].includes(expected))) {
    issues.push(issue("ASSERTION_OPERAND_INVALID", `${path}.expected`, "TYPE_IS requires a supported type name"));
  }
  if (assertion.operator === "MATCHES_SCHEMA" &&
      (expected === null || Array.isArray(expected) || typeof expected !== "object")) {
    issues.push(issue("ASSERTION_OPERAND_INVALID", `${path}.expected`, "MATCHES_SCHEMA requires a JSON object"));
  } else if (assertion.operator === "MATCHES_SCHEMA" && expected !== undefined) {
    const compiled = validateJsonSchema(expected as Record<string, JsonValue>, null);
    if (compiled.warning !== null) {
      issues.push(issue("ASSERTION_OPERAND_INVALID", `${path}.expected`, "JSON Schema could not be compiled"));
    }
  }
  if (["STARTS_WITH", "ENDS_WITH", "MATCHES_REGEX", "STATUS_IS"].includes(assertion.operator) &&
      typeof expected !== "string") {
    issues.push(issue("ASSERTION_OPERAND_INVALID", `${path}.expected`, `${assertion.operator} requires a string expected value`));
  }
  if (assertion.operator === "IS_ERROR_IS" && typeof expected !== "boolean") {
    issues.push(issue("ASSERTION_OPERAND_INVALID", `${path}.expected`, "IS_ERROR_IS requires a boolean expected value"));
  }
  if (assertion.operator === "MATCHES_REGEX" && typeof expected === "string") {
    try { linearRegexTest(expected, ""); }
    catch (error) {
      issues.push(issue("ASSERTION_OPERAND_INVALID", `${path}.expected`,
        error instanceof UnsupportedRegexError ? error.message : "Regular expression is invalid"));
    }
  }
}

function validateArgumentTransform(
  transform: { source: string; sourceDigest: string } | null,
  path: string,
  issues: AuthoringValidationIssue[],
): void {
  if (transform === null) return;
  const digest = createHash("sha256").update(transform.source, "utf8").digest("hex");
  if (digest !== transform.sourceDigest) {
    issues.push(issue("ARGUMENT_TRANSFORM_DIGEST_MISMATCH", `${path}.sourceDigest`,
      "Argument transform source digest does not match its source"));
  }
}

function findSecretLiteral(value: JsonValue, path: string, issues: AuthoringValidationIssue[], depth = 0): void {
  if (depth > 50) return;
  if (typeof value === "string" && /(?:bearer\s+\S+|sk-[A-Za-z0-9_-]{8,})/iu.test(value)) {
    issues.push(issue("SECRET_LITERAL", path, "Secret-shaped literal is not allowed",
      "Use an ENVIRONMENT value source instead of embedding a credential."));
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => findSecretLiteral(item, `${path}[${index}]`, issues, depth + 1));
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      const itemPath = `${path}.${key}`;
      if (sensitiveKey.test(key) && item !== null && item !== "" && item !== "[REDACTED]") {
        issues.push(issue("SECRET_LITERAL", itemPath, "Sensitive field contains a literal value",
          "Use an ENVIRONMENT value source instead of embedding a credential."));
      } else {
        findSecretLiteral(item, itemPath, issues, depth + 1);
      }
    }
  }
}

export function createAuthoringDraftValidator(options: {
  projects: ProjectService;
  drafts: Pick<AuthoringDraftService, "get">;
  tools: Pick<ToolService, "get">;
  policies: Pick<AuthoringPolicyService, "get" | "isToolAllowed">;
  testCases: Pick<TestCaseService, "get">;
  testSuites: Pick<TestSuiteService, "get">;
  createId?: () => string;
  now?: () => Date;
}): AuthoringDraftValidator {
  const createId = options.createId ?? randomUUID;
  const now = options.now ?? (() => new Date());

  return {
    validate(rawInput) {
      const input = validateDraftInputSchema.parse(rawInput);
      const draft = options.drafts.get(input.projectId, input.draftId);
      if (draft.revision !== input.revision) {
        throw new AuthoringDraftValidationStaleError();
      }
      const issues: AuthoringValidationIssue[] = [];
      const toolSchemaHashes: Record<string, string> = {};
      const targetCache = new Map<string, { annotations: Record<string, JsonValue> | undefined; inputSchema: JsonObject } | null>();

      const target = (value: ToolTarget, path: string) => {
        const key = `${value.connectionId}:${value.toolName}`;
        const cached = targetCache.get(key);
        if (cached !== undefined) return cached;
        if (targetCache.size >= maxValidatedTools) {
          issues.push(issue("TOOL_LIMIT_EXCEEDED", path, "Draft references too many distinct Tools"));
          targetCache.set(key, null);
          return null;
        }
        try {
          const tool = options.tools.get(input.projectId, value.connectionId, value.toolName).tool;
          if (tool.status === "removed") throw new Error("Tool is removed");
          if (!options.policies.isToolAllowed(input.projectId, value.connectionId, value.toolName)) {
            issues.push(issue("AUTHORING_POLICY_DENIED", path, "Connection policy does not allow this Tool"));
          }
          const result = { annotations: tool.currentSnapshot.definition.annotations,
            inputSchema: tool.currentSnapshot.definition.inputSchema };
          targetCache.set(key, result);
          toolSchemaHashes[key] = tool.currentSnapshot.contentHash;
          return result;
        } catch (error) {
          issues.push(issue("TOOL_UNAVAILABLE", path, error instanceof Error ? error.message : "Tool is unavailable"));
          targetCache.set(key, null);
          return null;
        }
      };

      draft.definition.testCases.forEach((testCase, testIndex) => {
        const casePath = `definition.testCases[${testIndex}]`;
        if (testCase.kind === "tool") {
          const resolved = target(testCase.target, `${casePath}.target`);
          if (resolved !== null) {
            for (const schemaIssue of validateArguments(resolved.inputSchema, testCase.arguments)) {
              issues.push(issue("TOOL_ARGUMENTS_INVALID", `${casePath}.arguments${schemaIssue.path}`,
                schemaIssue.message));
            }
          }
          findSecretLiteral(testCase.arguments, `${casePath}.arguments`, issues);
          testCase.assertions.forEach((assertion, index) => validateAssertion(assertion,
            `${casePath}.assertions[${index}]`, issues));
          return;
        }
        const allSteps = [...testCase.steps.map((step, index) => ({ step, section: "steps", index })),
          ...testCase.cleanupSteps.map((step, index) => ({ step, section: "cleanupSteps", index }))];
        let cleanupRequired = false;
        for (const { step, section, index } of allSteps) {
          const stepPath = `${casePath}.${section}[${index}]`;
          const resolved = target(step.target, `${stepPath}.target`);
          if (section === "steps" && resolved !== null &&
              (resolved.annotations?.readOnlyHint !== true || resolved.annotations.destructiveHint === true) &&
              options.policies.get(input.projectId, step.target.connectionId).requireCleanupForDraftMutations) {
            cleanupRequired = true;
          }
          if (resolved !== null) {
            const mappedPointers = new Set(step.mappings.map((mapping) => {
              try { return pointer(parseScenarioPath(mapping.targetPath)); } catch { return ""; }
            }));
            for (const schemaIssue of validateArguments(resolved.inputSchema, step.fixedArguments)) {
              if (schemaIssue.keyword === "required" && mappedPointers.has(schemaIssue.path)) continue;
              issues.push(issue("TOOL_ARGUMENTS_INVALID", `${stepPath}.fixedArguments${schemaIssue.path}`,
                schemaIssue.message));
            }
          }
          findSecretLiteral(step.fixedArguments, `${stepPath}.fixedArguments`, issues);
          step.mappings.forEach((mapping, mappingIndex) => {
            validatePath(mapping.targetPath, `${stepPath}.mappings[${mappingIndex}].targetPath`, issues);
            if (mapping.source.kind === "STEP_RESPONSE") validatePath(mapping.source.path,
              `${stepPath}.mappings[${mappingIndex}].source.path`, issues);
            if (mapping.source.kind === "LITERAL") findSecretLiteral(mapping.source.value,
              `${stepPath}.mappings[${mappingIndex}].source.value`, issues);
          });
          step.extractors.forEach((extractor, extractorIndex) => validatePath(extractor.path,
            `${stepPath}.extractors[${extractorIndex}].path`, issues));
          step.assertions.forEach((assertion, assertionIndex) => validateAssertion(assertion,
            `${stepPath}.assertions[${assertionIndex}]`, issues));
          validateArgumentTransform(step.argumentTransform, `${stepPath}.argumentTransform`, issues);
          if (step.condition !== null) validateAssertion(step.condition, `${stepPath}.condition`, issues);
          step.polling?.until.forEach((assertion, assertionIndex) => validateAssertion(assertion,
            `${stepPath}.polling.until[${assertionIndex}]`, issues));
          step.polling?.failWhen.forEach((assertion, assertionIndex) => validateAssertion(assertion,
            `${stepPath}.polling.failWhen[${assertionIndex}]`, issues));
        }
        if (cleanupRequired && testCase.cleanupSteps.length === 0) {
          issues.push(issue("CLEANUP_REQUIRED", `${casePath}.cleanupSteps`,
            "Connection policy requires cleanup for Draft mutations"));
        }
        testCase.assertions.forEach((assertion, index) => validateAssertion(assertion,
          `${casePath}.assertions[${index}]`, issues));
      });

      draft.definition.sourceAssets.forEach((source, index) => {
        try {
          const current = source.kind === "TEST_CASE"
            ? options.testCases.get(input.projectId, source.assetId)
            : options.testSuites.get(input.projectId, source.assetId);
          if (current.revision !== source.revision) {
            issues.push(issue("SOURCE_REVISION_CONFLICT", `definition.sourceAssets[${index}].revision`,
              "Source asset revision has changed"));
          }
        } catch {
          issues.push(issue("SOURCE_ASSET_UNAVAILABLE", `definition.sourceAssets[${index}]`, "Source asset is unavailable"));
        }
      });

      draft.definition.expectationClaims.forEach((claim, index) => {
        if (expectationClaimHasAuthorityConflict(draft.definition, claim)) {
          issues.push(issue("SOURCE_AUTHORITY_CONFLICT", `definition.expectationClaims[${index}].sourceRefs`,
            "Authoritative source revisions conflict for this expectation",
            "Review the expectation against the current authoritative source revision.", "WARNING"));
        }
      });

      const boundedIssues = issues.length <= maxValidationIssues ? issues : [
        ...issues.slice(0, maxValidationIssues - 1),
        issue("ISSUE_LIMIT_EXCEEDED", "definition", `Validation found more than ${maxValidationIssues} issues`),
      ];
      const sortedHashes = Object.fromEntries(Object.entries(toolSchemaHashes).sort(([left], [right]) => left.localeCompare(right)));
      const status = issues.some(({ severity }) => severity !== "WARNING") ? "INVALID" as const : "VALID" as const;
      const validationDigest = createHash("sha256").update(canonicalJson({
        draftId: draft.id, draftRevision: draft.revision, definitionDigest: draft.definitionDigest,
        toolSchemaHashes: sortedHashes, status, issues: boundedIssues,
      })).digest("hex");
      const result = draftValidationResultSchema.parse({
        id: createId(), projectId: input.projectId, draftId: draft.id, draftRevision: draft.revision,
        definitionDigest: draft.definitionDigest, toolSchemaHashes: sortedHashes,
        validationDigest, status, issues: boundedIssues, createdAt: now().toISOString(),
      });
      return new AuthoringDraftValidationRepository(options.projects.open(input.projectId)).insert(result);
    },
  };
}
