import { once } from "node:events";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { serve, type ServerType } from "@hono/node-server";
import open from "open";
import { createApp } from "./app.js";
import { createConnectionService } from "./connections/connection-service.js";
import { createRuntimeConfig } from "./config/runtime-config.js";
import { resolveDefaultDataRoot } from "./projects/project-paths.js";
import { createProjectService } from "./projects/project-service.js";
import { createRunService } from "./runs/run-service.js";
import { createTabService } from "./tabs/tab-service.js";
import { createToolService } from "./tools/tool-service.js";

export interface InspectorAddress {
  host: "127.0.0.1";
  port: number;
  origin: string;
}

export interface InspectorRuntime {
  address: InspectorAddress;
  close(): Promise<void>;
}

export interface StartInspectorOptions {
  host?: string;
  port?: number;
  dataRoot?: string;
  staticRoot?: string;
  clientOrigin?: string;
  version?: string;
  openBrowser?: (url: string) => void | Promise<void>;
  installSignalHandlers?: boolean;
}

export function reportStartupFailure(_error: unknown,
  write: (message: string) => void = (message) => { console.error(message); }): void {
  write("Unable to start MCP Inspector");
}

export async function runInspectorCli(options: {
  start?: () => Promise<InspectorRuntime>;
  writeInfo?: (message: string) => void;
  writeError?: (message: string) => void;
} = {}): Promise<0 | 1> {
  try {
    const runtime = await (options.start ?? (() => startInspector()))();
    (options.writeInfo ?? ((message) => { console.info(message); }))(
      `MCP Inspector listening on ${runtime.address.origin}`,
    );
    return 0;
  } catch (error) {
    reportStartupFailure(error, options.writeError);
    return 1;
  }
}

function closeServer(server: ServerType): Promise<void> {
  if (!server.listening) return Promise.resolve();
  return new Promise((resolve, reject) => {
    server.close((error) => error === undefined ? resolve() : reject(error));
  });
}

function resolveStaticRoot(moduleUrl: URL = new URL(import.meta.url)): string {
  const bundled = new URL("../client/index.html", moduleUrl);
  if (existsSync(bundled)) return fileURLToPath(new URL("../client/", moduleUrl));
  const sourceBuild = new URL("../../dist/client/index.html", moduleUrl);
  if (existsSync(sourceBuild)) return fileURLToPath(new URL("../../dist/client/", moduleUrl));
  throw new Error("Built Inspector client is missing; run npm run build first");
}

function validateClientOrigin(raw: string): string {
  let value: URL;
  try { value = new URL(raw); } catch { throw new Error("Inspector client origin must use IPv4 loopback"); }
  if (value.protocol !== "http:" || value.hostname !== "127.0.0.1" || value.username !== "" || value.password !== "" ||
      value.pathname !== "/" || value.search !== "" || value.hash !== "") {
    throw new Error("Inspector client origin must use IPv4 loopback");
  }
  return value.origin;
}

export async function startInspector(options: StartInspectorOptions = {}): Promise<InspectorRuntime> {
  const config = createRuntimeConfig({
    host: (options.host ?? "127.0.0.1") as "127.0.0.1",
    port: options.port,
    version: options.version,
  });
  const clientOrigin = options.clientOrigin === undefined ? undefined : validateClientOrigin(options.clientOrigin);
  const staticRoot = options.staticRoot ?? (clientOrigin === undefined ? resolveStaticRoot() : undefined);
  const projects = createProjectService({ dataRoot: options.dataRoot ?? resolveDefaultDataRoot() });
  let allowedOrigin = clientOrigin ?? "";
  const connections = createConnectionService(projects, {
    oauthRedirectUrl: () => `${allowedOrigin}/oauth/callback`,
    openAuthorizationUrl: options.openBrowser ?? (async (url) => { await open(url); }),
  });
  const tools = createToolService(projects, connections);
  const tabs = createTabService(projects, connections, { tools });
  const runs = createRunService(projects, connections, tabs);
  const app = createApp({
    sessionToken: config.sessionToken,
    allowedOrigin: () => allowedOrigin,
    version: config.version,
    projects,
    connections,
    tools,
    tabs,
    runs,
    staticRoot,
  });
  let server: ServerType | undefined;
  let closePromise: Promise<void> | undefined;
  let signalClosing = false;

  const removeSignalHandlers = () => {
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
  };
  const close = (): Promise<void> => {
    if (closePromise !== undefined) return closePromise;
    closePromise = (async () => {
      removeSignalHandlers();
      const listenerClose = server === undefined ? Promise.resolve() : closeServer(server);
      await runs.close();
      await connections.close().catch(() => undefined);
      const closable = server as (ServerType & { closeAllConnections?: () => void }) | undefined;
      closable?.closeAllConnections?.();
      await listenerClose;
      projects.close();
    })();
    return closePromise;
  };
  const onSignal = () => {
    if (signalClosing) return;
    signalClosing = true;
    void close().catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : "Inspector shutdown failed");
      process.exitCode = 1;
    });
  };

  try {
    server = serve({ fetch: app.fetch, hostname: config.host, port: config.port });
    if (!server.listening) {
      await Promise.race([
        once(server, "listening"),
        once(server, "error").then(([error]) => Promise.reject(error)),
      ]);
    }
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("Inspector did not bind TCP");
    const serverOrigin = `http://${config.host}:${address.port}`;
    allowedOrigin ||= serverOrigin;
    if (options.installSignalHandlers !== false) {
      process.once("SIGINT", onSignal);
      process.once("SIGTERM", onSignal);
    }
    const browserUrl = new URL(clientOrigin ?? serverOrigin);
    browserUrl.searchParams.set("session", config.sessionToken);
    try {
      await (options.openBrowser ?? ((url) => open(url)))(browserUrl.toString());
    } catch {
      throw new Error("Unable to open Inspector browser");
    }
    return {
      address: { host: config.host, port: address.port, origin: serverOrigin },
      close,
    };
  } catch (error) {
    await close().catch(() => undefined);
    throw error;
  }
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && fileURLToPath(import.meta.url) === resolve(invokedPath)) {
  void runInspectorCli({ start: () => startInspector({ clientOrigin: "http://127.0.0.1:5173" }) })
    .then((exitCode) => { process.exitCode = exitCode; });
}
