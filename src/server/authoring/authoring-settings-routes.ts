import { Hono } from "hono";
import type { AuthoringAuthService } from "./authoring-auth-service.js";

export function createAuthoringSettingsRoutes(authoringAuth: AuthoringAuthService): Hono {
  const routes = new Hono();
  routes.use("*", async (context, next) => {
    await next();
    context.header("Cache-Control", "no-store");
  });
  routes.get("/", (context) => context.json({ settings: authoringAuth.getStatus() }));
  routes.post("/enable", async (context) => {
    const issued = await authoringAuth.enable();
    return context.json({ settings: issued.status, token: issued.token });
  });
  routes.post("/token", async (context) => {
    const issued = await authoringAuth.rotate();
    return context.json({ settings: issued.status, token: issued.token });
  });
  routes.post("/disable", (context) =>
    context.json({ settings: authoringAuth.disable() }));
  return routes;
}
