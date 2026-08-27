import { Hono } from "hono";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { extname, relative, resolve } from "node:path";
import { createConnectionService, type ConnectionService } from "./connections/connection-service.js";
import { createConnectionRoutes } from "./connections/routes.js";
import type { ProjectService } from "./projects/project-service.js";
import { createProjectRoutes } from "./projects/routes.js";
import { sessionAuth } from "./security/session-auth.js";
import { createToolRoutes } from "./tools/routes.js";
import { createToolService, type ToolService } from "./tools/tool-service.js";
import { createTabRoutes } from "./tabs/routes.js";
import { createTabService, type TabService } from "./tabs/tab-service.js";
import { createRunRoutes } from "./runs/routes.js";
import { createRunService, type RunServiceWithEvents } from "./runs/run-service.js";
import { createSavedItemRoutes } from "./saved-items/routes.js";
import { createSavedItemService, type SavedItemService } from "./saved-items/saved-item-service.js";
import { OAUTH_CHANNEL } from "../shared/oauth-events.js";
import { createWorkflowRoutes } from "./workflows/routes.js";
import { createWorkflowService, type WorkflowService } from "./workflows/workflow-service.js";
import { createEnvironmentRoutes } from "./environment/routes.js";
import { createEnvironmentService, type EnvironmentService } from "./environment/environment-service.js";
import { createWorkflowExecutionRoutes } from "./workflows/execution-routes.js";
import {
  createWorkflowExecutionService,
  type WorkflowExecutionService,
} from "./workflows/workflow-execution-service.js";
import { createWorkflowDebugRoutes } from "./workflows/debug-routes.js";
import { createWorkflowDebugService, type WorkflowDebugService } from "./workflows/workflow-debug-service.js";

export interface AppDependencies {
  sessionToken: string;
  allowedOrigin: string | (() => string);
  version: string;
  projects?: ProjectService;
  connections?: ConnectionService;
  tools?: ToolService;
  tabs?: TabService;
  runs?: RunServiceWithEvents;
  savedItems?: SavedItemService;
  workflows?: WorkflowService;
  environment?: EnvironmentService;
  workflowExecutions?: WorkflowExecutionService;
  workflowDebug?: WorkflowDebugService;
  staticRoot?: string;
}

const contentTypes: Readonly<Record<string, string>> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

function safeStaticPath(root: string, requestPath: string): string | null {
  let decoded: string;
  try { decoded = decodeURIComponent(requestPath); } catch { return null; }
  if (decoded.includes("\0")) return null;
  const candidate = resolve(root, `.${decoded}`);
  const child = relative(resolve(root), candidate);
  return child === "" || child.startsWith("..") || child.includes("/../") ? null : candidate;
}

function isApiPath(path: string): boolean {
  return path === "/api" || path.startsWith("/api/");
}

function scriptJson(value: string): string {
  return JSON.stringify(value).replace(/[<>&\u2028\u2029]/g, (character) =>
    `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`);
}

const oauthPageStyles = `:root{color-scheme:light;--canvas:#fbfbfa;--surface:#fff;--border:#e7e6e2;--text:#2f3437;--muted:#787774;--action:#222423;--action-hover:#3a3d3b;--action-text:#fff;--success:#346538;--success-bg:#edf3ec;--danger:#9f2f2d;--danger-bg:#fdebec;font-family:"SF Pro Display",-apple-system,BlinkMacSystemFont,"Helvetica Neue","Noto Sans SC",sans-serif}[data-color-mode="dark"]{color-scheme:dark;--canvas:#191918;--surface:#20201f;--border:#363633;--text:#f2f1ed;--muted:#aaa8a1;--action:#f0efeb;--action-hover:#fff;--action-text:#222423;--success:#91bc93;--success-bg:#263529;--danger:#e99a98;--danger-bg:#422827}*{box-sizing:border-box}body{min-width:320px;min-height:100dvh;margin:0;display:grid;place-items:center;padding:24px;background:var(--canvas);color:var(--text)}.oauth-status{width:min(420px,100%);padding:28px;border:1px solid var(--border);border-radius:8px;background:var(--surface)}.oauth-brand{display:flex;align-items:center;gap:10px;margin-bottom:28px}.oauth-brand__mark{display:grid;width:32px;height:32px;place-items:center;border-radius:6px;background:var(--text);color:var(--surface);font-weight:750}.oauth-brand strong{display:block;font-size:14px}.oauth-brand small{display:block;color:var(--muted);font-size:11px}.oauth-icon{display:grid;width:38px;height:38px;place-items:center;margin-bottom:16px;border-radius:50%;font-size:20px;font-weight:750}.oauth-status--success .oauth-icon{color:var(--success);background:var(--success-bg)}.oauth-status--error .oauth-icon{color:var(--danger);background:var(--danger-bg)}h1{margin:0 0 8px;font-size:21px;line-height:1.3;letter-spacing:-.02em}p{margin:0;color:var(--muted);font-size:14px;line-height:1.65}.oauth-actions{display:flex;align-items:center;gap:14px;margin-top:22px}button{min-height:34px;padding:6px 12px;border:0;border-radius:6px;background:var(--action);color:var(--action-text);font:inherit;font-weight:650;cursor:pointer}button:hover{background:var(--action-hover)}button:focus-visible{outline:2px solid var(--text);outline-offset:2px}.oauth-hint{font-size:12px}@media(max-width:480px){body{padding:16px}.oauth-status{padding:22px}.oauth-actions{align-items:stretch;flex-direction:column}.oauth-actions button{width:100%}}`;

const OAUTH_RETURN_TICKET_TTL_MS = 60_000;

function oauthSuccessPage(connectionId: string, returnUrl: string, nonce: string): string {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>OAuth 授权成功</title>
<style nonce="${nonce}">${oauthPageStyles}</style></head>
<body><main class="oauth-status oauth-status--success"><div class="oauth-brand"><span class="oauth-brand__mark" aria-hidden="true">M</span><span><strong>MCP Inspector</strong><small>OAuth callback</small></span></div><span class="oauth-icon" aria-hidden="true">✓</span><h1>OAuth 授权完成</h1><p id="status" aria-live="polite">正在返回 Server 管理…</p><div class="oauth-actions"><button id="return" type="button">返回 MCP Inspector</button><span class="oauth-hint">此页面稍后会自动关闭</span></div></main>
<script nonce="${nonce}">(()=>{try{const saved=localStorage.getItem("mcp-inspector-theme");document.documentElement.dataset.colorMode=saved==="dark"?"dark":"light"}catch{}try{history.replaceState(null,"","/oauth/callback")}catch{}const connectionId=${scriptJson(connectionId)};const returnUrl=${scriptJson(returnUrl)};const channelName=${scriptJson(OAUTH_CHANNEL)};const status=document.getElementById("status");let channel=null;let notified=false;
const notify=()=>{if(notified)return;notified=true;try{channel?.postMessage({type:"oauth-complete",connectionId})}catch{}try{window.opener?.postMessage({type:"oauth-complete",connectionId},location.origin)}catch{}};
const navigate=()=>{location.assign(returnUrl)};
const finish=()=>{notify();if(status)status.textContent="授权完成，正在返回 Server 管理…";try{window.opener?.focus()}catch{}try{window.close()}catch{}setTimeout(()=>{location.replace(returnUrl)},300)};
try{if(typeof BroadcastChannel==="function"){channel=new BroadcastChannel(channelName);channel.onmessage=(event)=>{if(event.data?.type==="oauth-ready"&&event.data.connectionId===connectionId)finish()}}}catch{}notify();document.getElementById("return")?.addEventListener("click",()=>{notify();navigate()});setTimeout(finish,1500)})();</script></body></html>`;
}

function oauthFailurePage(nonce: string): string {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>OAuth 授权失败</title><style nonce="${nonce}">${oauthPageStyles}</style></head><body><main class="oauth-status oauth-status--error"><div class="oauth-brand"><span class="oauth-brand__mark" aria-hidden="true">M</span><span><strong>MCP Inspector</strong><small>OAuth callback</small></span></div><span class="oauth-icon" aria-hidden="true">!</span><h1>OAuth 授权失败</h1><p>授权请求已失效或被取消，请返回 Inspector 后重新连接。</p></main><script nonce="${nonce}">try{const saved=localStorage.getItem("mcp-inspector-theme");document.documentElement.dataset.colorMode=saved==="dark"?"dark":"light"}catch{}try{history.replaceState(null,"","/oauth/callback")}catch{}</script></body></html>`;
}

export function createApp(deps: AppDependencies): Hono {
  const app = new Hono();
  const oauthReturnTickets = new Map<string, number>();

  const issueOAuthReturnTicket = (): string => {
    const now = Date.now();
    for (const [ticket, expiresAt] of oauthReturnTickets) {
      if (expiresAt <= now) oauthReturnTickets.delete(ticket);
    }
    const ticket = randomBytes(32).toString("base64url");
    oauthReturnTickets.set(ticket, now + OAUTH_RETURN_TICKET_TTL_MS);
    return ticket;
  };

  const consumeOAuthReturnTicket = (ticket: string): boolean => {
    const expiresAt = oauthReturnTickets.get(ticket);
    oauthReturnTickets.delete(ticket);
    return expiresAt !== undefined && expiresAt > Date.now();
  };

  app.get("/oauth/callback", async (context) => {
    if (deps.connections?.completeOAuth === undefined) return context.text("OAuth callback is unavailable", 404);
    try {
      const connectionId = await deps.connections.completeOAuth(new URL(context.req.url).searchParams);
      const nonce = randomBytes(18).toString("base64");
      const returnTicket = issueOAuthReturnTicket();
      const returnUrl = `/oauth/return?ticket=${encodeURIComponent(returnTicket)}`;
      return context.html(oauthSuccessPage(connectionId, returnUrl, nonce), 200, {
        "Cache-Control": "no-store", "Content-Security-Policy": `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; base-uri 'none'; frame-ancestors 'none'`,
        "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff",
      });
    } catch {
      const nonce = randomBytes(18).toString("base64");
      return context.html(oauthFailurePage(nonce), 400, {
        "Cache-Control": "no-store", "Content-Security-Policy": `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; base-uri 'none'; frame-ancestors 'none'`,
        "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff",
      });
    }
  });

  app.get("/oauth/return", (context) => {
    const ticket = context.req.query("ticket") ?? "";
    const responseHeaders = {
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    };
    if (!consumeOAuthReturnTicket(ticket)) {
      return context.text("OAuth return link is invalid or expired", 400, responseHeaders);
    }

    const allowedOrigin = typeof deps.allowedOrigin === "function"
      ? deps.allowedOrigin()
      : deps.allowedOrigin;
    const destination = new URL("/", allowedOrigin);
    destination.searchParams.set("session", deps.sessionToken);
    destination.hash = "servers";
    return context.body(null, 302, {
      ...responseHeaders,
      Location: destination.toString(),
    });
  });

  app.use(
    "/api/*",
    sessionAuth({
      allowedOrigin: deps.allowedOrigin,
      sessionToken: deps.sessionToken,
    }),
  );

  app.get("/api/health", (context) =>
    context.json({ ok: true, version: deps.version }),
  );

  if (deps.projects !== undefined) {
    let environment = deps.environment;
    const connections = deps.connections ?? createConnectionService(deps.projects, {
      resolveEnvironment: (projectId, connectionId) => {
        const resolved = environment?.resolve(projectId, connectionId);
        return resolved === undefined
          ? { project: {}, server: {} }
          : { project: resolved.project, server: resolved.server };
      },
    });
    app.route("/api/projects", createProjectRoutes(deps.projects));
    app.route("/api/projects", createConnectionRoutes(connections));
    const tools = deps.tools ?? createToolService(deps.projects, connections);
    app.route("/api/projects", createToolRoutes(tools));
    const workflows = deps.workflows ?? createWorkflowService(deps.projects, tools);
    environment ??= createEnvironmentService(deps.projects, connections);
    app.route("/api/projects", createWorkflowRoutes(workflows));
    app.route("/api/projects", createEnvironmentRoutes(environment));
    const tabs = deps.tabs ?? createTabService(deps.projects, connections, { tools });
    app.route("/api/projects", createTabRoutes(tabs));
    const runs = deps.runs ?? createRunService(deps.projects, connections, tabs);
    app.route("/api/projects", createRunRoutes(runs));
    app.route("/api/projects", createWorkflowDebugRoutes(
      deps.workflowDebug ?? createWorkflowDebugService({ connections, tools, environment, runs }),
    ));
    app.route("/api/projects", createWorkflowExecutionRoutes(
      deps.workflowExecutions ?? createWorkflowExecutionService({
        projects: deps.projects,
        connections,
        tabs,
        workflows,
        environment,
        runs,
      }),
    ));
    app.route("/api/projects", createSavedItemRoutes(
      deps.savedItems ?? createSavedItemService(deps.projects),
    ));
  }

  if (deps.staticRoot !== undefined) {
    app.get("*", async (context) => {
      if (isApiPath(context.req.path)) return context.json({ error: "Not found" }, 404);
      const accept = context.req.header("Accept") ?? "";
      const navigation = accept.includes("text/html") && extname(context.req.path) === "";
      const requestedPath = navigation || context.req.path === "/" ? "/index.html" : context.req.path;
      const file = safeStaticPath(deps.staticRoot!, requestedPath);
      if (file === null) return context.text("Not found", 404);
      try {
        const body = await readFile(file);
        return context.body(body, 200, {
          "Content-Type": contentTypes[extname(file).toLowerCase()] ?? "application/octet-stream",
          "X-Content-Type-Options": "nosniff",
        });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT" || (error as NodeJS.ErrnoException).code === "EISDIR") {
          return context.text("Not found", 404);
        }
        throw error;
      }
    });
  }

  app.notFound((context) => isApiPath(context.req.path)
    ? context.json({ error: "Not found" }, 404)
    : context.text("Not found", 404));

  return app;
}
