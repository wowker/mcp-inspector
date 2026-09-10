import { once } from "node:events";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { serve, type ServerType } from "@hono/node-server";
import open from "open";
import { createApp, createSessionBootstrap } from "./app.js";
import { createConnectionService } from "./connections/connection-service.js";
import { createRuntimeConfig } from "./config/runtime-config.js";
import { resolveDefaultDataRoot } from "./projects/project-paths.js";
import { createProjectService } from "./projects/project-service.js";
import { createRunService } from "./runs/run-service.js";
import { createTabService } from "./tabs/tab-service.js";
import { createToolService } from "./tools/tool-service.js";
import { createWorkflowService } from "./workflows/workflow-service.js";
import { createEnvironmentService } from "./environment/environment-service.js";
import { createEnvironmentProfileService, createProfileAwareEnvironmentService } from "./environment/environment-profile-service.js";
import { createWorkflowExecutionService } from "./workflows/workflow-execution-service.js";
import { createWorkflowDebugService } from "./workflows/workflow-debug-service.js";
import { InstallationSettingsRepository } from "./registry/installation-settings-repository.js";
import { createAuthoringAuthService } from "./authoring/authoring-auth-service.js";
import { createAuthoringMcpServer } from "./authoring/authoring-mcp-server.js";
import { createAuthoringPolicyService } from "./authoring/authoring-policy-service.js";
import { createAuthoringCatalogService } from "./authoring/authoring-catalog-service.js";

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

interface InspectorCliStartOptions {
  port: number;
}

type InspectorCliEnvironment = Readonly<Record<string, string | undefined>>;

export class InspectorStartupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InspectorStartupError";
  }
}

function parseUserPort(value: string, source: "--port" | "MCP_INSPECTOR_PORT"): number {
  if (!/^[1-9]\d*$/.test(value)) {
    throw new InspectorStartupError(`${source} must be an integer between 1 and 65535`);
  }
  const port = Number(value);
  if (!Number.isSafeInteger(port) || port > 65_535) {
    throw new InspectorStartupError(`${source} must be an integer between 1 and 65535`);
  }
  return port;
}

export function resolveInspectorCliPort(
  argv: readonly string[],
  env: InspectorCliEnvironment,
): number {
  let cliValue: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--port") {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new InspectorStartupError("--port requires a value");
      }
      if (cliValue !== undefined) {
        throw new InspectorStartupError("--port may only be provided once");
      }
      cliValue = value;
      index += 1;
      continue;
    }
    if (argument?.startsWith("--port=")) {
      if (cliValue !== undefined) {
        throw new InspectorStartupError("--port may only be provided once");
      }
      cliValue = argument.slice("--port=".length);
      continue;
    }
    throw new InspectorStartupError("Unsupported command-line argument");
  }
  if (cliValue !== undefined) return parseUserPort(cliValue, "--port");
  const envValue = env.MCP_INSPECTOR_PORT;
  return envValue === undefined ? 8500 : parseUserPort(envValue, "MCP_INSPECTOR_PORT");
}

export function reportStartupFailure(error: unknown,
  write: (message: string) => void = (message) => { console.error(message); }): void {
  write(error instanceof InspectorStartupError
    ? error.message
    : "Unable to start MCP Inspector");
}

export async function runInspectorCli(options: {
  start?: (options: InspectorCliStartOptions) => Promise<InspectorRuntime>;
  argv?: readonly string[];
  env?: InspectorCliEnvironment;
  writeInfo?: (message: string) => void;
  writeError?: (message: string) => void;
} = {}): Promise<0 | 1> {
  try {
    const port = resolveInspectorCliPort(
      options.argv ?? process.argv.slice(2),
      options.env ?? process.env,
    );
    const runtime = await (options.start ?? ((startOptions) => startInspector(startOptions)))({ port });
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
  let installationSettings: InstallationSettingsRepository;
  try {
    installationSettings = new InstallationSettingsRepository({
      dataRoot: options.dataRoot ?? resolveDefaultDataRoot(),
    });
  } catch (error) {
    projects.close();
    throw error;
  }
  const authoringAuth = createAuthoringAuthService({ repository: installationSettings });
  let allowedOrigin = clientOrigin ?? "";
  let serverOrigin = "";
  const authoringPolicies = createAuthoringPolicyService({ projects });
  let environment: ReturnType<typeof createEnvironmentService> | undefined;
  let environmentProfiles: ReturnType<typeof createEnvironmentProfileService> | undefined;
  const connections = createConnectionService(projects, {
    oauthRedirectUrl: () => `${allowedOrigin}/oauth/callback`,
    openAuthorizationUrl: options.openBrowser ?? (async (url) => { await open(url); }),
    resolveEnvironment: (projectId, connectionId) => {
      const resolved = environmentProfiles?.resolveActive(projectId, connectionId)
        ?? environment?.resolve(projectId, connectionId);
      return resolved === undefined
        ? { project: {}, server: {} }
        : { project: resolved.project, server: resolved.server };
    },
  });
  const tools = createToolService(projects, connections);
  const authoringCatalog = createAuthoringCatalogService({
    projects,
    connections,
    tools,
    policies: authoringPolicies,
  });
  const authoringMcp = createAuthoringMcpServer({
    appVersion: config.version,
    endpoint: () => `${serverOrigin}/mcp/authoring`,
    catalog: authoringCatalog,
  });
  const tabs = createTabService(projects, connections, { tools });
  const runs = createRunService(projects, connections, tabs);
  const workflows = createWorkflowService(projects, tools);
  environment = createEnvironmentService(projects, connections);
  environmentProfiles = createEnvironmentProfileService(projects, connections, environment);
  const runtimeEnvironment = createProfileAwareEnvironmentService(environment, environmentProfiles);
  const workflowExecutions = createWorkflowExecutionService({
    projects, connections, tabs, workflows, environment: runtimeEnvironment, runs,
  });
  const workflowDebug = createWorkflowDebugService({ connections, tools, environment: runtimeEnvironment, runs });
  const sessionBootstrap = createSessionBootstrap();
  const app = createApp({
    sessionToken: config.sessionToken,
    sessionBootstrap,
    allowedOrigin: () => allowedOrigin,
    version: config.version,
    projects,
    connections,
    tools,
    tabs,
    runs,
    workflows,
    environment,
    environmentProfiles,
    workflowExecutions,
    workflowDebug,
    authoringAuth,
    authoringMcp,
    authoringOrigin: () => serverOrigin,
    authoringPolicies,
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
      await authoringMcp.close();
      await workflowExecutions.close();
      await workflowDebug.close();
      await runs.close();
      await connections.close().catch(() => undefined);
      const closable = server as (ServerType & { closeAllConnections?: () => void }) | undefined;
      closable?.closeAllConnections?.();
      await listenerClose;
      try {
        projects.close();
      } finally {
        installationSettings.close();
      }
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
    serverOrigin = `http://${config.host}:${address.port}`;
    allowedOrigin ||= serverOrigin;
    if (options.installSignalHandlers !== false) {
      process.once("SIGINT", onSignal);
      process.once("SIGTERM", onSignal);
    }
    const browserUrl = new URL(clientOrigin ?? serverOrigin);
    browserUrl.pathname = `/bootstrap/${sessionBootstrap.issue()}`;
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
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError?.code === "EADDRINUSE") {
      throw new InspectorStartupError(`Port ${config.port} is already in use`);
    }
    throw error;
  }
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && fileURLToPath(import.meta.url) === resolve(invokedPath)) {
  void runInspectorCli({
    argv: process.argv.slice(2),
    env: process.env,
    start: ({ port }) => startInspector({
    clientOrigin: "http://127.0.0.1:5173",
      port,
    }),
  })
    .then((exitCode) => { process.exitCode = exitCode; });
}
