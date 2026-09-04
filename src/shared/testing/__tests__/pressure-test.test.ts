import { describe, expect, it } from "vitest";
import {
  pressureTestMutationSchema,
  pressureTestExecutionSummarySchema,
} from "../pressure-test.js";
import { shouldStopForErrorRate, summarizePressureSamples } from "../pressure-test-metrics.js";

const projectId = "00000000-0000-4000-8000-000000005001";
const testCaseId = "00000000-0000-4000-8000-000000005002";

describe("pressure test contracts", () => {
  it("accepts the safe closed-model boundary and rejects values above it", () => {
    const definition = {
      name: "Checkout pressure", description: "", target: { testCaseId }, inputs: {},
      load: { virtualUsers: 20, rampUpMs: 120_000, durationMs: 600_000, thinkTimeMs: 10_000, maxIterations: 1_000 },
      thresholds: { maxErrorRate: 0.01, maxP95DurationMs: 800, minRequestsPerSecond: 5, stopOnErrorRate: true },
    };
    expect(pressureTestMutationSchema.parse(definition)).toEqual(definition);
    expect(pressureTestMutationSchema.safeParse({ ...definition,
      load: { ...definition.load, virtualUsers: 21 } }).success).toBe(false);
    expect(pressureTestMutationSchema.safeParse({ ...definition,
      load: { ...definition.load, maxIterations: 1_001 } }).success).toBe(false);
  });

  it("produces deterministic nearest-rank percentiles and threshold results", () => {
    const summary = summarizePressureSamples({
      samples: [100, 200, 300, 400, 500].map((durationMs, index) => ({
        status: index === 4 ? "FAILED" as const : "PASSED" as const,
        durationMs,
      })),
      elapsedMs: 2_000,
      thresholds: { maxErrorRate: 0.2, maxP95DurationMs: 500, minRequestsPerSecond: 2.5, stopOnErrorRate: true },
    });
    expect(summary).toMatchObject({ total: 5, passed: 4, failed: 1, errors: 0, cancelled: 0,
      errorRate: 0.2, averageRequestsPerSecond: 2.5,
      duration: { minMs: 100, maxMs: 500, averageMs: 300, p50Ms: 300, p90Ms: 500, p95Ms: 500, p99Ms: 500 } });
    expect(summary.thresholds.map(({ metric, passed }) => [metric, passed])).toEqual([
      ["ERROR_RATE", true], ["P95_DURATION", true], ["REQUESTS_PER_SECOND", true],
    ]);
    expect(pressureTestExecutionSummarySchema.parse(summary)).toEqual(summary);
  });

  it("counts infrastructure errors and cancellation without treating cancellation as an error-rate failure", () => {
    const summary = summarizePressureSamples({
      samples: [
        { status: "ERROR", durationMs: 50 },
        { status: "CANCELLED", durationMs: 10 },
        { status: "PASSED", durationMs: 40 },
      ],
      elapsedMs: 1_000,
      thresholds: { maxErrorRate: 0.5, maxP95DurationMs: 100, minRequestsPerSecond: 1, stopOnErrorRate: false },
    });
    expect(summary).toMatchObject({ total: 3, passed: 1, failed: 0, errors: 1, cancelled: 1, errorRate: 0.5 });
  });

  it("only opens the error-rate circuit after the minimum sample window", () => {
    const thresholds = { maxErrorRate: 0.1, maxP95DurationMs: 100, minRequestsPerSecond: 1, stopOnErrorRate: true };
    expect(shouldStopForErrorRate({ sampleCount: 19, failedOrErrored: 19, thresholds })).toBe(false);
    expect(shouldStopForErrorRate({ sampleCount: 20, failedOrErrored: 3, thresholds })).toBe(true);
    expect(shouldStopForErrorRate({ sampleCount: 20, failedOrErrored: 2, thresholds })).toBe(false);
  });
});
