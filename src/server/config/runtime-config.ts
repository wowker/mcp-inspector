import { randomBytes } from "node:crypto";
import { APP_VERSION } from "./app-version.js";

export interface RuntimeConfig {
  host: "127.0.0.1";
  port: number;
  allowedOrigin: string;
  sessionToken: string;
  version: string;
}

export type RuntimeConfigOverrides = Partial<Omit<RuntimeConfig, "host">> & {
  host?: "127.0.0.1";
};

export function createRuntimeConfig(
  overrides: RuntimeConfigOverrides = {},
): RuntimeConfig {
  const host = overrides.host ?? "127.0.0.1";
  // Port 0 asks the operating system to atomically select an available
  // ephemeral port when the listener is created.
  const port = overrides.port ?? 0;

  if (host !== "127.0.0.1") {
    throw new Error("MCP Inspector must bind to the IPv4 loopback address");
  }

  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new RangeError("port must be an integer between 0 and 65535");
  }

  return {
    host,
    port,
    allowedOrigin: overrides.allowedOrigin ?? "http://127.0.0.1:5173",
    sessionToken: overrides.sessionToken ?? randomBytes(32).toString("base64url"),
    version: overrides.version ?? APP_VERSION,
  };
}
