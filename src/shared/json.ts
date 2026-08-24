export type JsonObject = Record<string, unknown>;

export type RawArgumentsResult =
  | { ok: true; value: JsonObject }
  | { ok: false; message: string; offset: number | null };

export function parseRawArguments(text: string): RawArgumentsResult {
  try {
    const value: unknown = JSON.parse(text);
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return { ok: false, message: "Arguments must be a JSON object", offset: null };
    }
    return { ok: true, value: value as JsonObject };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid JSON";
    const match = /position\s+(\d+)/i.exec(message);
    const token = /Unexpected token ['"](.{1})['"]/i.exec(message);
    const inferred = token === null ? -1 : text.indexOf(token[1]);
    return { ok: false, message, offset: match !== null ? Number(match[1]) : inferred >= 0 ? inferred : null };
  }
}

export function formatRawArguments(value: JsonObject): string {
  return JSON.stringify(value, null, 2);
}
