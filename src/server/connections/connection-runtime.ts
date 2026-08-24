import type { CallToolResult, Tool } from "@modelcontextprotocol/client";
import type { ConnectionError, ConnectionRecord } from "./connection-types.js";

export type WireObservation =
  | { kind: "http-request"; at: string; method: string; url: string; headers: Record<string, string>; body: unknown }
  | { kind: "http-response"; at: string; status: number; headers: Record<string, string>; body: unknown }
  | { kind: "rpc-out" | "rpc-in"; at: string; message: unknown };

export interface McpSession {
  readonly protocolVersion: string;
  readonly serverInfo: { name: string; version: string } | null;
  listTools(input?: { cursor?: string }): Promise<{ tools: Tool[]; nextCursor?: string }>;
  callTool(input: {
    name: string;
    arguments: Record<string, unknown>;
    signal?: AbortSignal;
    observe?: (event: WireObservation) => void;
  }): Promise<CallToolResult>;
  close(): Promise<void>;
}

export type McpSessionFactory = (
  connection: ConnectionRecord,
  observe: (event: WireObservation) => void,
) => Promise<McpSession>;

export interface ConnectionRuntime {
  connect(connectionId: string): Promise<McpSession>;
  get(connectionId: string): McpSession | undefined;
  status(connectionId: string): ConnectionRecord["status"];
  callTool(
    connectionId: string,
    input: Parameters<McpSession["callTool"]>[0],
  ): Promise<CallToolResult>;
  disconnect(connectionId: string): Promise<void>;
}

export class McpConnectError extends Error {
  constructor() {
    super("Unable to connect to MCP server");
    this.name = "McpConnectError";
  }
}

export class McpNotConnectedError extends Error {
  constructor() {
    super("MCP connection is not active");
    this.name = "McpNotConnectedError";
  }
}

export class CallTimeoutError extends Error {
  constructor() {
    super("MCP Tool call timed out");
    this.name = "CallTimeoutError";
  }
}

export class CallCancelledError extends Error {
  constructor() {
    super("MCP Tool call was cancelled");
    this.name = "CallCancelledError";
  }
}

interface RuntimeEntry {
  session?: McpSession;
  connect?: Promise<McpSession>;
  disconnect?: Promise<void>;
  generation: number;
  status: ConnectionRecord["status"];
}

const connectFailure: ConnectionError = {
  code: "MCP_CONNECT_FAILED",
  message: "Unable to connect to MCP server",
};

class ConnectInvalidatedError extends Error {}

function isAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

export function createConnectionRuntime(options: {
  resolveConnection: (connectionId: string) => ConnectionRecord;
  factory: McpSessionFactory;
  observe?: (event: WireObservation) => void;
  persistSuccess?: (
    connectionId: string,
    metadata: { protocolVersion: string; serverInfo: Record<string, unknown> | null },
  ) => void;
  persistFailure?: (connectionId: string, error: ConnectionError) => void;
}): ConnectionRuntime {
  const entries = new Map<string, RuntimeEntry>();
  const connectionObserver = options.observe ?? (() => undefined);

  function entryFor(connectionId: string): RuntimeEntry {
    const current = entries.get(connectionId);
    if (current !== undefined) return current;
    const created: RuntimeEntry = { generation: 0, status: "disconnected" };
    entries.set(connectionId, created);
    return created;
  }

  const runtime: ConnectionRuntime = {
    connect(connectionId) {
      const entry = entryFor(connectionId);
      if (entry.disconnect !== undefined) {
        return entry.disconnect.then(() => runtime.connect(connectionId));
      }
      if (entry.session !== undefined) return Promise.resolve(entry.session);
      if (entry.connect !== undefined) return entry.connect;
      const generation = entry.generation;
      let connection: ConnectionRecord;
      try {
        connection = options.resolveConnection(connectionId);
      } catch (error) {
        entries.delete(connectionId);
        throw error;
      }
      entry.status = "connecting";
      const attempt = Promise.resolve()
        .then(() => options.factory(connection, connectionObserver))
        .then(async (session) => {
          if (entry.generation !== generation) {
            await session.close();
            throw new ConnectInvalidatedError();
          }
          try {
            options.persistSuccess?.(connectionId, {
              protocolVersion: session.protocolVersion,
              serverInfo: session.serverInfo,
            });
          } catch (error) {
            await session.close().catch(() => undefined);
            throw error;
          }
          entry.session = session;
          entry.status = "connected";
          return session;
        })
        .catch((error: unknown) => {
          if (error instanceof ConnectInvalidatedError) {
            entry.status = "disconnected";
            throw new McpConnectError();
          }
          entry.status = "failed";
          try { options.persistFailure?.(connectionId, connectFailure); } catch { /* Keep public errors normalized. */ }
          if (error instanceof McpConnectError) throw error;
          throw new McpConnectError();
        })
        .finally(() => {
          if (entry.connect === attempt) entry.connect = undefined;
        });
      entry.connect = attempt;
      return attempt;
    },

    get(connectionId) {
      return entries.get(connectionId)?.session;
    },

    status(connectionId) {
      return entries.get(connectionId)?.status ?? "disconnected";
    },

    async callTool(connectionId, input) {
      const session = entries.get(connectionId)?.session;
      if (session === undefined) throw new McpNotConnectedError();
      if (isAborted(input.signal)) throw new CallCancelledError();
      const connection = options.resolveConnection(connectionId);
      const timeoutController = new AbortController();
      const timeout = setTimeout(
        () => timeoutController.abort(new CallTimeoutError()),
        connection.timeoutMs,
      );
      const timeoutSignal = timeoutController.signal;
      const signal = input.signal === undefined
        ? timeoutSignal
        : AbortSignal.any([input.signal, timeoutSignal]);
      try {
        return await session.callTool({ ...input, signal });
      } catch (error) {
        if (isAborted(input.signal)) throw new CallCancelledError();
        if (timeoutSignal.aborted) throw new CallTimeoutError();
        throw error;
      } finally {
        clearTimeout(timeout);
      }
    },

    disconnect(connectionId) {
      const entry = entries.get(connectionId);
      if (entry === undefined) return Promise.resolve();
      if (entry.disconnect !== undefined) return entry.disconnect;
      entry.generation += 1;
      entry.status = "disconnected";
      const pending = entry.connect;
      const operation = (async () => {
        if (pending !== undefined) {
          try { await pending; } catch { /* A failed or invalidated connect has nothing left to close. */ }
        }
        const session = entry.session;
        entry.session = undefined;
        if (session !== undefined) await session.close();
      })().finally(() => {
        entries.delete(connectionId);
      });
      entry.disconnect = operation;
      return operation;
    },
  };
  return runtime;
}
