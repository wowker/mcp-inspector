import { parentPort, workerData } from "node:worker_threads";
import { tsImport } from "tsx/esm/api";

const { ProjectStore } = await tsImport("../src/server/projects/project-store.ts", import.meta.url);
const { RunEventBus } = await tsImport("../src/server/runs/run-event-bus.ts", import.meta.url);
const { RunRepository } = await tsImport("../src/server/runs/run-repository.ts", import.meta.url);

const state = new Int32Array(workerData.barrier);
const store = new ProjectStore({ databasePath: workerData.databasePath, project: workerData.project });
try {
  parentPort?.postMessage({ type: "ready" });
  while (Atomics.load(state, 0) === 0) Atomics.wait(state, 0, 0);
  const result = new RunRepository(store, new RunEventBus()).create(workerData.input);
  parentPort?.postMessage({ type: "result", ok: true, created: result.created, runId: result.run.id });
} catch (error) {
  parentPort?.postMessage({ type: "result", ok: false,
    error: error instanceof Error ? `${error.name}:${error.message}` : "unknown" });
} finally { store.close(); }
