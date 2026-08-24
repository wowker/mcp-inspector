#!/usr/bin/env node

import { startInspector } from "../dist/server/main.js";

try {
  const runtime = await startInspector();
  console.info(`DSers MCP Inspector listening on ${runtime.address.origin}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : "Unable to start DSers MCP Inspector");
  process.exitCode = 1;
}
