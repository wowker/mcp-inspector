import type {
  JsonSchemaType,
  JsonSchemaValidator,
  jsonSchemaValidator,
} from "@modelcontextprotocol/client";
import {
  Ajv,
  AjvJsonSchemaValidator,
  addFormats,
} from "@modelcontextprotocol/client/validators/ajv";
import { Ajv2020 } from "ajv/dist/2020.js";

function normalizedDialect(schema: JsonSchemaType): string | undefined {
  const declared = (schema as Record<string, unknown>).$schema;
  if (typeof declared !== "string") return undefined;
  return declared.trim().toLowerCase().replace(/#$/, "");
}

function dialectForWarning(dialect: string): string {
  const sanitized = dialect.replace(/[\u0000-\u001f\u007f-\u009f]/g, "?");
  const maxLength = 200;
  return sanitized.length <= maxLength
    ? sanitized
    : `${sanitized.slice(0, maxLength)}…`;
}

export class DialectAwareJsonSchemaValidator implements jsonSchemaValidator {
  private readonly draft2020: AjvJsonSchemaValidator;
  private readonly draft07: AjvJsonSchemaValidator;
  private readonly warn: (message: string) => void;

  constructor(options: { warn?: (message: string) => void } = {}) {
    const modern = new Ajv2020({ strict: false, validateSchema: false, allErrors: true });
    const legacy = new Ajv({ strict: false, validateSchema: false, allErrors: true });
    addFormats(modern);
    addFormats(legacy);
    this.draft2020 = new AjvJsonSchemaValidator(modern);
    this.draft07 = new AjvJsonSchemaValidator(legacy);
    this.warn = options.warn ?? ((message) => console.warn(message));
  }

  getValidator<T>(schema: JsonSchemaType): JsonSchemaValidator<T> {
    const dialect = normalizedDialect(schema);
    if (
      dialect === undefined ||
      dialect === "https://json-schema.org/draft/2020-12/schema"
    ) {
      return this.draft2020.getValidator<T>(schema);
    }
    if (
      dialect === "http://json-schema.org/draft-07/schema" ||
      dialect === "https://json-schema.org/draft-07/schema"
    ) {
      return this.draft07.getValidator<T>(schema);
    }
    this.warn(
      `Unsupported JSON Schema dialect '${dialectForWarning(dialect)}'; accepting without validation`,
    );
    return (input: unknown) => ({
      valid: true as const,
      data: input as T,
      errorMessage: undefined,
    });
  }
}
