import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  if (chunks.length === 0) return undefined;
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}

export async function startStreamableMcpServer(options: {
  controlCalls?: boolean;
  includeChoiceTool?: boolean;
  comparisonMode?: boolean;
  catalogToolCount?: number;
  largeResponseBytes?: number;
  expectedRequestHeaders?: Record<string, string>;
  forbiddenRequestHeaders?: string[];
  closeResponseConnection?: boolean;
  port?: number;
} = {}): Promise<{
  url: string;
  receivedRequestHeaders: Array<Record<string, string | string[] | undefined>>;
  enteredTotals: number[];
  completedTotals: number[];
  readonly maxConcurrentCalls: number;
  updateSumSchema(): void;
  release(total: number): void;
  releaseAll(): void;
  stop(): Promise<void>;
}> {
  const enteredTotals: number[] = [];
  const receivedRequestHeaders: Array<Record<string, string | string[] | undefined>> = [];
  const completedTotals: number[] = [];
  const pendingCalls = new Map<number, () => void>();
  let concurrentCalls = 0;
  let maxConcurrentCalls = 0;
  let callSequence = 0;
  const mcp = new McpServer({ name: "loopback-fixture", version: "1.0.0" });
  const catalogToolCount = Math.max(0, Math.min(1_000, Math.trunc(options.catalogToolCount ?? 0)));
  for (let index = 0; index < catalogToolCount; index += 1) {
    const name = `load_test_tool_${String(index).padStart(4, "0")}`;
    mcp.registerTool(name, {
      description: `Performance fixture Tool ${index}`,
      inputSchema: {},
    }, async () => ({ content: [{ type: "text", text: name }] }));
  }
  mcp.registerTool("echo", {
    description: "Echo a message",
    inputSchema: { message: z.string() },
  }, async ({ message }) => ({ content: [{ type: "text", text: message }] }));
  if (options.includeChoiceTool === true) {
    mcp.registerTool("choose_mode", {
      description: "Choose an order selection mode",
      inputSchema: {
        field_01: z.string().optional(), field_02: z.string().optional(),
        field_03: z.string().optional(), field_04: z.string().optional(),
        field_05: z.string().optional(), field_06: z.string().optional(),
        field_07: z.string().optional(), field_08: z.string().optional(),
        field_09: z.string().optional(), field_10: z.string().optional(),
        field_11: z.string().optional(), field_12: z.string().optional(),
        selection_mode: z.enum(["selected", "filtered"]),
      },
    }, async ({ selection_mode }) => ({ content: [{ type: "text", text: selection_mode }] }));
  }
  const largeResponseBytes = Math.max(0, Math.trunc(options.largeResponseBytes ?? 0));
  if (largeResponseBytes > 0) {
    mcp.registerTool("large_payload", {
      description: "Return a deterministic large structured response",
      inputSchema: {},
      outputSchema: { payload: z.string() },
    }, async () => ({
      content: [{ type: "text", text: `Generated ${largeResponseBytes} bytes` }],
      structuredContent: { payload: "x".repeat(largeResponseBytes) },
    }));
  }
  const sumTool = mcp.registerTool("sum", {
    description: "Add two numbers",
    inputSchema: { a: z.number(), b: z.number() },
    outputSchema: options.comparisonMode === true
      ? { total: z.number(), requestId: z.string() }
      : { total: z.number() },
  }, async ({ a, b }) => {
    concurrentCalls += 1;
    maxConcurrentCalls = Math.max(maxConcurrentCalls, concurrentCalls);
    try {
      const total = a + b;
      enteredTotals.push(total);
      if (options.controlCalls === true) {
        await new Promise<void>((resolve) => {
          if (pendingCalls.has(total)) throw new Error(`duplicate controlled total ${total}`);
          pendingCalls.set(total, resolve);
        });
      }
      completedTotals.push(total);
      callSequence += 1;
      return {
        content: [{ type: "text", text: String(total) }],
        structuredContent: options.comparisonMode === true
          ? { total, requestId: `call-${callSequence}` }
          : { total },
      };
    } finally { concurrentCalls -= 1; }
  });
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: randomUUID });
  await mcp.connect(transport);

  const handle = async (request: IncomingMessage, response: ServerResponse) => {
    try {
      if (options.closeResponseConnection === true) response.setHeader("connection", "close");
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      if (url.pathname !== "/mcp") {
        response.writeHead(404).end();
        return;
      }
      receivedRequestHeaders.push({ ...request.headers });
      const rejectedHeader = Object.entries(options.expectedRequestHeaders ?? {}).find(
        ([name, value]) => request.headers[name.toLowerCase()] !== value,
      );
      if (rejectedHeader !== undefined) {
        response.writeHead(401, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: "unauthorized" }));
        return;
      }
      const forbiddenHeader = (options.forbiddenRequestHeaders ?? []).find(
        (name) => request.headers[name.toLowerCase()] !== undefined,
      );
      if (forbiddenHeader !== undefined) {
        response.writeHead(401, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: "unexpected credential header" }));
        return;
      }
      const body = request.method === "POST" ? await readJson(request) : undefined;
      await transport.handleRequest(request, response, body);
    } catch (error) {
      if (!response.headersSent) {
        response.writeHead(500).end(error instanceof Error ? error.message : "fixture failure");
      }
    }
  };
  const server = createServer((request, response) => { void handle(request, response); });
  server.listen(options.port ?? 0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("Fixture did not bind TCP");
  let stopped = false;
  function release(total: number): void {
    const pending = pendingCalls.get(total);
    if (pending === undefined) throw new Error(`controlled total ${total} is not pending`);
    pendingCalls.delete(total); pending();
  }
  function releaseAll(): void {
    for (const pending of pendingCalls.values()) pending();
    pendingCalls.clear();
  }

  return {
    url: `http://127.0.0.1:${address.port}/mcp`,
    enteredTotals,
    receivedRequestHeaders,
    completedTotals,
    get maxConcurrentCalls() { return maxConcurrentCalls; },
    updateSumSchema() {
      sumTool.update({ paramsSchema: { a: z.number(), b: z.number(), label: z.string().optional() } });
    },
    release,
    releaseAll,
    async stop() {
      if (stopped) return;
      stopped = true;
      releaseAll();
      await mcp.close();
      server.close();
      await once(server, "close");
    },
  };
}
