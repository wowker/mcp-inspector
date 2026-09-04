import { describe, expect, it } from "vitest";
import type { PressureTestLoad } from "../../../shared/testing/pressure-test.js";
import { runPressureLoad } from "../pressure-test-runner.js";

const load = (overrides: Partial<PressureTestLoad> = {}): PressureTestLoad => ({
  virtualUsers: 3,
  rampUpMs: 1_000,
  durationMs: 10_000,
  thinkTimeMs: 0,
  maxIterations: 5,
  ...overrides,
});

describe("runPressureLoad", () => {
  it("stages virtual users and never exceeds the global iteration cap", async () => {
    let clock = 0;
    const waits: Array<{ virtualUser: number; milliseconds: number }> = [];
    const calls: Array<{ virtualUser: number; iteration: number }> = [];
    const result = await runPressureLoad({ load: load(), signal: new AbortController().signal }, {
      now: () => clock,
      wait: async (milliseconds, _signal, virtualUser) => { waits.push({ virtualUser, milliseconds }); clock += milliseconds; },
      execute: async (virtualUser, iteration) => {
        calls.push({ virtualUser, iteration });
        return { status: "PASSED", durationMs: 10 };
      },
    });
    expect(waits).toEqual(expect.arrayContaining([
      { virtualUser: 2, milliseconds: 500 },
      { virtualUser: 3, milliseconds: 1_000 },
    ]));
    expect(calls).toHaveLength(5);
    expect(calls.map(({ iteration }) => iteration).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
    expect(result).toEqual({ started: 5, completed: 5, cancelled: false });
  });

  it("stops reserving iterations after cancellation", async () => {
    const controller = new AbortController();
    let calls = 0;
    const result = await runPressureLoad({
      load: load({ virtualUsers: 1, rampUpMs: 0, maxIterations: 100 }), signal: controller.signal,
    }, {
      now: () => 0,
      wait: async () => undefined,
      execute: async () => {
        calls += 1;
        controller.abort();
        return { status: "CANCELLED", durationMs: 0 };
      },
    });
    expect(calls).toBe(1);
    expect(result).toEqual({ started: 1, completed: 1, cancelled: true });
  });

  it("does not start work after the duration deadline", async () => {
    let clock = 0;
    let calls = 0;
    const result = await runPressureLoad({
      load: load({ virtualUsers: 1, rampUpMs: 0, durationMs: 1_000, thinkTimeMs: 400, maxIterations: 10 }),
      signal: new AbortController().signal,
    }, {
      now: () => clock,
      wait: async (milliseconds) => { clock += milliseconds; },
      execute: async () => { calls += 1; return { status: "PASSED", durationMs: 0 }; },
    });
    expect(calls).toBe(3);
    expect(result.started).toBe(3);
  });
});
