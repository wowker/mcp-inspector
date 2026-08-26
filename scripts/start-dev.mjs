import { spawn } from "node:child_process";
import { createServer } from "node:net";

const host = "127.0.0.1";

async function reserveAvailablePort() {
  const probe = createServer();
  await new Promise((resolve, reject) => {
    probe.once("error", reject);
    probe.listen(0, host, resolve);
  });
  const address = probe.address();
  if (address === null || typeof address === "string") {
    probe.close();
    throw new Error("Unable to allocate an Inspector development port");
  }
  await new Promise((resolve, reject) => {
    probe.close((error) => error === undefined ? resolve() : reject(error));
  });
  return address.port;
}

const port = await reserveAvailablePort();
const env = {
  ...process.env,
  MCP_INSPECTOR_PORT: String(port),
  MCP_INSPECTOR_API_ORIGIN: `http://${host}:${port}`,
};
const commands = ["dev:server", "dev:client"];
const children = commands.map((command) => spawn("npm", ["run", command], {
  env,
  stdio: "inherit",
}));
let stopping = false;

function stopChildren(signal = "SIGTERM") {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null) child.kill(signal);
  }
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => stopChildren(signal));
}

const exits = children.map((child) => new Promise((resolve) => {
  child.once("error", (error) => resolve({ code: 1, error }));
  child.once("exit", (code, signal) => resolve({ code, signal }));
}));
const first = await Promise.race(exits);
stopChildren();
await Promise.all(exits);
if ("error" in first) console.error(first.error.message);
process.exitCode = first.code === 0 ? 0 : 1;
