import type { ProjectService } from "../projects/project-service.js";

export interface ValidationMutableSource {
  kind: "DRAFT" | "TEST_CASE" | "TEST_SUITE";
  id: string;
}

export interface ValidationSourceGuard {
  assertMutable(projectId: string, source: ValidationMutableSource): void;
}

export class ValidationSourceActiveError extends Error {
  readonly code = "VALIDATION_SOURCE_ACTIVE";

  constructor() {
    super("Validation source is frozen by an active session");
    this.name = "ValidationSourceActiveError";
  }
}

export function createValidationSourceGuard(options: {
  projects: ProjectService;
  beforeAccess?: (projectId: string) => void;
}): ValidationSourceGuard {
  return {
    assertMutable(projectId, source) {
      options.beforeAccess?.(projectId);
      const active = options.projects.open(projectId).database.prepare(`SELECT 1 FROM validation_sessions
        WHERE project_id = ? AND source_kind = ? AND source_id = ?
          AND phase IN ('READY', 'RUNNING', 'EVALUATING')`).get(projectId, source.kind, source.id);
      if (active !== undefined) throw new ValidationSourceActiveError();
    },
  };
}
