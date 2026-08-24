export type SchemaDialect = "draft-2020-12" | "draft-07" | "unknown";

export interface DialectResolution {
  dialect: SchemaDialect;
  declared: string | null;
  warning: string | null;
}

export function normalizeSchemaDialect(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return value.trim().toLowerCase().replace(/#$/, "");
}

export function safeDialectLabel(value: string): string {
  const clean = value.replace(/[\u0000-\u001f\u007f-\u009f]/g, "?");
  return clean.length <= 200 ? clean : `${clean.slice(0, 200)}…`;
}

export function resolveSchemaDialect(schema: Record<string, unknown>): DialectResolution {
  const declared = normalizeSchemaDialect(schema.$schema);
  if (declared === null || declared === "https://json-schema.org/draft/2020-12/schema") {
    return { dialect: "draft-2020-12", declared, warning: null };
  }
  if (declared === "http://json-schema.org/draft-07/schema" || declared === "https://json-schema.org/draft-07/schema") {
    return { dialect: "draft-07", declared, warning: null };
  }
  return { dialect: "unknown", declared, warning: `未知 JSON Schema 方言：${safeDialectLabel(declared)}` };
}
