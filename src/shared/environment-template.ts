export interface EnvironmentTemplateValues {
  project: Record<string, unknown>;
  server: Record<string, unknown>;
}

const variableNamePattern = /^[A-Za-z_][A-Za-z0-9_.-]{0,127}$/;
const templateTokenPattern = /\{\{([^{}]+)\}\}/g;

function scalarText(name: string, value: unknown): string {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  throw new Error(`Environment variable ${name} must be a scalar value`);
}

export function hasValidEnvironmentTemplateSyntax(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0) return false;
  if (!value.includes("{{") && !value.includes("}}")) return true;

  let remaining = value;
  for (const match of value.matchAll(templateTokenPattern)) {
    const name = match[1];
    if (name === undefined || !variableNamePattern.test(name)) return false;
    remaining = remaining.replace(match[0], "");
  }
  return !remaining.includes("{{") && !remaining.includes("}}");
}

export function resolveEnvironmentTemplate(
  template: string,
  environment: EnvironmentTemplateValues,
): string {
  if (!hasValidEnvironmentTemplateSyntax(template)) {
    throw new Error("Environment template is invalid");
  }
  if (!template.includes("{{")) return template;

  const values = { ...environment.project, ...environment.server };
  return template.replace(templateTokenPattern, (_token, name: string) => {
    if (!Object.prototype.hasOwnProperty.call(values, name)) {
      throw new Error(`Environment variable ${name} is unavailable`);
    }
    return scalarText(name, values[name]);
  });
}
