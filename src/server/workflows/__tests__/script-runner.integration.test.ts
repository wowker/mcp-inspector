import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import {
  createScriptRunner,
  type ScriptRunner,
} from "../script-runner.js";

describe("isolated script runner", () => {
  let runner: ScriptRunner | undefined;

  afterEach(async () => {
    await runner?.close();
    runner = undefined;
  });

  function makeRunner(): ScriptRunner {
    runner = createScriptRunner({
      workerUrl: new URL("../script-worker.ts", import.meta.url),
      execArgv: ["--import", "tsx"],
    });
    return runner;
  }

  function makeAdversarialRunner(): ScriptRunner {
    runner = createScriptRunner({
      workerUrl: new URL("../../../../test-support/adversarial-script-worker.mjs", import.meta.url),
      execArgv: [],
    });
    return runner;
  }

  it("executes an async before script and returns only serializable staged state", async () => {
    const result = await makeRunner().run({
      evaluationId: randomUUID(),
      phase: "before",
      source: `
        export default async function before(ctx) {
          ctx.arguments.set("order.id", "order-2");
          ctx.arguments.remove("unused");
          ctx.variables.set("attempt", 2);
          ctx.env.set("lastOrder", "order-2", { scope: "server", secret: false });
          console.info("prepared", { id: ctx.arguments.get("order.id") });
        }
      `,
      arguments: { order: { id: "order-1" }, unused: true },
      response: null,
      variables: {},
      environment: { existing: "value" },
    });

    expect(result.arguments).toEqual({ order: { id: "order-2" } });
    expect(result.variables).toEqual({ attempt: 2 });
    expect(result.stagedEnvironment).toEqual([
      { scope: "server", name: "lastOrder", value: "order-2", secret: false },
    ]);
    expect(result.logs).toEqual([
      { level: "info", message: "prepared", data: { id: "order-2" }, line: null, column: null },
    ]);
  });

  it("keeps Node and browser capabilities outside the guest runtime", async () => {
    const result = await makeRunner().run({
      evaluationId: randomUUID(),
      phase: "before",
      source: `
        export default function before(ctx) {
          ctx.variables.set("capabilities", {
            process: typeof process,
            require: typeof require,
            fetch: typeof fetch,
            XMLHttpRequest: typeof XMLHttpRequest,
          });
        }
      `,
      arguments: {},
      response: null,
      variables: {},
      environment: {},
    });

    expect(result.variables).toEqual({
      capabilities: {
        process: "undefined",
        require: "undefined",
        fetch: "undefined",
        XMLHttpRequest: "undefined",
      },
    });
  });

  it("awaits bounded host Tool calls without exposing the host callback", async () => {
    const calls: Array<{ server: string; name: string; arguments: Record<string, unknown> }> = [];
    const result = await makeRunner().run({
      evaluationId: randomUUID(),
      phase: "before",
      source: `
        export default async function before(ctx) {
          const store = await ctx.tools.call({ server: "current", name: "list_stores", arguments: {} });
          const product = await ctx.tools.call({ server: "current", name: "get_product", arguments: { id: store.id } });
          ctx.arguments.set("productId", product.id);
        }
      `,
      arguments: {},
      response: null,
      variables: {},
      environment: {},
      onToolCall: async (input) => {
        calls.push(input);
        return input.name === "list_stores" ? { id: "store-1" } : { id: `product-for-${input.arguments.id}` };
      },
    });

    expect(calls).toEqual([
      { server: "current", name: "list_stores", arguments: {} },
      { server: "current", name: "get_product", arguments: { id: "store-1" } },
    ]);
    expect(result.arguments).toEqual({ productId: "product-for-store-1" });
  });

  it("rejects module imports and dynamic code constructors", async () => {
    const current = makeRunner();
    await expect(current.run({
      evaluationId: randomUUID(),
      phase: "before",
      source: `import fs from "node:fs"; export default function before() { return fs; }`,
      arguments: {}, response: null, variables: {}, environment: {},
    })).rejects.toMatchObject({ code: "FORBIDDEN_CAPABILITY" });

    const result = await current.run({
      evaluationId: randomUUID(),
      phase: "before",
      source: `export default function before(ctx) {
        ctx.variables.set("dynamic", {
          eval: typeof eval,
          Function: typeof Function,
          constructor: typeof (() => {}).constructor,
        });
      }`,
      arguments: {}, response: null, variables: {}, environment: {},
    });
    expect(result.variables.dynamic).toEqual({
      eval: "undefined",
      Function: "undefined",
      constructor: "undefined",
    });
  });

  it("supports JSONPath access and prevents after scripts from rewriting completed request arguments", async () => {
    const result = await makeRunner().run({
      evaluationId: randomUUID(),
      phase: "after",
      source: `export default function after(ctx) {
        ctx.variables.set("currency", ctx.json.get(ctx.response, "$.stores[0].currency"));
        ctx.assert.exists(ctx.variables.get("currency"));
        let mutationError = null;
        try { ctx.arguments.set("changed", true); } catch (error) { mutationError = error.message; }
        ctx.variables.set("mutationError", mutationError);
      }`,
      arguments: { original: true },
      response: { stores: [{ currency: "USD" }] },
      variables: {},
      environment: {},
    });

    expect(result.arguments).toEqual({ original: true });
    expect(result.variables).toEqual({
      currency: "USD",
      mutationError: "After scripts cannot modify completed request arguments",
    });
  });

  it("rejects prototype paths and non-JSON argument values", async () => {
    await expect(makeRunner().run({
      evaluationId: randomUUID(),
      phase: "before",
      source: `export default function before(ctx) {
        ctx.arguments.set("__proto__.polluted", true);
      }`,
      arguments: {}, response: null, variables: {}, environment: {},
    })).rejects.toMatchObject({ code: "FORBIDDEN_CAPABILITY" });
  });

  it("interrupts a non-terminating guest without retaining a child process", async () => {
    const current = makeRunner();
    await expect(current.run({
      evaluationId: randomUUID(),
      phase: "before",
      source: "export default function before() { while (true) {} }",
      arguments: {},
      response: null,
      variables: {},
      environment: {},
      limits: { timeoutMs: 100 },
    })).rejects.toMatchObject({ code: "TIMEOUT", phase: "before" });

    expect(current.activeCount).toBe(0);
  });

  it("fails closed on guest memory and stack exhaustion", async () => {
    const current = makeRunner();
    await expect(current.run({
      evaluationId: randomUUID(), phase: "before",
      source: `export default function before() {
        const values = []; while (true) values.push(new Uint8Array(512 * 1024));
      }`,
      arguments: {}, response: null, variables: {}, environment: {},
      limits: { timeoutMs: 2_000, memoryBytes: 4 * 1024 * 1024 },
    })).rejects.toMatchObject({ code: "MEMORY_LIMIT" });

    await expect(current.run({
      evaluationId: randomUUID(), phase: "before",
      source: `export default function before() {
        function recurse(value) { return recurse(value + 1) + 1; }
        recurse(0);
      }`,
      arguments: {}, response: null, variables: {}, environment: {},
      limits: { timeoutMs: 2_000, stackBytes: 65_536 },
    })).rejects.toMatchObject({ code: "STACK_LIMIT" });
    expect(current.activeCount).toBe(0);
  });

  it("returns stable syntax errors without exposing worker internals", async () => {
    await expect(makeRunner().run({
      evaluationId: randomUUID(),
      phase: "after",
      source: "export default async function after( {",
      arguments: {},
      response: { ok: true },
      variables: {},
      environment: {},
    })).rejects.toMatchObject({
      code: "SYNTAX_ERROR",
      phase: "after",
    });
  });

  it("enforces log limits again at the parent IPC boundary", async () => {
    await expect(makeAdversarialRunner().run({
      evaluationId: randomUUID(),
      phase: "before",
      source: "too-many-logs",
      arguments: {}, response: null, variables: {}, environment: {},
      limits: { maxLogs: 1 },
    })).rejects.toMatchObject({ code: "OUTPUT_LIMIT" });
  });

  it("rejects duplicate host-call IDs without invoking the helper twice", async () => {
    let calls = 0;
    await expect(makeAdversarialRunner().run({
      evaluationId: randomUUID(),
      phase: "before",
      source: "duplicate-host-call",
      arguments: {}, response: null, variables: {}, environment: {},
      onToolCall: async () => {
        calls += 1;
        await new Promise(() => undefined);
        return null;
      },
    })).rejects.toMatchObject({ code: "IPC_INVALID" });
    expect(calls).toBe(1);
  });

  it("rejects valid messages sent in the wrong IPC direction", async () => {
    await expect(makeAdversarialRunner().run({
      evaluationId: randomUUID(),
      phase: "before",
      source: "unexpected-direction",
      arguments: {}, response: null, variables: {}, environment: {},
    })).rejects.toMatchObject({ code: "IPC_INVALID" });
  });
});
