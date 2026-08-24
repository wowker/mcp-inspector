import type { CallToolResult, Tool } from "@modelcontextprotocol/client";
import type {
  McpSession,
  WireObservation,
} from "../src/server/connections/connection-runtime.js";

export class FakeMcpSession implements McpSession {
  readonly protocolVersion = "2025-06-18";
  readonly serverInfo = { name: "fake", version: "1.0.0" };
  readonly calls: Array<{ name: string; arguments: Record<string, unknown> }> = [];
  closeCount = 0;
  tools: Tool[] = [];
  call?: (input: {
    name: string;
    arguments: Record<string, unknown>;
    signal?: AbortSignal;
    observe?: (event: WireObservation) => void;
  }) => Promise<CallToolResult>;

  async listTools(): Promise<{ tools: Tool[]; nextCursor?: string }> {
    return { tools: this.tools };
  }

  async callTool(input: {
    name: string;
    arguments: Record<string, unknown>;
    signal?: AbortSignal;
    observe?: (event: WireObservation) => void;
  }): Promise<CallToolResult> {
    this.calls.push({ name: input.name, arguments: input.arguments });
    if (this.call !== undefined) return this.call(input);
    return { content: [{ type: "text", text: input.name }] };
  }

  async close(): Promise<void> {
    this.closeCount += 1;
  }
}
