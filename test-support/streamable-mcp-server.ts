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

export async function startStreamableMcpServer(options: { controlCalls?: boolean } = {}): Promise<{
  url: string;
  enteredTotals: number[];
  completedTotals: number[];
  readonly maxConcurrentCalls: number;
  release(total: number): void;
  releaseAll(): void;
  stop(): Promise<void>;
}> {
  const enteredTotals: number[] = [];
  const completedTotals: number[] = [];
  const pendingCalls = new Map<number, () => void>();
  let concurrentCalls = 0;
  let maxConcurrentCalls = 0;
  const mcp = new McpServer({ name: "loopback-fixture", version: "1.0.0" });
  mcp.registerTool("echo", {
    description: "Echo a message",
    inputSchema: { message: z.string() },
  }, async ({ message }) => ({ content: [{ type: "text", text: message }] }));
  mcp.registerTool("sum", {
    description: "Add two numbers",
    inputSchema: { a: z.number(), b: z.number() },
    outputSchema: { total: z.number() },
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
      return {
        content: [{ type: "text", text: String(total) }],
        structuredContent: { total },
      };
    } finally { concurrentCalls -= 1; }
  });
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: randomUUID });
  await mcp.connect(transport);

  const handle = async (request: IncomingMessage, response: ServerResponse) => {
    try {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      if (url.pathname !== "/mcp") {
        response.writeHead(404).end();
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
  server.listen(0, "127.0.0.1");
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
    completedTotals,
    get maxConcurrentCalls() { return maxConcurrentCalls; },
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
