import type { PressureTestLoad, PressureTestSampleStatus } from "../../shared/testing/pressure-test.js";

export interface PressureIterationResult {
  status: PressureTestSampleStatus;
  durationMs: number;
}

export interface PressureLoadResult {
  started: number;
  completed: number;
  cancelled: boolean;
}

function abortError(): DOMException {
  return new DOMException("Pressure test wait was aborted", "AbortError");
}

export function waitForPressureDelay(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (milliseconds <= 0) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) { reject(abortError()); return; }
    const complete = () => { signal.removeEventListener("abort", abort); resolve(); };
    const timer = setTimeout(complete, milliseconds);
    const abort = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      reject(abortError());
    };
    signal.addEventListener("abort", abort, { once: true });
  });
}

export async function runPressureLoad(input: {
  load: PressureTestLoad;
  signal: AbortSignal;
}, deps: {
  execute(virtualUser: number, iteration: number): Promise<PressureIterationResult>;
  wait(milliseconds: number, signal: AbortSignal, virtualUser: number): Promise<void>;
  now(): number;
  onSample?(virtualUser: number, iteration: number, result: PressureIterationResult): void | Promise<void>;
}): Promise<PressureLoadResult> {
  const startedAt = deps.now();
  const deadline = startedAt + input.load.durationMs;
  let nextIteration = 1;
  let completed = 0;

  const reserve = (): number | null => {
    if (input.signal.aborted || deps.now() >= deadline || nextIteration > input.load.maxIterations) return null;
    const iteration = nextIteration;
    nextIteration += 1;
    return iteration;
  };

  const worker = async (virtualUser: number) => {
    const delay = input.load.virtualUsers === 1 ? 0
      : Math.floor(input.load.rampUpMs * (virtualUser - 1) / (input.load.virtualUsers - 1));
    try {
      if (delay > 0) await deps.wait(delay, input.signal, virtualUser);
      while (!input.signal.aborted) {
        const iteration = reserve();
        if (iteration === null) return;
        const result = await deps.execute(virtualUser, iteration);
        completed += 1;
        await deps.onSample?.(virtualUser, iteration, result);
        if (input.signal.aborted) return;
        if (input.load.thinkTimeMs > 0) await deps.wait(input.load.thinkTimeMs, input.signal, virtualUser);
      }
    } catch (error) {
      if (!input.signal.aborted || !(error instanceof DOMException && error.name === "AbortError")) throw error;
    }
  };

  await Promise.all(Array.from({ length: input.load.virtualUsers }, (_, index) => worker(index + 1)));
  return { started: nextIteration - 1, completed, cancelled: input.signal.aborted };
}
