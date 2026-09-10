import { Hono } from "hono";
import type { AuthoringAuthService } from "./authoring-auth-service.js";

export function createAuthoringSettingsRoutes(authoringAuth: AuthoringAuthService,
  endpoint: string | (() => string) = "/mcp/authoring"): Hono {
  const routes = new Hono();
  const currentEndpoint = () => typeof endpoint === "function" ? endpoint() : endpoint;
  routes.use("*", async (context, next) => {
    await next();
    context.header("Cache-Control", "no-store");
  });
  routes.get("/", (context) => context.json({ settings: authoringAuth.getStatus(), endpoint: currentEndpoint() }));
  routes.post("/enable", async (context) => {
    const issued = await authoringAuth.enable();
    return context.json({ settings: issued.status, token: issued.token, endpoint: currentEndpoint() });
  });
  routes.post("/token", async (context) => {
    const issued = await authoringAuth.rotate();
    return context.json({ settings: issued.status, token: issued.token, endpoint: currentEndpoint() });
  });
  routes.post("/disable", (context) =>
    context.json({ settings: authoringAuth.disable(), endpoint: currentEndpoint() }));
  return routes;
}
