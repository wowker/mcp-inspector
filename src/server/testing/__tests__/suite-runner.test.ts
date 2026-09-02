import { describe, expect, it, vi } from "vitest";
import type { TestSuiteDefinition } from "../../../shared/testing/test-suite.js";
import { runSuite, type SuiteMemberInvocationResult } from "../suite-runner.js";

function member(position: number): TestSuiteDefinition["members"][number] {
  return {
    id: `00000000-0000-4000-8000-${String(position + 1).padStart(12, "0")}`,
    testCaseId: `10000000-0000-4000-8000-${String(position + 1).padStart(12, "0")}`,
    position,
    isEnabled: true,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => { resolve = complete; });
  return { promise, resolve };
}

describe("runSuite", () => {
  it("never exceeds the configured concurrency and reports members by position", async () => {
    const pending = Array.from({ length: 4 }, () => deferred<SuiteMemberInvocationResult>());
    let active = 0;
    let maximumActive = 0;
    const execute = vi.fn(async ({ position }: TestSuiteDefinition["members"][number]) => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      const result = await pending[position]!.promise;
      active -= 1;
      return result;
    });

    const resultPromise = runSuite({
      members: [member(0), member(1), member(2), member(3)],
      concurrency: 2,
      stopOnFailure: false,
    }, { execute });

    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(2));
    pending[1]!.resolve({ testExecutionId: "exec-2", status: "PASSED" });
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(3));
    pending[2]!.resolve({ testExecutionId: "exec-3", status: "FAILED" });
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(4));
    pending[3]!.resolve({ testExecutionId: "exec-4", status: "PASSED" });
    pending[0]!.resolve({ testExecutionId: "exec-1", status: "PASSED" });

    const result = await resultPromise;
    expect(maximumActive).toBe(2);
    expect(result.status).toBe("FAILED");
    expect(result.items.map(({ position, testExecutionId }) => [position, testExecutionId])).toEqual([
      [0, "exec-1"], [1, "exec-2"], [2, "exec-3"], [3, "exec-4"],
    ]);
  });

  it("stops scheduling after failure and marks untouched members cancelled", async () => {
    const execute = vi.fn(async ({ position }: TestSuiteDefinition["members"][number]) => ({
      testExecutionId: `exec-${position}`,
      status: position === 0 ? "FAILED" as const : "PASSED" as const,
    }));

    const result = await runSuite({
      members: [member(0), member(1), member(2)],
      concurrency: 1,
      stopOnFailure: true,
    }, { execute });

    expect(execute).toHaveBeenCalledTimes(1);
    expect(result.status).toBe("FAILED");
    expect(result.items.map(({ status }) => status)).toEqual(["FAILED", "CANCELLED", "CANCELLED"]);
  });

  it("does not schedule disabled members", async () => {
    const execute = vi.fn(async () => ({ testExecutionId: "exec", status: "PASSED" as const }));
    const disabled = { ...member(0), isEnabled: false };

    const result = await runSuite({ members: [disabled], concurrency: 1, stopOnFailure: false }, { execute });

    expect(execute).not.toHaveBeenCalled();
    expect(result).toEqual({ status: "PASSED", items: [] });
  });
});
