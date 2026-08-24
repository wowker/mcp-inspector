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
import { resolveSchemaDialect } from "../../shared/schema-dialect.js";

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
    const resolution = resolveSchemaDialect(schema as Record<string, unknown>);
    if (resolution.dialect === "draft-2020-12") {
      return this.draft2020.getValidator<T>(schema);
    }
    if (resolution.dialect === "draft-07") {
      return this.draft07.getValidator<T>(schema);
    }
    this.warn(
      `${resolution.warning ?? "Unsupported JSON Schema dialect"}; accepting without validation`,
    );
    return (input: unknown) => ({
      valid: true as const,
      data: input as T,
      errorMessage: undefined,
    });
  }
}
