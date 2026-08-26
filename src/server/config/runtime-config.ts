import { randomBytes } from "node:crypto";

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
  const port = overrides.port ?? 3000;

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
    version: overrides.version ?? "0.1.0",
  };
}
