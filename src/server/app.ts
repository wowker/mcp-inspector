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

function oauthSuccessPage(connectionId: string, nonce: string): string {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>OAuth 授权成功</title>
<style nonce="${nonce}">:root{color-scheme:light dark;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}body{min-height:100vh;margin:0;display:grid;place-items:center;background:#f6f8fa;color:#1f2328}main{width:min(440px,calc(100% - 40px));padding:32px;border:1px solid #d1d9e0;border-radius:12px;background:#fff;box-shadow:0 16px 40px rgb(31 35 40 / 12%)}i{display:grid;width:40px;height:40px;place-items:center;border-radius:50%;background:#dafbe1;color:#1a7f37;font-style:normal;font-weight:800}h1{margin:18px 0 8px;font-size:22px}p{margin:0 0 22px;color:#59636e;line-height:1.6}button{min-height:38px;padding:7px 14px;border:0;border-radius:6px;background:#6842d9;color:#fff;font:inherit;font-weight:650;cursor:pointer}@media(prefers-color-scheme:dark){body{background:#0d1117;color:#f0f6fc}main{border-color:#30363d;background:#161b22}p{color:#8b949e}}</style></head>
<body><main><i aria-hidden="true">✓</i><h1>授权成功</h1><p id="status">正在返回 Tool 列表…</p><button id="return" type="button">返回 Tool 列表</button></main>
<script nonce="${nonce}">(()=>{const connectionId=${scriptJson(connectionId)};const channelName=${scriptJson(OAUTH_CHANNEL)};const status=document.getElementById("status");let channel=null;let closed=false;
const finish=()=>{if(closed)return;closed=true;if(status)status.textContent="Tool 列表已在 Inspector 中打开。";try{window.close()}catch{}setTimeout(()=>{if(status)status.textContent="授权已完成，请返回 DSers MCP Inspector 的 Tool 列表。"},400)};
try{if(typeof BroadcastChannel==="function"){channel=new BroadcastChannel(channelName);channel.onmessage=(event)=>{if(event.data?.type==="oauth-ready"&&event.data.connectionId===connectionId)finish()};channel.postMessage({type:"oauth-complete",connectionId})}}catch{}
try{window.opener?.postMessage({type:"oauth-complete",connectionId},location.origin)}catch{}
document.getElementById("return")?.addEventListener("click",finish);setTimeout(finish,1500)})();</script></body></html>`;
}

export function createApp(deps: AppDependencies): Hono {
  const app = new Hono();

  app.get("/oauth/callback", async (context) => {
    if (deps.connections?.completeOAuth === undefined) return context.text("OAuth callback is unavailable", 404);
    try {
      const connectionId = await deps.connections.completeOAuth(new URL(context.req.url).searchParams);
      const nonce = randomBytes(18).toString("base64");
      return context.html(oauthSuccessPage(connectionId, nonce), 200, {
        "Cache-Control": "no-store", "Content-Security-Policy": `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; base-uri 'none'; frame-ancestors 'none'`,
        "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff",
      });
    } catch {
      return context.html("<!doctype html><meta charset=utf-8><title>授权失败</title><main><h1>授权失败</h1><p>授权请求已失效，请返回 Inspector 后重新连接。</p></main>", 400, {
        "Cache-Control": "no-store", "Content-Security-Policy": "default-src 'none'",
        "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff",
      });
    }
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
    const connections = deps.connections ?? createConnectionService(deps.projects);
    app.route("/api/projects", createProjectRoutes(deps.projects));
    app.route("/api/projects", createConnectionRoutes(connections));
    const tools = deps.tools ?? createToolService(deps.projects, connections);
    app.route("/api/projects", createToolRoutes(tools));
    const tabs = deps.tabs ?? createTabService(deps.projects, connections, { tools });
    app.route("/api/projects", createTabRoutes(tabs));
    app.route("/api/projects", createRunRoutes(
      deps.runs ?? createRunService(deps.projects, connections, tabs),
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
