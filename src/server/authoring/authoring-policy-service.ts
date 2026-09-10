import {
  defaultConnectionAuthoringPolicy,
  replaceAuthoringPolicyInputSchema,
  type ConnectionAuthoringPolicy,
  type ReplaceAuthoringPolicyInput,
} from "../../shared/authoring/policy.js";
import type { ProjectService } from "../projects/project-service.js";
import { AuthoringPolicyRepository } from "./authoring-policy-repository.js";

export class AuthoringConnectionNotFoundError extends Error {
  constructor() {
    super("Authoring connection not found");
    this.name = "AuthoringConnectionNotFoundError";
  }
}

export class AuthoringPolicyRevisionConflictError extends Error {
  constructor() {
    super("Authoring policy revision conflict");
    this.name = "AuthoringPolicyRevisionConflictError";
  }
}

export interface AuthoringPolicyService {
  get(projectId: string, connectionId: string): ConnectionAuthoringPolicy;
  replace(projectId: string, connectionId: string, input: ReplaceAuthoringPolicyInput): ConnectionAuthoringPolicy;
  isToolAllowed(projectId: string, connectionId: string, toolName: string): boolean;
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

export function createAuthoringPolicyService(options: {
  projects: ProjectService;
  now?: () => Date;
}): AuthoringPolicyService {
  const now = options.now ?? (() => new Date());

  function context(projectId: string, connectionId: string) {
    const store = options.projects.open(projectId);
    const exists = store.database.prepare(
      "SELECT 1 FROM connections WHERE project_id = ? AND id = ?",
    ).get(projectId, connectionId);
    if (exists === undefined) throw new AuthoringConnectionNotFoundError();
    return { repository: new AuthoringPolicyRepository(store) };
  }

  function getPolicy(projectId: string, connectionId: string): ConnectionAuthoringPolicy {
    const { repository } = context(projectId, connectionId);
    return repository.find(projectId, connectionId)
      ?? defaultConnectionAuthoringPolicy(projectId, connectionId);
  }

  return {
    get: getPolicy,
    replace(projectId, connectionId, input) {
      const parsed = replaceAuthoringPolicyInputSchema.parse(input);
      const { repository } = context(projectId, connectionId);
      const saved = repository.replace({
        projectId,
        connectionId,
        expectedRevision: parsed.expectedRevision,
        timestamp: now().toISOString(),
        policy: {
          mode: parsed.mode,
          allowedTools: uniqueSorted(parsed.allowedTools),
          deniedTools: uniqueSorted(parsed.deniedTools),
          requireCleanupForDraftMutations: parsed.requireCleanupForDraftMutations,
          maxCallsPerMinute: parsed.maxCallsPerMinute,
          maxConcurrentCalls: parsed.maxConcurrentCalls,
          maxCallDurationMs: parsed.maxCallDurationMs,
        },
      });
      if (saved === null) throw new AuthoringPolicyRevisionConflictError();
      return saved;
    },
    isToolAllowed(projectId, connectionId, toolName) {
      const policy = getPolicy(projectId, connectionId);
      if (policy.mode === "FULL_ACCESS") return true;
      if (policy.mode === "DISABLED" || policy.deniedTools.includes(toolName)) return false;
      return policy.allowedTools.includes(toolName);
    },
  };
}
