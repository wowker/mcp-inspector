import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import {
  createSavedTestSuiteReportRequestSchema,
  savedTestSuiteReportPageSchema,
  updateSavedTestSuiteReportRequestSchema,
  type SavedTestSuiteReport,
  type SavedTestSuiteReportPage,
} from "../../shared/testing/test-suite-report.js";
import type { ProjectService } from "../projects/project-service.js";
import { canonicalJson } from "../tools/tool-service.js";
import {
  SavedTestSuiteReportRepository,
  SavedTestSuiteReportVersionConflictError,
  type SavedTestSuiteReportCursorPosition,
} from "./saved-test-suite-report-repository.js";
import { TestSuiteExecutionRepository } from "./test-suite-execution-repository.js";

const terminalStatuses = new Set(["PASSED", "FAILED", "ERROR", "CANCELLED", "INTERRUPTED"]);

export class InvalidSavedTestSuiteReportError extends Error {
  constructor() { super("Saved test suite report request is invalid"); this.name = "InvalidSavedTestSuiteReportError"; }
}
export class SavedTestSuiteReportNotFoundError extends Error {
  constructor() { super("Saved test suite report not found"); this.name = "SavedTestSuiteReportNotFoundError"; }
}
export class SavedTestSuiteReportConflictError extends Error {
  constructor() { super("Saved test suite report version already exists"); this.name = "SavedTestSuiteReportConflictError"; }
}
export class SavedTestSuiteReportIdempotencyConflictError extends Error {
  constructor() { super("Saved test suite report idempotency key was reused"); this.name = "SavedTestSuiteReportIdempotencyConflictError"; }
}
export class SavedTestSuiteReportRevisionConflictError extends Error {
  constructor() { super("Saved test suite report revision conflict"); this.name = "SavedTestSuiteReportRevisionConflictError"; }
}
export class SavedTestSuiteReportExecutionNotTerminalError extends Error {
  constructor() { super("Test suite execution is not terminal"); this.name = "SavedTestSuiteReportExecutionNotTerminalError"; }
}

export interface SavedTestSuiteReportService {
  create(projectId: string, idempotencyKey: string, input: unknown): SavedTestSuiteReport;
  list(projectId: string, input?: { suiteId?: string; cursor?: string; limit?: number }): SavedTestSuiteReportPage;
  get(projectId: string, reportId: string): SavedTestSuiteReport;
  update(projectId: string, reportId: string, input: unknown): SavedTestSuiteReport;
  remove(projectId: string, reportId: string): void;
}

function normalizeVersionLabel(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("en-US");
}

export function createSavedTestSuiteReportService(options: {
  projects: ProjectService;
  createId?: () => string;
  now?: () => Date;
}): SavedTestSuiteReportService {
  const createId = options.createId ?? randomUUID;
  const now = options.now ?? (() => new Date());
  const repository = (projectId: string) => new SavedTestSuiteReportRepository(options.projects.open(projectId));
  const executionRepository = (projectId: string) => new TestSuiteExecutionRepository(options.projects.open(projectId));
  const timestamp = () => now().toISOString();

  const get = (projectId: string, reportId: string): SavedTestSuiteReport => {
    if (!z.uuid().safeParse(projectId).success || !z.uuid().safeParse(reportId).success) {
      throw new SavedTestSuiteReportNotFoundError();
    }
    const report = repository(projectId).get(projectId, reportId);
    if (report === null) throw new SavedTestSuiteReportNotFoundError();
    return report;
  };

  const decodeCursor = (value: string | undefined, projectId: string,
    suiteId: string | undefined): SavedTestSuiteReportCursorPosition | null => {
    if (value === undefined) return null;
    try {
      const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as {
        projectId?: unknown; suiteId?: unknown; createdAt?: unknown; id?: unknown;
      };
      if (parsed.projectId !== projectId || parsed.suiteId !== suiteId || typeof parsed.createdAt !== "string" ||
          !z.string().datetime({ offset: true }).safeParse(parsed.createdAt).success ||
          typeof parsed.id !== "string" || !z.uuid().safeParse(parsed.id).success) throw new Error();
      return { createdAt: parsed.createdAt, id: parsed.id };
    } catch { throw new InvalidSavedTestSuiteReportError(); }
  };

  const encodeCursor = (projectId: string, suiteId: string | undefined,
    position: SavedTestSuiteReportCursorPosition): string =>
    Buffer.from(JSON.stringify({ projectId, ...(suiteId === undefined ? {} : { suiteId }), ...position }), "utf8")
      .toString("base64url");

  return {
    create(rawProjectId, idempotencyKey, rawInput) {
      const projectId = z.uuid().safeParse(rawProjectId);
      const input = createSavedTestSuiteReportRequestSchema.safeParse(rawInput);
      if (!projectId.success || !input.success || idempotencyKey.length < 1 || idempotencyKey.length > 200) {
        throw new InvalidSavedTestSuiteReportError();
      }
      const execution = executionRepository(projectId.data).get(projectId.data, input.data.suiteExecutionId);
      if (execution === null || execution.suiteId !== input.data.suiteId) throw new SavedTestSuiteReportNotFoundError();
      if (!terminalStatuses.has(execution.status)) throw new SavedTestSuiteReportExecutionNotTerminalError();
      const normalized = {
        ...input.data,
        note: input.data.note ?? null,
        normalizedVersionLabel: normalizeVersionLabel(input.data.versionLabel),
      };
      const requestHash = createHash("sha256").update(canonicalJson(normalized)).digest("hex");
      const id = createId();
      if (!z.uuid().safeParse(id).success) throw new Error("Saved test suite report ID generator returned an invalid UUID");
      try {
        const result = repository(projectId.data).create({
          id,
          projectId: projectId.data,
          suiteId: normalized.suiteId,
          suiteExecutionId: normalized.suiteExecutionId,
          name: normalized.name,
          versionLabel: normalized.versionLabel,
          normalizedVersionLabel: normalized.normalizedVersionLabel,
          note: normalized.note,
          idempotencyKey,
          requestHash,
          createdAt: timestamp(),
        });
        if (result.requestHash !== requestHash) throw new SavedTestSuiteReportIdempotencyConflictError();
        return result.report;
      } catch (error) {
        if (error instanceof SavedTestSuiteReportVersionConflictError) throw new SavedTestSuiteReportConflictError();
        throw error;
      }
    },
    list(rawProjectId, rawInput = {}) {
      const parsed = z.object({
        projectId: z.uuid(),
        suiteId: z.uuid().optional(),
        cursor: z.string().min(1).optional(),
        limit: z.number().int().min(1).max(100).default(50),
      }).strict().safeParse({ projectId: rawProjectId, ...rawInput });
      if (!parsed.success) throw new InvalidSavedTestSuiteReportError();
      const page = repository(parsed.data.projectId).list(
        parsed.data.projectId,
        parsed.data.suiteId,
        parsed.data.limit,
        decodeCursor(parsed.data.cursor, parsed.data.projectId, parsed.data.suiteId),
      );
      return savedTestSuiteReportPageSchema.parse({
        items: page.items,
        nextCursor: page.next === null
          ? null
          : encodeCursor(parsed.data.projectId, parsed.data.suiteId, page.next),
      });
    },
    get,
    update(projectId, reportId, rawInput) {
      const input = updateSavedTestSuiteReportRequestSchema.safeParse(rawInput);
      if (!input.success) throw new InvalidSavedTestSuiteReportError();
      const current = get(projectId, reportId);
      const versionLabel = input.data.versionLabel ?? current.versionLabel;
      const updated = repository(projectId).update(projectId, reportId, {
        revision: input.data.revision,
        name: input.data.name ?? current.name,
        versionLabel,
        normalizedVersionLabel: normalizeVersionLabel(versionLabel),
        note: input.data.note === undefined ? current.note : input.data.note,
        updatedAt: timestamp(),
      });
      if (updated === null) throw new SavedTestSuiteReportNotFoundError();
      if (updated === "REVISION_CONFLICT") throw new SavedTestSuiteReportRevisionConflictError();
      if (updated === "VERSION_CONFLICT") throw new SavedTestSuiteReportConflictError();
      return updated;
    },
    remove(projectId, reportId) {
      get(projectId, reportId);
      if (!repository(projectId).remove(projectId, reportId)) throw new SavedTestSuiteReportNotFoundError();
    },
  };
}
