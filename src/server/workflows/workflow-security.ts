import type { JsonValue } from "../../shared/tool-definition.js";
import type { ConnectionService } from "../connections/connection-service.js";
import type { ConnectionRecord } from "../connections/connection-types.js";

interface ResolvedEnvironment {
  project: Record<string, JsonValue>;
  server: Record<string, JsonValue>;
  secretNames: string[];
}

function addSecretTokens(value: JsonValue, tokens: Set<string>): void {
  if (value === null) return;
  const serialized = typeof value === "string" ? value : JSON.stringify(value);
  if (serialized.length > 0) tokens.add(serialized);
  if (Array.isArray(value)) {
    for (const item of value) addSecretTokens(item, tokens);
  } else if (typeof value === "object") {
    for (const item of Object.values(value)) addSecretTokens(item, tokens);
  }
}

export function collectSecretTokens(environment: ResolvedEnvironment): string[] {
  const tokens = new Set<string>();
  for (const name of environment.secretNames) {
    const value = Object.hasOwn(environment.server, name)
      ? environment.server[name]
      : environment.project[name];
    if (value !== undefined) addSecretTokens(value, tokens);
  }
  return [...tokens].sort((left, right) => right.length - left.length);
}

export function redactWorkflowText(value: string, secrets: string[]): string {
  return secrets.reduce((text, secret) => text.replaceAll(secret, "[REDACTED]"), value);
}

export function redactWorkflowJson(value: JsonValue, secrets: string[]): JsonValue {
  if (typeof value === "string") return redactWorkflowText(value, secrets);
  if (Array.isArray(value)) return value.map((item) => redactWorkflowJson(item, secrets));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value)
      .map(([key, item]) => [key, redactWorkflowJson(item, secrets)]));
  }
  return secrets.includes(JSON.stringify(value)) ? "[REDACTED]" : value;
}

export function containsWorkflowSecret(value: JsonValue, secrets: string[]): boolean {
  if (secrets.length === 0) return false;
  const serialized = JSON.stringify(value);
  return secrets.some((secret) => serialized.includes(secret));
}

export function resolveHelperConnection(
  connections: ConnectionService,
  projectId: string,
  currentConnectionId: string,
  selector: string,
): ConnectionRecord {
  if (selector === "current") return connections.get(projectId, currentConnectionId);
  const available = connections.list(projectId);
  const byId = available.find((connection) => connection.id === selector);
  if (byId !== undefined) return byId;
  const byName = available.filter((connection) => connection.name === selector);
  if (byName.length === 1) return byName[0]!;
  if (byName.length > 1) throw new Error("Helper Server name is ambiguous");
  throw new Error("Helper Server is not available");
}
