import {
  SCRIPT_SOURCE_MAX_BYTES,
  toolWorkflowUpdateSchema,
  type ToolWorkflow,
  type ToolWorkflowUpdate,
} from "../../shared/script-workflow.js";
import type { ProjectService } from "../projects/project-service.js";
import type { ToolService } from "../tools/tool-service.js";
import { WorkflowRepository } from "./workflow-repository.js";
import {
  ScriptExecutionError,
  createScriptRunner,
  type ScriptErrorCode,
  type ScriptRunner,
} from "./script-runner.js";

export class InvalidWorkflowError extends Error {
  constructor() { super("Tool workflow configuration is invalid"); this.name = "InvalidWorkflowError"; }
}

export class WorkflowRevisionConflictError extends Error {
  constructor() { super("Tool workflow revision is stale"); this.name = "WorkflowRevisionConflictError"; }
}

export interface WorkflowService {
  get(projectId: string, connectionId: string, toolName: string): ToolWorkflow;
  update(projectId: string, connectionId: string, toolName: string, input: unknown): ToolWorkflow;
  validate(projectId: string, connectionId: string, toolName: string, input: unknown): Promise<WorkflowValidationResult>;
}

export interface WorkflowValidationResult {
  valid: boolean;
  error: null | {
    code: ScriptErrorCode;
    message: string;
    phase: "before" | "after";
    line: number | null;
    column: number | null;
    excerpt: string | null;
  };
}

const validationInputSchema = z.object({
  phase: z.enum(["before", "after"]),
  source: z.string().max(SCRIPT_SOURCE_MAX_BYTES),
  timeoutMs: z.number().int().min(100).max(60_000).default(5_000),
}).strict();

export function createWorkflowService(
  projects: ProjectService,
  tools: Pick<ToolService, "get">,
  options: { now?: () => Date; scriptRunner?: ScriptRunner } = {},
): WorkflowService {
  const now = options.now ?? (() => new Date());
  const scriptRunner = options.scriptRunner ?? createScriptRunner();

  function repository(projectId: string, connectionId: string, toolName: string): WorkflowRepository {
    tools.get(projectId, connectionId, toolName);
    return new WorkflowRepository(projects.open(projectId));
  }

  function parseUpdate(input: unknown): ToolWorkflowUpdate {
    const parsed = toolWorkflowUpdateSchema.safeParse(input);
    if (!parsed.success ||
        Buffer.byteLength(parsed.data.before.source, "utf8") > SCRIPT_SOURCE_MAX_BYTES ||
        Buffer.byteLength(parsed.data.after.source, "utf8") > SCRIPT_SOURCE_MAX_BYTES) {
      throw new InvalidWorkflowError();
    }
    return parsed.data;
  }

  return {
    get(projectId, connectionId, toolName) {
      return repository(projectId, connectionId, toolName).getOrCreate(
        projectId,
        connectionId,
        toolName,
        now().toISOString(),
      );
    },

    update(projectId, connectionId, toolName, input) {
      const update = parseUpdate(input);
      const repo = repository(projectId, connectionId, toolName);
      repo.getOrCreate(projectId, connectionId, toolName, now().toISOString());
      const updated = repo.update(
        projectId,
        connectionId,
        toolName,
        update.revision,
        update,
        now().toISOString(),
      );
      if (updated === null) throw new WorkflowRevisionConflictError();
      return updated;
    },

    async validate(projectId, connectionId, toolName, input) {
      repository(projectId, connectionId, toolName);
      const parsed = validationInputSchema.safeParse(input);
      if (!parsed.success || parsed.data.source.trim() === "" ||
          Buffer.byteLength(parsed.data.source, "utf8") > SCRIPT_SOURCE_MAX_BYTES) {
        throw new InvalidWorkflowError();
      }
      try {
        await scriptRunner.run({
          evaluationId: randomUUID(),
          phase: parsed.data.phase,
          source: parsed.data.source,
          arguments: {},
          response: null,
          variables: {},
          environment: {},
          limits: { timeoutMs: parsed.data.timeoutMs },
          validateOnly: true,
        });
        return { valid: true, error: null };
      } catch (error) {
        if (!(error instanceof ScriptExecutionError)) throw error;
        return {
          valid: false,
          error: {
            code: error.code,
            message: error.message,
            phase: error.phase,
            line: error.line,
            column: error.column,
            excerpt: error.excerpt,
          },
        };
      }
    },
  };
}
import { randomUUID } from "node:crypto";
import { z } from "zod";
