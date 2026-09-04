import type {
  PressureTestExecutionSummary,
  PressureTestSampleStatus,
  PressureTestThresholds,
} from "./pressure-test.js";

interface MetricSample {
  status: PressureTestSampleStatus;
  durationMs: number;
  startedAt?: string;
}

function round(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function percentile(sorted: readonly number[], quantile: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.max(0, Math.ceil(quantile * sorted.length) - 1)]!;
}

function peakRequestsPerSecond(samples: readonly MetricSample[], average: number): number {
  const buckets = new Map<string, number>();
  for (const sample of samples) {
    if (sample.startedAt === undefined) continue;
    const second = sample.startedAt.slice(0, 19);
    buckets.set(second, (buckets.get(second) ?? 0) + 1);
  }
  return buckets.size === 0 ? average : Math.max(...buckets.values());
}

export function summarizePressureSamples(input: {
  samples: readonly MetricSample[];
  elapsedMs: number;
  thresholds: PressureTestThresholds;
}): PressureTestExecutionSummary {
  const durations = input.samples.map(({ durationMs }) => durationMs).sort((left, right) => left - right);
  const passed = input.samples.filter(({ status }) => status === "PASSED").length;
  const failed = input.samples.filter(({ status }) => status === "FAILED").length;
  const errors = input.samples.filter(({ status }) => status === "ERROR").length;
  const cancelled = input.samples.filter(({ status }) => status === "CANCELLED").length;
  const completed = passed + failed + errors;
  const errorRate = completed === 0 ? 0 : round((failed + errors) / completed);
  const averageRequestsPerSecond = input.elapsedMs <= 0 ? 0 : round(completed / (input.elapsedMs / 1_000));
  const p95Ms = percentile(durations, 0.95);
  return {
    total: input.samples.length,
    passed,
    failed,
    errors,
    cancelled,
    errorRate,
    averageRequestsPerSecond,
    peakRequestsPerSecond: peakRequestsPerSecond(input.samples, averageRequestsPerSecond),
    duration: {
      minMs: durations[0] ?? 0,
      maxMs: durations.at(-1) ?? 0,
      averageMs: durations.length === 0 ? 0 : round(durations.reduce((total, value) => total + value, 0) / durations.length),
      p50Ms: percentile(durations, 0.5),
      p90Ms: percentile(durations, 0.9),
      p95Ms,
      p99Ms: percentile(durations, 0.99),
    },
    thresholds: [
      { metric: "ERROR_RATE", target: input.thresholds.maxErrorRate, actual: errorRate,
        passed: errorRate <= input.thresholds.maxErrorRate },
      { metric: "P95_DURATION", target: input.thresholds.maxP95DurationMs, actual: p95Ms,
        passed: p95Ms <= input.thresholds.maxP95DurationMs },
      { metric: "REQUESTS_PER_SECOND", target: input.thresholds.minRequestsPerSecond,
        actual: averageRequestsPerSecond, passed: averageRequestsPerSecond >= input.thresholds.minRequestsPerSecond },
    ],
  };
}

export function shouldStopForErrorRate(input: {
  sampleCount: number;
  failedOrErrored: number;
  thresholds: PressureTestThresholds;
}): boolean {
  if (!input.thresholds.stopOnErrorRate || input.sampleCount < 20) return false;
  return input.failedOrErrored / input.sampleCount > input.thresholds.maxErrorRate;
}
