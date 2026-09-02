import { z } from "zod";
import type { JsonObject, JsonValue } from "../tool-definition.js";
import { toolTestCaseMutationSchema } from "./test-case.js";

export const testCasePreviewWarningSchema = z.enum([
  "SECRET_OMITTED", "RESPONSE_TRUNCATED", "BASELINE_UNAVAILABLE", "TOOL_REMOVED", "TOOL_DEFINITION_CHANGED",
]);

export const testCaseCreationPreviewSchema = z.object({
  definition: toolTestCaseMutationSchema,
  warnings: z.array(testCasePreviewWarningSchema).max(10),
  source: z.object({ kind: z.enum(["run", "saved-item"]), id: z.uuid() }).strict(),
  toolStatus: z.enum(["current", "changed", "removed"]),
  requiresConfirmation: z.boolean(),
}).strict();

export type TestCasePreviewWarning = z.output<typeof testCasePreviewWarningSchema>;
export type TestCaseCreationPreview = z.output<typeof testCaseCreationPreviewSchema>;

const sensitiveKey = /(?:^|[-_])(authorization|token|secret|password|passwd|cookie|api[-_]?key)(?:$|[-_])/i;

function safeJson(value: unknown): { value: JsonValue | undefined; secret: boolean; valid: boolean } {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return { value, secret: value === "[REDACTED]", valid: true };
  }
  if (typeof value === "number") return { value, secret: false, valid: Number.isFinite(value) };
  if (Array.isArray(value)) {
    const items: JsonValue[] = []; let secret = false;
    for (const item of value) {
      const nested = safeJson(item); if (!nested.valid || nested.value === undefined) return { value: undefined, secret, valid: false };
      items.push(nested.value); secret ||= nested.secret;
    }
    return { value: items, secret, valid: true };
  }
  if (typeof value !== "object" || value === null) return { value: undefined, secret: false, valid: false };
  const result: JsonObject = {}; let secret = false;
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (sensitiveKey.test(key)) { secret = true; continue; }
    const nested = safeJson(item); if (!nested.valid || nested.value === undefined) return { value: undefined, secret, valid: false };
    result[key] = nested.value; secret ||= nested.secret;
  }
  return { value: result, secret, valid: true };
}

export function buildTestCaseCreationPreview(input: {
  source: TestCaseCreationPreview["source"];
  connectionId: string;
  toolName: string;
  name: string;
  argumentsValue: unknown;
  baseline?: unknown;
  truncated?: boolean;
  toolStatus: TestCaseCreationPreview["toolStatus"];
  definitionChanged?: boolean;
}): TestCaseCreationPreview {
  const safeArguments = safeJson(input.argumentsValue);
  const safeBaseline = safeJson(input.baseline);
  const warnings: TestCasePreviewWarning[] = [];
  if (safeArguments.secret || safeBaseline.secret) warnings.push("SECRET_OMITTED");
  if (input.truncated) warnings.push("RESPONSE_TRUNCATED");
  if (input.toolStatus === "removed") warnings.push("TOOL_REMOVED");
  if (input.definitionChanged || input.toolStatus === "changed") warnings.push("TOOL_DEFINITION_CHANGED");
  const canUseBaseline = input.baseline !== undefined && !input.truncated && safeBaseline.valid && !safeBaseline.secret && safeBaseline.value !== undefined;
  if (input.baseline !== undefined && !canUseBaseline) warnings.push("BASELINE_UNAVAILABLE");
  const argumentsValue = safeArguments.valid && typeof safeArguments.value === "object" && safeArguments.value !== null && !Array.isArray(safeArguments.value)
    ? safeArguments.value as JsonObject : {};
  const preview = {
    source: input.source,
    toolStatus: input.toolStatus,
    requiresConfirmation: warnings.length > 0,
    warnings: [...new Set(warnings)],
    definition: {
      kind: "tool" as const,
      name: input.name.trim().slice(0, 120) || `${input.toolName} baseline`,
      description: "",
      tags: [],
      isEnabled: true,
      target: { connectionId: input.connectionId, toolName: input.toolName },
      arguments: argumentsValue,
      assertions: canUseBaseline ? [{ id: "source-baseline", source: "MCP_RESULT" as const, path: "", operator: "DEEP_EQUALS" as const,
        expected: safeBaseline.value }] : [],
      timeoutMs: 30_000,
    },
  };
  return testCaseCreationPreviewSchema.parse(preview);
}
