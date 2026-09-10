#!/usr/bin/env node

import { runInspectorCli } from "../dist/server/main.js";

process.exitCode = await runInspectorCli({
  argv: process.argv.slice(2),
  env: process.env,
});
