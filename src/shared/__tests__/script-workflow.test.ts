import { describe, expect, it } from "vitest";
import {
  parseSandboxMessage,
  parseToolWorkflow,
  parseWorkflowExecutionSummary,
} from "../script-workflow.js";

describe("Tool script workflow contracts", () => {
  it("decodes a strict Tool workflow configuration", () => {
    const workflow = {
      projectId: "00000000-0000-4000-8000-000000000001",
      connectionId: "00000000-0000-4000-8000-000000000002",
      toolName: "sum",
      revision: 3,
      before: { enabled: true, source: "export default async function before(ctx) {}" },
      after: { enabled: false, source: "" },
      timeoutMs: 5_000,
      createdAt: "2026-08-27T00:00:00.000Z",
      updatedAt: "2026-08-27T00:00:01.000Z",
    };

    expect(parseToolWorkflow(workflow)).toEqual(workflow);
    expect(() => parseToolWorkflow({ ...workflow, future: true })).toThrow();
    expect(() => parseToolWorkflow({ ...workflow, timeoutMs: 60_001 })).toThrow();
    expect(() => parseToolWorkflow({ ...workflow, before: { enabled: true, source: "x".repeat(2_097_153) } })).toThrow();
  });

  it("accepts only versioned strict sandbox messages", () => {
    const message = {
      version: 1,
      type: "host-call",
      requestId: "00000000-0000-4000-8000-000000000003",
      capability: "tools.call",
      input: { server: "current", name: "lookup", arguments: { id: "42" } },
    };
    expect(parseSandboxMessage(message)).toEqual(message);
    expect(() => parseSandboxMessage({ ...message, version: 2 })).toThrow();
    expect(() => parseSandboxMessage({ ...message, input: { ...message.input, extra: true } })).toThrow();
    expect(() => parseSandboxMessage({ ...message, capability: "fetch" })).toThrow();
  });

  it("decodes execution summaries without accepting unknown states or fields", () => {
    const summary = {
      id: "00000000-0000-4000-8000-000000000004",
      projectId: "00000000-0000-4000-8000-000000000001",
      connectionId: "00000000-0000-4000-8000-000000000002",
      tabId: null,
      toolName: "sum",
      status: "before",
      createdAt: "2026-08-27T00:00:00.000Z",
      startedAt: "2026-08-27T00:00:00.100Z",
      completedAt: null,
      durationMs: null,
    };
    expect(parseWorkflowExecutionSummary(summary)).toEqual(summary);
    expect(() => parseWorkflowExecutionSummary({ ...summary, status: "unknown" })).toThrow();
    expect(() => parseWorkflowExecutionSummary({ ...summary, secret: "leak" })).toThrow();
  });
});
