import { serve } from "@hono/node-server";
import open from "open";
import { createApp } from "./app.js";
import { createRuntimeConfig } from "./config/runtime-config.js";

const config = createRuntimeConfig();
const app = createApp(config);

serve(
  {
    fetch: app.fetch,
    hostname: config.host,
    port: config.port,
  },
  (info) => {
    const url = new URL(config.allowedOrigin);
    url.searchParams.set("session", config.sessionToken);
    console.info(`DSers MCP Inspector listening on ${config.allowedOrigin}`);
    void open(url.toString());
  },
);
