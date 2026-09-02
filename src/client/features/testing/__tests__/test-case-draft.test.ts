import { describe, expect, it } from "vitest";
import { assertionNeedsExpected, mutationFromDraft, newToolTestCaseDraft } from "../test-case-draft.js";

describe("tool test case draft", () => {
  it("normalizes tags and canonical arguments into a Tool mutation", () => {
    const draft = newToolTestCaseDraft();
    Object.assign(draft, {
      name: "  price baseline  ", connectionId: "00000000-0000-4000-8000-000000000001",
      toolName: "get_price", tagsText: "smoke, price, smoke", arguments: { product_id: "42" }, timeoutText: "2500",
      assertions: [{ definition: { id: "a-1", source: "MCP_RESULT", path: "/price", operator: "EQUALS" }, expectedText: "12.5" }],
    });

    expect(mutationFromDraft(draft)).toEqual({ ok: true, value: expect.objectContaining({
      kind: "tool", name: "price baseline", tags: ["smoke", "price"], arguments: { product_id: "42" }, timeoutMs: 2500,
      assertions: [expect.objectContaining({ expected: 12.5 })],
    }) });
  });

  it("keeps existence assertions expected-value free and rejects malformed expected JSON", () => {
    expect(assertionNeedsExpected("EXISTS")).toBe(false);
    const draft = newToolTestCaseDraft();
    Object.assign(draft, { name: "test", connectionId: "00000000-0000-4000-8000-000000000001", toolName: "tool" });
    draft.assertions = [{ definition: { id: "a-1", source: "MCP_RESULT", path: "", operator: "EQUALS" }, expectedText: "{" }];
    expect(mutationFromDraft(draft)).toEqual({ ok: false, reason: "assertion" });
  });

});
