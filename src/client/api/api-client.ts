import { parseToolDefinition, type ToolDefinition } from "../../shared/tool-definition.js";
import {
  runDetailSchema,
  replayPreflightSchema,
  runSummarySchema,
  type ReplayPreflight,
  type ReplayRequest,
  type RunDetail as SharedRunDetail,
  type RunEvent as SharedRunEvent,
  type RunHistoryFilter,
  type RunStatus as SharedRunStatus,
  type RunSummary as SharedRunSummary,
} from "../../shared/run-replay.js";
import { normalizeCustomHeaders } from "../../shared/custom-headers.js";
import { isValidBearerTokenConfiguration, type ConnectionAuthMode } from "../../shared/connection-auth.js";
import {
  parseToolWorkflow,
  type ToolWorkflow,
  type ToolWorkflowUpdate,
  parseEnvironmentVariable,
  type EnvironmentVariable,
  parseWorkflowExecutionDetail,
  workflowValidationResultSchema,
  workflowDebugResultSchema,
  type WorkflowDebugInput,
  type WorkflowDebugResult,
  type WorkflowExecutionDetail,
  type WorkflowValidationResult,
} from "../../shared/script-workflow.js";
import {
  parseTestCaseDefinition,
  testCasePageSchema,
  type TestCaseDefinition,
  type TestCaseMutation,
  type TestCasePage,
  type UpdateTestCaseRequest,
} from "../../shared/testing/test-case.js";
import { testCaseCreationPreviewSchema, type TestCaseCreationPreview } from "../../shared/testing/creation-preview.js";
import {
  parseTestSuiteDefinition,
  testSuitePageSchema,
  type TestSuiteDefinition,
  type TestSuiteMutation,
  type TestSuitePage,
  type UpdateTestSuiteRequest,
} from "../../shared/testing/test-suite.js";
import {
  parseTestExecutionDetail,
  testExecutionReportPageSchema,
  updateTestExecutionBaselineResultSchema,
  type StartTestExecutionRequest,
  type TestExecutionDetail,
  type TestExecutionReportPage,
  type UpdateTestExecutionBaselineResult,
} from "../../shared/testing/test-execution.js";
import {
  parseTestSuiteExecutionDetail,
  type StartTestSuiteExecutionRequest,
  type TestSuiteExecutionDetail,
} from "../../shared/testing/test-suite-execution.js";
import {
  automatedTestsExportEnvelopeSchema,
  importAutomatedTestsResultSchema,
  type AutomatedTestsExportEnvelope,
  type ImportAutomatedTestsResult,
} from "../../shared/testing/test-transfer.js";
import {
  comparisonRuleSetSchema,
  runComparisonSchema,
  type ComparisonRuleSet,
  type RunComparison,
} from "../../shared/run-comparison.js";
import {
  parseEnvironmentProfile,
  parseEnvironmentProfilePreview,
  parseEnvironmentProfileVariable,
  type EnvironmentProfile,
  type EnvironmentProfileMutation,
  type EnvironmentProfilePreview,
  type EnvironmentProfileUpdate,
  type EnvironmentProfileVariable,
  type EnvironmentProfileVariableMutation,
} from "../../shared/environment-profile.js";
import { parseServerExportEnvironment } from "../../shared/server-export.js";
import { decodeLargeRunDetail } from "./run-detail-decoder.js";

export type {
  EnvironmentVariable,
  ToolWorkflow,
  ToolWorkflowUpdate,
  WorkflowExecutionDetail,
  WorkflowValidationResult,
  WorkflowDebugInput,
  WorkflowDebugResult,
} from "../../shared/script-workflow.js";
export type {
  EnvironmentProfile,
  EnvironmentProfileMutation,
  EnvironmentProfilePreview,
  EnvironmentProfileUpdate,
  EnvironmentProfileVariable,
  EnvironmentProfileVariableMutation,
} from "../../shared/environment-profile.js";

export interface ProjectSummary {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  lastOpenedAt: string | null;
}

export interface ConnectionSummary {
  id: string;
  projectId: string;
  name: string;
  url: string;
  transport: "streamable-http";
  authMode: ConnectionAuthMode;
  bearerToken: string | null;
  headers: Record<string, string>;
  redactSensitiveInfo: boolean;
  authorizationStatus: "not-required" | "required" | "authorizing" | "authorized";
  timeoutMs: number;
  status: "disconnected" | "connecting" | "connected" | "failed";
  lastProtocolVersion: string | null;
  lastServerInfo: Record<string, unknown> | null;
  lastError: { code: string; message: string } | null;
}

export interface CreateConnectionRequest {
  name: string;
  url: string;
  transport: "streamable-http";
  authMode: ConnectionAuthMode;
  bearerToken?: string | null;
  headers?: Record<string, string>;
  redactSensitiveInfo?: boolean;
  timeoutMs: number;
}

export type UpdateConnectionRequest = Partial<Pick<CreateConnectionRequest,
  "name" | "url" | "authMode" | "bearerToken" | "headers" | "redactSensitiveInfo" | "timeoutMs">>;

export interface ToolSnapshotSummary {
  id: string;
  projectId: string;
  connectionId: string;
  toolName: string;
  contentHash: string;
  definition: ToolDefinition;
  createdAt: string;
}

export interface CatalogToolSummary {
  projectId: string;
  connectionId: string;
  name: string;
  status: "current" | "changed" | "removed";
  folderId: string | null;
  favorite: boolean;
  lastUsedAt: string | null;
  updatedAt: string;
  currentSnapshot: ToolSnapshotSummary;
}

export interface ToolFolderSummary {
  id: string;
  projectId: string;
  connectionId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface ToolDetailSummary {
  tool: CatalogToolSummary;
  snapshots: ToolSnapshotSummary[];
}

export interface DebugTabSummary {
  id: string;
  projectId: string;
  connectionId: string;
  toolName: string;
  title: string;
  position: number;
  pinned: boolean;
  inputMode: "form" | "raw";
  arguments: Record<string, unknown>;
  rawText: string;
  viewState: {
    editorScrollTop: number;
    resultScrollTop: number;
    splitRatio: number;
    requestExpanded?: boolean;
    responseExpanded?: boolean;
  };
  lastRunId: string | null;
}

export type RunStatus = SharedRunStatus;
export type RunEvent = SharedRunEvent;
export type RunSummary = SharedRunSummary;
export type RunDetail = SharedRunDetail;
export interface RunPage { runs: RunSummary[]; nextCursor: string | null }
export type RunListFilter = RunHistoryFilter;

export type SavedItemKind = "request" | "response";
export interface SavedItemSummary {
  id: string; projectId: string; connectionId: string; toolName: string; kind: SavedItemKind;
  name: string; description: string; sourceRunId: string | null; createdAt: string; updatedAt: string;
}
export interface SavedItemDetail extends SavedItemSummary { payload: unknown }
export interface SavedItemPage { items: SavedItemSummary[]; nextCursor: string | null }
export interface CreateSavedItemRequest {
  kind: SavedItemKind; name: string; description: string; payload: unknown; sourceRunId: string | null;
}

export interface TestCaseListRequest {
  kind?: "tool" | "scenario";
  connectionId?: string;
  tag?: string;
  query?: string;
  cursor?: string;
  limit?: number;
}

export type UpdateDebugTabRequest = Partial<Pick<DebugTabSummary,
  "title" | "pinned" | "inputMode" | "arguments" | "rawText" | "viewState" | "lastRunId">>;

export interface InspectorApiClient {
  listProjects(): Promise<ProjectSummary[]>;
  createProject(name: string): Promise<ProjectSummary>;
  openProject(projectId: string): Promise<ProjectSummary>;
  listConnections(projectId: string): Promise<ConnectionSummary[]>;
  createConnection(projectId: string, input: CreateConnectionRequest): Promise<ConnectionSummary>;
  updateConnection(projectId: string, connectionId: string, input: UpdateConnectionRequest): Promise<ConnectionSummary>;
  exportConnection(projectId: string, connectionId: string): Promise<Blob>;
  deleteConnection(projectId: string, connectionId: string): Promise<void>;
  connectConnection(projectId: string, connectionId: string): Promise<ConnectionSummary>;
  disconnectConnection(projectId: string, connectionId: string): Promise<ConnectionSummary>;
  listTools(projectId: string, connectionId: string): Promise<CatalogToolSummary[]>;
  refreshTools(projectId: string, connectionId: string): Promise<CatalogToolSummary[]>;
  getTool(projectId: string, connectionId: string, toolName: string): Promise<ToolDetailSummary>;
  deleteTool(projectId: string, connectionId: string, toolName: string): Promise<void>;
  listToolFolders(projectId: string, connectionId: string): Promise<ToolFolderSummary[]>;
  createToolFolder(projectId: string, connectionId: string, name: string): Promise<ToolFolderSummary>;
  renameToolFolder(projectId: string, connectionId: string, folderId: string, name: string): Promise<ToolFolderSummary>;
  deleteToolFolder(projectId: string, connectionId: string, folderId: string): Promise<void>;
  moveToolToFolder(projectId: string, connectionId: string, toolName: string, folderId: string | null): Promise<CatalogToolSummary>;
  setToolFavorite(projectId: string, connectionId: string, toolName: string, favorite: boolean): Promise<CatalogToolSummary>;
  markToolUsed(projectId: string, connectionId: string, toolName: string): Promise<CatalogToolSummary>;
  getToolWorkflow(projectId: string, connectionId: string, toolName: string): Promise<ToolWorkflow>;
  updateToolWorkflow(projectId: string, connectionId: string, toolName: string, input: ToolWorkflowUpdate): Promise<ToolWorkflow>;
  validateToolWorkflow(projectId: string, connectionId: string, toolName: string,
    input: { phase: "before" | "after"; source: string }): Promise<WorkflowValidationResult>;
  debugToolWorkflow(projectId: string, connectionId: string, toolName: string,
    input: WorkflowDebugInput, signal?: AbortSignal): Promise<WorkflowDebugResult>;
  listEnvironmentVariables(projectId: string, connectionId: string | null): Promise<EnvironmentVariable[]>;
  setEnvironmentVariable(projectId: string, connectionId: string | null, name: string, input: { value: unknown; secret: boolean }): Promise<EnvironmentVariable>;
  deleteEnvironmentVariable(projectId: string, connectionId: string | null, name: string): Promise<void>;
  listEnvironmentProfiles(projectId: string): Promise<EnvironmentProfile[]>;
  createEnvironmentProfile(projectId: string, input: EnvironmentProfileMutation): Promise<EnvironmentProfile>;
  updateEnvironmentProfile(projectId: string, profileId: string, input: EnvironmentProfileUpdate): Promise<EnvironmentProfile>;
  deleteEnvironmentProfile(projectId: string, profileId: string): Promise<void>;
  listEnvironmentProfileVariables(projectId: string, profileId: string, connectionId: string | null): Promise<EnvironmentProfileVariable[]>;
  setEnvironmentProfileVariable(projectId: string, profileId: string, connectionId: string | null, name: string, input: EnvironmentProfileVariableMutation): Promise<EnvironmentProfileVariable>;
  deleteEnvironmentProfileVariable(projectId: string, profileId: string, connectionId: string | null, name: string): Promise<void>;
  getConnectionEnvironmentProfile(projectId: string, connectionId: string): Promise<{ profileId: string | null; preview: EnvironmentProfilePreview }>;
  setConnectionEnvironmentProfile(projectId: string, connectionId: string, profileId: string | null): Promise<{ profileId: string | null; preview: EnvironmentProfilePreview }>;
  previewConnectionEnvironmentProfile(projectId: string, connectionId: string, profileId: string | null): Promise<EnvironmentProfilePreview>;
  listTabs(projectId: string, connectionId: string): Promise<DebugTabSummary[]>;
  openTab(projectId: string, connectionId: string, toolName: string): Promise<DebugTabSummary>;
  replaceTabTool(projectId: string, tabId: string, connectionId: string, toolName: string): Promise<DebugTabSummary>;
  updateTab(projectId: string, tabId: string, patch: UpdateDebugTabRequest): Promise<DebugTabSummary>;
  duplicateTab(projectId: string, tabId: string): Promise<DebugTabSummary>;
  reorderTabs(projectId: string, connectionId: string, tabIds: string[]): Promise<DebugTabSummary[]>;
  closeTab(projectId: string, tabId: string): Promise<void>;
  closeOtherTabs(projectId: string, connectionId: string, tabId: string): Promise<DebugTabSummary[]>;
  closeTabsRight(projectId: string, connectionId: string, tabId: string): Promise<DebugTabSummary[]>;
  startRun(projectId: string, connectionId: string, tabId: string, idempotencyKey: string, args: Record<string, unknown>): Promise<RunSummary>;
  startWorkflowExecution(projectId: string, connectionId: string, tabId: string, idempotencyKey: string,
    args: Record<string, unknown>, allowDestructiveHelpers?: boolean): Promise<WorkflowExecutionDetail>;
  getActiveWorkflowExecution(projectId: string, tabId: string, signal?: AbortSignal): Promise<WorkflowExecutionDetail | null>;
  getWorkflowExecution(projectId: string, executionId: string, signal?: AbortSignal): Promise<WorkflowExecutionDetail>;
  cancelWorkflowExecution(projectId: string, executionId: string): Promise<void>;
  getRunSummary(projectId: string, runId: string, signal?: AbortSignal): Promise<RunSummary>;
  getRun(projectId: string, runId: string, signal?: AbortSignal): Promise<RunDetail>;
  listRuns(projectId: string, cursor?: string, filter?: RunListFilter): Promise<RunPage>;
  setRunPinned(projectId: string, runId: string, pinned: boolean): Promise<RunSummary>;
  getReplayPreflight(projectId: string, runId: string, signal?: AbortSignal): Promise<ReplayPreflight>;
  startReplay(projectId: string, runId: string, request: ReplayRequest): Promise<RunSummary>;
  listComparisonRules(projectId: string): Promise<ComparisonRuleSet>;
  replaceComparisonRules(projectId: string, expressions: string[]): Promise<ComparisonRuleSet>;
  getRunComparison(projectId: string, replayRunId: string, expressions?: string[], signal?: AbortSignal): Promise<RunComparison>;
  openRunEventStream(projectId: string, runId: string, after: number, signal: AbortSignal): Promise<Response>;
  listSavedItems(projectId: string, connectionId: string, toolName: string, cursor?: string): Promise<SavedItemPage>;
  getSavedItem(projectId: string, connectionId: string, toolName: string, itemId: string): Promise<SavedItemDetail>;
  createSavedItem(projectId: string, connectionId: string, toolName: string, input: CreateSavedItemRequest): Promise<SavedItemDetail>;
  deleteSavedItem(projectId: string, connectionId: string, toolName: string, itemId: string): Promise<void>;
  listTestCases(projectId: string, input?: TestCaseListRequest): Promise<TestCasePage>;
  getTestCase(projectId: string, testCaseId: string): Promise<TestCaseDefinition>;
  createTestCase(projectId: string, input: TestCaseMutation): Promise<TestCaseDefinition>;
  updateTestCase(projectId: string, testCaseId: string, input: UpdateTestCaseRequest): Promise<TestCaseDefinition>;
  deleteTestCase(projectId: string, testCaseId: string): Promise<void>;
  listTestSuites(projectId: string): Promise<TestSuitePage>;
  getTestSuite(projectId: string, suiteId: string): Promise<TestSuiteDefinition>;
  createTestSuite(projectId: string, input: TestSuiteMutation): Promise<TestSuiteDefinition>;
  updateTestSuite(projectId: string, suiteId: string, input: UpdateTestSuiteRequest): Promise<TestSuiteDefinition>;
  deleteTestSuite(projectId: string, suiteId: string): Promise<void>;
  startTestSuiteExecution(projectId: string, suiteId: string, idempotencyKey: string,
    input?: StartTestSuiteExecutionRequest): Promise<TestSuiteExecutionDetail>;
  getTestSuiteExecution(projectId: string, executionId: string): Promise<TestSuiteExecutionDetail>;
  cancelTestSuiteExecution(projectId: string, executionId: string): Promise<void>;
  exportAutomatedTests(projectId: string): Promise<AutomatedTestsExportEnvelope>;
  importAutomatedTests(projectId: string, input: unknown): Promise<ImportAutomatedTestsResult>;
  previewTestCaseFromRun(projectId: string, runId: string): Promise<TestCaseCreationPreview>;
  previewTestCaseFromSavedItem(projectId: string, savedItemId: string): Promise<TestCaseCreationPreview>;
  startTestExecution(projectId: string, testCaseId: string, idempotencyKey: string,
    input?: StartTestExecutionRequest): Promise<TestExecutionDetail>;
  listTestExecutions(projectId: string, input?: { cursor?: string; limit?: number }): Promise<TestExecutionReportPage>;
  updateTestExecutionBaseline(projectId: string, executionId: string,
    input: { revision: number; confirm: true }): Promise<UpdateTestExecutionBaselineResult>;
  getTestExecution(projectId: string, executionId: string): Promise<TestExecutionDetail>;
  cancelTestExecution(projectId: string, executionId: string): Promise<void>;
}

interface ApiErrorBody {
  error?: { code?: unknown; message?: unknown };
}

export class InspectorApiError extends Error {
  constructor(readonly code: string | null, message: string, readonly status: number) {
    super(message);
    this.name = "InspectorApiError";
  }
}

async function decodeResponse<T>(response: Response): Promise<T> {
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    if (!response.ok) throw new Error(`Request failed (${response.status})`);
    throw new Error("Invalid response");
  }
  if (!response.ok) {
    const body = (payload as ApiErrorBody)?.error;
    const message = body?.message;
    throw new InspectorApiError(typeof body?.code === "string" ? body.code : null,
      typeof message === "string" ? message : `Request failed (${response.status})`, response.status);
  }
  return payload as T;
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNullableObject(value: unknown): value is Record<string, unknown> | null {
  return value === null || isObject(value);
}

function decodeServerExport(value: unknown, projectId: string, connectionId: string): Record<string, unknown> {
  if (!isObject(value) || value.format !== "mcp-inspector-server-export" ||
      (value.version !== 1 && value.version !== 2) ||
      !isCanonicalUtcTimestamp(value.exportedAt) || !isObject(value.project) || value.project.id !== projectId ||
      !isObject(value.server) || value.server.id !== connectionId || !isObject(value.security) || !isObject(value.data)) {
    throw new Error("Invalid Server export response");
  }
  if (value.version === 2) {
    if (value.security.environmentSecretValuesIncluded !== false ||
        value.security.containsSensitiveToolData !== false ||
        !Array.isArray(value.security.omittedSensitiveToolData)) {
      throw new Error("Invalid Server export response");
    }
    parseServerExportEnvironment(value.data.environment);
  }
  return value;
}

function isConnectionStatus(value: unknown): value is ConnectionSummary["status"] {
  return value === "disconnected" || value === "connecting" ||
    value === "connected" || value === "failed";
}

function decodeConnection(value: unknown, projectId: string): ConnectionSummary {
  if (!isObject(value)) throw new Error("Invalid connection response");
  const {
    id,
    projectId: recordProjectId,
    name,
    url: rawUrl,
    transport,
    authMode,
    bearerToken,
    headers,
    redactSensitiveInfo,
    authorizationStatus,
    timeoutMs,
    status,
    lastProtocolVersion,
    lastServerInfo,
    lastError,
  } = value;
  if (typeof rawUrl !== "string") throw new Error("Invalid connection response");
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(rawUrl);
  } catch {
    throw new Error("Invalid connection response");
  }
  const validError = lastError === null || (
    isObject(lastError) &&
    typeof lastError.code === "string" &&
    typeof lastError.message === "string"
  );
  const normalizedHeaders = authMode === "none" || authMode === "bearer" || authMode === "oauth"
    ? normalizeCustomHeaders(headers, authMode)
    : null;
  if (
    typeof id !== "string" || !uuidPattern.test(id) ||
    typeof recordProjectId !== "string" || !uuidPattern.test(recordProjectId) ||
    recordProjectId !== projectId ||
    typeof name !== "string" || name.trim() !== name || name.length < 1 || name.length > 120 ||
    (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") ||
    parsedUrl.hostname.length === 0 || parsedUrl.username.length > 0 || parsedUrl.password.length > 0 ||
    transport !== "streamable-http" || (authMode !== "none" && authMode !== "bearer" && authMode !== "oauth") ||
    !((authMode === "bearer" && isValidBearerTokenConfiguration(bearerToken)) ||
      (authMode !== "bearer" && bearerToken === null)) || !isConnectionStatus(status) ||
    typeof timeoutMs !== "number" || !Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 600_000 ||
    !(lastProtocolVersion === null || typeof lastProtocolVersion === "string") ||
    !isNullableObject(lastServerInfo) || !validError || normalizedHeaders === null || typeof redactSensitiveInfo !== "boolean" ||
    !(((authMode === "none" || authMode === "bearer") && authorizationStatus === "not-required") ||
      (authMode === "oauth" && (authorizationStatus === "required" || authorizationStatus === "authorizing" || authorizationStatus === "authorized")))
  ) {
    throw new Error("Invalid connection response");
  }
  return {
    id,
    projectId: recordProjectId,
    name,
    url: rawUrl,
    transport,
    authMode,
    bearerToken,
    headers: normalizedHeaders,
    redactSensitiveInfo,
    authorizationStatus,
    timeoutMs,
    status,
    lastProtocolVersion,
    lastServerInfo,
    lastError: lastError === null
      ? null
      : { code: lastError.code as string, message: lastError.message as string },
  };
}

async function decodeConnectionResponse(response: Response): Promise<unknown> {
  try {
    return await decodeResponse<unknown>(response);
  } catch (error) {
    if (response.ok) throw new Error("Invalid connection response");
    throw error;
  }
}

function decodeConnectionList(value: unknown, projectId: string): ConnectionSummary[] {
  if (!isObject(value) || !Array.isArray(value.connections)) {
    throw new Error("Invalid connection response");
  }
  return value.connections.map((connection) => decodeConnection(connection, projectId));
}

function decodeCreatedConnection(value: unknown, projectId: string): ConnectionSummary {
  if (!isObject(value) || !("connection" in value)) {
    throw new Error("Invalid connection response");
  }
  return decodeConnection(value.connection, projectId);
}

function isCanonicalUtcTimestamp(value: unknown): value is string {
  if (typeof value !== "string" ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false;
  const epoch = Date.parse(value);
  return Number.isFinite(epoch) && new Date(epoch).toISOString() === value;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (isObject(value)) {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function decodeSnapshot(
  value: unknown,
  projectId: string,
  connectionId: string,
  toolName: string,
): ToolSnapshotSummary {
  if (!isObject(value)) throw new Error("Invalid Tool response");
  const { id, projectId: owner, connectionId: connection, toolName: name,
    contentHash, definition, createdAt } = value;
  let parsedDefinition: ToolDefinition;
  try {
    parsedDefinition = parseToolDefinition(definition);
  } catch {
    throw new Error("Invalid Tool response");
  }
  if (
    !uuidPattern.test(projectId) || !uuidPattern.test(connectionId) ||
    typeof id !== "string" || !uuidPattern.test(id) || owner !== projectId ||
    connection !== connectionId || name !== toolName ||
    typeof contentHash !== "string" || !/^[a-f0-9]{64}$/.test(contentHash) ||
    parsedDefinition.name !== toolName || !isCanonicalUtcTimestamp(createdAt)
  ) throw new Error("Invalid Tool response");
  return { id, projectId, connectionId, toolName, contentHash,
    definition: parsedDefinition, createdAt };
}

function decodeTool(value: unknown, projectId: string, connectionId: string): CatalogToolSummary {
  if (!isObject(value)) throw new Error("Invalid Tool response");
  const { projectId: owner, connectionId: connection, name, status, folderId, favorite, lastUsedAt, updatedAt, currentSnapshot } = value;
  if (owner !== projectId || connection !== connectionId || typeof name !== "string" || name.length === 0 ||
      (status !== "current" && status !== "changed" && status !== "removed") ||
      !(folderId === null || (typeof folderId === "string" && uuidPattern.test(folderId))) ||
      typeof favorite !== "boolean" || !(lastUsedAt === null || isCanonicalUtcTimestamp(lastUsedAt)) ||
      !isCanonicalUtcTimestamp(updatedAt)) {
    throw new Error("Invalid Tool response");
  }
  return {
    projectId, connectionId, name, status, folderId, favorite, lastUsedAt, updatedAt,
    currentSnapshot: decodeSnapshot(currentSnapshot, projectId, connectionId, name),
  };
}

function decodeToolFolder(value: unknown, projectId: string, connectionId: string): ToolFolderSummary {
  if (!isObject(value)) throw new Error("Invalid Tool folder response");
  const { id, projectId: owner, connectionId: connection, name, createdAt, updatedAt } = value;
  if (typeof id !== "string" || !uuidPattern.test(id) || owner !== projectId || connection !== connectionId ||
      typeof name !== "string" || name !== name.trim() || name.length === 0 || name.length > 80 ||
      /[\u0000-\u001f\u007f]/u.test(name) || !isCanonicalUtcTimestamp(createdAt) || !isCanonicalUtcTimestamp(updatedAt)) {
    throw new Error("Invalid Tool folder response");
  }
  return { id, projectId, connectionId, name, createdAt, updatedAt };
}

function decodeToolFolders(value: unknown, projectId: string, connectionId: string): ToolFolderSummary[] {
  if (!isObject(value) || !Array.isArray(value.folders)) throw new Error("Invalid Tool folder response");
  const folders = value.folders.map((folder) => decodeToolFolder(folder, projectId, connectionId));
  if (new Set(folders.map(({ id }) => id)).size !== folders.length ||
      new Set(folders.map(({ name }) => name.toLocaleLowerCase())).size !== folders.length) {
    throw new Error("Invalid Tool folder response");
  }
  return folders;
}

function decodeToolList(value: unknown, projectId: string, connectionId: string): CatalogToolSummary[] {
  if (!isObject(value) || !Array.isArray(value.tools)) throw new Error("Invalid Tool response");
  const decoded = value.tools.map((tool) => decodeTool(tool, projectId, connectionId));
  if (new Set(decoded.map(({ name }) => name)).size !== decoded.length) {
    throw new Error("Invalid Tool response");
  }
  return decoded;
}

function decodeToolDetail(value: unknown, projectId: string, connectionId: string, toolName: string): ToolDetailSummary {
  if (!isObject(value) || !isObject(value.detail)) {
    throw new Error("Invalid Tool response");
  }
  const detail = value.detail;
  const snapshotValues = detail.snapshots;
  if (!Array.isArray(snapshotValues)) throw new Error("Invalid Tool response");
  const tool = decodeTool(detail.tool, projectId, connectionId);
  if (tool.name !== toolName) throw new Error("Invalid Tool response");
  const snapshots = snapshotValues.map((snapshot: unknown) =>
    decodeSnapshot(snapshot, projectId, connectionId, toolName));
  const snapshotIds = new Set<string>();
  for (let index = 1; index < snapshots.length; index += 1) {
    const previous = snapshots[index - 1];
    const current = snapshots[index];
    const previousEpoch = Date.parse(previous.createdAt);
    const currentEpoch = Date.parse(current.createdAt);
    if (previousEpoch > currentEpoch ||
        (previousEpoch === currentEpoch && previous.id >= current.id)) {
      throw new Error("Invalid Tool response");
    }
  }
  for (const snapshot of snapshots) {
    if (snapshotIds.has(snapshot.id)) throw new Error("Invalid Tool response");
    snapshotIds.add(snapshot.id);
  }
  const currentHistorySnapshot = snapshots.find(({ id }) => id === tool.currentSnapshot.id);
  if (currentHistorySnapshot === undefined ||
      stableJson(currentHistorySnapshot) !== stableJson(tool.currentSnapshot)) {
    throw new Error("Invalid Tool response");
  }
  return { tool, snapshots };
}

function decodeToolWorkflow(
  value: unknown,
  projectId: string,
  connectionId: string,
  toolName: string,
): ToolWorkflow {
  try {
    if (!isObject(value) || !("workflow" in value)) throw new Error();
    const workflow = parseToolWorkflow(value.workflow);
    if (workflow.projectId !== projectId || workflow.connectionId !== connectionId || workflow.toolName !== toolName) {
      throw new Error();
    }
    return workflow;
  } catch {
    throw new Error("Invalid workflow response");
  }
}

function decodeWorkflowExecution(
  value: unknown,
  projectId: string,
  expected?: { executionId?: string; tabId?: string; idempotencyKey?: string },
): WorkflowExecutionDetail {
  try {
    if (!isObject(value) || !("execution" in value)) throw new Error();
    const execution = parseWorkflowExecutionDetail(value.execution);
    if (execution.projectId !== projectId ||
        (expected?.executionId !== undefined && execution.id !== expected.executionId) ||
        (expected?.tabId !== undefined && execution.tabId !== expected.tabId) ||
        (expected?.idempotencyKey !== undefined && execution.idempotencyKey !== expected.idempotencyKey)) {
      throw new Error();
    }
    if (new Set(execution.runs.map(({ runId }) => runId)).size !== execution.runs.length ||
        execution.runs.some((run, index) => run.ordinal !== index) ||
        execution.events.some((event, index) => event.executionId !== execution.id || event.sequence !== index + 1)) {
      throw new Error();
    }
    return execution;
  } catch {
    throw new Error("Invalid workflow execution response");
  }
}

function environmentBase(projectId: string, connectionId: string | null): string {
  const project = `/api/projects/${encodeURIComponent(projectId)}`;
  return connectionId === null
    ? `${project}/variables`
    : `${project}/connections/${encodeURIComponent(connectionId)}/variables`;
}

function decodeEnvironmentVariable(
  value: unknown,
  projectId: string,
  connectionId: string | null,
): EnvironmentVariable {
  try {
    const variable = parseEnvironmentVariable(value);
    if (variable.projectId !== projectId || variable.connectionId !== connectionId) throw new Error();
    return variable;
  } catch {
    throw new Error("Invalid environment response");
  }
}

function decodeEnvironmentList(
  value: unknown,
  projectId: string,
  connectionId: string | null,
): EnvironmentVariable[] {
  if (!isObject(value) || !Array.isArray(value.variables)) throw new Error("Invalid environment response");
  const variables = value.variables.map((item) => decodeEnvironmentVariable(item, projectId, connectionId));
  if (new Set(variables.map(({ id }) => id)).size !== variables.length ||
      new Set(variables.map(({ name }) => name.toLocaleLowerCase())).size !== variables.length) {
    throw new Error("Invalid environment response");
  }
  return variables;
}

function profileBase(projectId: string): string {
  return `/api/projects/${encodeURIComponent(projectId)}/environment-profiles`;
}

function profileVariableBase(
  projectId: string,
  profileId: string,
  connectionId: string | null,
): string {
  const base = `${profileBase(projectId)}/${encodeURIComponent(profileId)}`;
  return connectionId === null
    ? `${base}/variables`
    : `${base}/connections/${encodeURIComponent(connectionId)}/variables`;
}

function decodeProfile(value: unknown, projectId: string, profileId?: string): EnvironmentProfile {
  try {
    const parsed = parseEnvironmentProfile(value);
    if (parsed.projectId !== projectId || (profileId !== undefined && parsed.id !== profileId)) throw new Error();
    return parsed;
  } catch { throw new Error("Invalid environment profile response"); }
}

function decodeProfilePreview(
  value: unknown,
  profileId?: string | null,
): EnvironmentProfilePreview {
  try {
    const parsed = parseEnvironmentProfilePreview(value);
    if (profileId !== undefined && parsed.profileId !== profileId) throw new Error();
    return parsed;
  } catch { throw new Error("Invalid environment profile response"); }
}

function decodeProfileVariable(
  value: unknown,
  projectId: string,
  profileId: string,
  connectionId: string | null,
): EnvironmentProfileVariable {
  try {
    const parsed = parseEnvironmentProfileVariable(value);
    if (parsed.projectId !== projectId || parsed.profileId !== profileId || parsed.connectionId !== connectionId) throw new Error();
    return parsed;
  } catch { throw new Error("Invalid environment profile response"); }
}

function decodeTab(value: unknown, projectId: string): DebugTabSummary {
  if (!isObject(value)) throw new Error("Invalid Tab response");
  const { id, projectId: owner, connectionId, toolName, title, position, pinned, inputMode,
    arguments: args, rawText, viewState, lastRunId } = value;
  if (typeof id !== "string" || !uuidPattern.test(id) || owner !== projectId ||
      typeof connectionId !== "string" || !uuidPattern.test(connectionId) || typeof toolName !== "string" || toolName.trim().length === 0 || toolName.length > 512 ||
      typeof title !== "string" || title.trim().length === 0 || title.length > 180 || !Number.isInteger(position) || (position as number) < 0 ||
      typeof pinned !== "boolean" || (inputMode !== "form" && inputMode !== "raw") || !isObject(args) ||
      typeof rawText !== "string" || rawText.length > 2_000_000 || !isObject(viewState) ||
      typeof viewState.editorScrollTop !== "number" || !Number.isFinite(viewState.editorScrollTop) || viewState.editorScrollTop < 0 ||
      typeof viewState.resultScrollTop !== "number" || !Number.isFinite(viewState.resultScrollTop) || viewState.resultScrollTop < 0 ||
      typeof viewState.splitRatio !== "number" || !Number.isFinite(viewState.splitRatio) || viewState.splitRatio < 0.2 || viewState.splitRatio > 0.8 ||
      !(lastRunId === null || (typeof lastRunId === "string" && uuidPattern.test(lastRunId)))) {
    throw new Error("Invalid Tab response");
  }
  if (viewState.requestExpanded !== undefined && typeof viewState.requestExpanded !== "boolean" ||
      viewState.responseExpanded !== undefined && typeof viewState.responseExpanded !== "boolean") {
    throw new Error("Invalid Tab response");
  }
  return { id, projectId, connectionId, toolName, title, position: position as number, pinned, inputMode,
    arguments: args, rawText, viewState: { editorScrollTop: viewState.editorScrollTop,
      resultScrollTop: viewState.resultScrollTop, splitRatio: viewState.splitRatio,
      requestExpanded: viewState.requestExpanded ?? true,
      responseExpanded: viewState.responseExpanded ?? true }, lastRunId };
}

function decodeTabs(value: unknown, projectId: string): DebugTabSummary[] {
  if (!isObject(value) || !Array.isArray(value.tabs)) throw new Error("Invalid Tab response");
  const tabs = value.tabs.map((item) => decodeTab(item, projectId));
  if (new Set(tabs.map(({ id }) => id)).size !== tabs.length ||
      tabs.some((tab, index) => index > 0 && tab.position <= tabs[index - 1]!.position)) {
    throw new Error("Invalid Tab response");
  }
  return tabs;
}

function decodeTabEnvelope(value: unknown, projectId: string): DebugTabSummary {
  if (!isObject(value) || !("tab" in value)) throw new Error("Invalid Tab response");
  return decodeTab(value.tab, projectId);
}

function decodeRunSummary(value: unknown, projectId: string): RunSummary {
  const parsed = runSummarySchema.safeParse(value);
  if (!parsed.success || parsed.data.projectId !== projectId) throw new Error("Invalid Run response");
  return parsed.data;
}

export function decodeRunEvent(value: unknown, runId: string): RunEvent {
  if (!isObject(value) || value.runId !== runId || !Number.isSafeInteger(value.sequence) || (value.sequence as number) < 1 ||
      typeof value.kind !== "string" || value.kind.length === 0 || !isCanonicalUtcTimestamp(value.occurredAt)) {
    throw new Error("Invalid Run event");
  }
  return { runId, sequence: value.sequence as number, kind: value.kind, occurredAt: value.occurredAt as string, payload: value.payload };
}

function decodeRunDetail(value: unknown, projectId: string): RunDetail {
  if (!isObject(value) || !isObject(value.run)) throw new Error("Invalid Run response");
  const parsed = runDetailSchema.safeParse(value.run);
  if (!parsed.success || parsed.data.projectId !== projectId) throw new Error("Invalid Run response");
  const raw = parsed.data;
  const events = raw.events.map((event) => decodeRunEvent(event, raw.id));
  if (events.some((event, index) => index > 0 && event.sequence <= events[index - 1]!.sequence)) throw new Error("Invalid Run response");
  return { ...raw, redactSensitiveInfo: raw.redactSensitiveInfo !== false, events };
}

async function decodeRunDetailResponse(response: Response, projectId: string, runId: string): Promise<RunDetail> {
  if (!response.ok) return decodeRunDetail(await decodeResponse<unknown>(response), projectId);
  let source: ArrayBuffer;
  try { source = await response.arrayBuffer(); }
  catch { throw new Error("Invalid Run response"); }
  const decodedInWorker = await decodeLargeRunDetail(source, projectId, runId);
  if (decodedInWorker !== null) return { ...decodedInWorker,
    redactSensitiveInfo: decodedInWorker.redactSensitiveInfo !== false };
  let value: unknown;
  try { value = JSON.parse(new TextDecoder().decode(source)) as unknown; }
  catch { throw new Error("Invalid Run response"); }
  return decodeRunDetail(value, projectId);
}

function decodeRunPage(value: unknown, projectId: string, filter: RunListFilter = {}): RunPage {
  if (!isObject(value) || !Array.isArray(value.runs) || !(value.nextCursor === null ||
      (typeof value.nextCursor === "string" && value.nextCursor.length > 0 && value.nextCursor.length <= 4096 && /^[A-Za-z0-9_-]+$/.test(value.nextCursor)))) {
    throw new Error("Invalid Run response");
  }
  const runs = value.runs.map((run) => decodeRunSummary(run, projectId));
  if (filter.tabId !== undefined && runs.some((run) => run.tabId !== filter.tabId)) throw new Error("Invalid Run response");
  if (filter.connectionId !== undefined && runs.some((run) => run.connectionId !== filter.connectionId)) throw new Error("Invalid Run response");
  if (filter.toolName !== undefined && runs.some((run) => run.toolName !== filter.toolName)) throw new Error("Invalid Run response");
  if (new Set(runs.map(({ id }) => id)).size !== runs.length) throw new Error("Invalid Run response");
  if (runs.some((run, index) => index > 0 && (run.createdAt > runs[index - 1]!.createdAt ||
      (run.createdAt === runs[index - 1]!.createdAt && run.id >= runs[index - 1]!.id)))) throw new Error("Invalid Run response");
  return { runs, nextCursor: value.nextCursor as string | null };
}

function decodeSavedItemSummary(value: unknown, projectId: string, connectionId: string, toolName: string): SavedItemSummary {
  if (!isObject(value)) throw new Error("Invalid saved item response");
  const { id, projectId: itemProjectId, connectionId: itemConnectionId, toolName: itemToolName, kind,
    name, description, sourceRunId, createdAt, updatedAt } = value;
  if (typeof id !== "string" || !uuidPattern.test(id) || itemProjectId !== projectId || itemConnectionId !== connectionId ||
      itemToolName !== toolName || (kind !== "request" && kind !== "response") || typeof name !== "string" ||
      name.trim() !== name || name.length < 1 || name.length > 120 || typeof description !== "string" || description.length > 1000 ||
      !(sourceRunId === null || (typeof sourceRunId === "string" && uuidPattern.test(sourceRunId))) ||
      typeof createdAt !== "string" || !Number.isFinite(Date.parse(createdAt)) || typeof updatedAt !== "string" || !Number.isFinite(Date.parse(updatedAt))) {
    throw new Error("Invalid saved item response");
  }
  return { id, projectId, connectionId, toolName, kind, name, description, sourceRunId, createdAt, updatedAt };
}

function decodeSavedItemDetail(value: unknown, projectId: string, connectionId: string, toolName: string, itemId?: string): SavedItemDetail {
  const summary = decodeSavedItemSummary(value, projectId, connectionId, toolName);
  if (!isObject(value) || !("payload" in value) || (itemId !== undefined && summary.id !== itemId) ||
      (summary.kind === "request" && (!isObject(value.payload)))) throw new Error("Invalid saved item response");
  return { ...summary, payload: value.payload };
}

function decodeTestCaseEnvelope(value: unknown, projectId: string, testCaseId?: string): TestCaseDefinition {
  if (!isObject(value) || !("testCase" in value)) throw new Error("Invalid test case response");
  try {
    const definition = parseTestCaseDefinition(value.testCase);
    if (definition.projectId !== projectId || (testCaseId !== undefined && definition.id !== testCaseId)) throw new Error();
    return definition;
  } catch {
    throw new Error("Invalid test case response");
  }
}

function decodeTestSuiteEnvelope(value: unknown, projectId: string, suiteId?: string): TestSuiteDefinition {
  if (!isObject(value) || !("testSuite" in value)) throw new Error("Invalid test suite response");
  try {
    const definition = parseTestSuiteDefinition(value.testSuite);
    if (definition.projectId !== projectId || (suiteId !== undefined && definition.id !== suiteId)) throw new Error();
    return definition;
  } catch { throw new Error("Invalid test suite response"); }
}

function decodeTestExecutionEnvelope(
  value: unknown,
  projectId: string,
  expected: { executionId?: string; testCaseId?: string },
): TestExecutionDetail {
  try {
    if (!isObject(value) || !("execution" in value)) throw new Error();
    const execution = parseTestExecutionDetail(value.execution);
    if (execution.projectId !== projectId ||
        (expected.executionId !== undefined && execution.id !== expected.executionId) ||
        (expected.testCaseId !== undefined && execution.testCaseId !== expected.testCaseId)) throw new Error();
    return execution;
  } catch { throw new Error("Invalid test execution response"); }
}

function decodeTestSuiteExecutionEnvelope(value: unknown, projectId: string,
  expected: { executionId?: string; suiteId?: string }): TestSuiteExecutionDetail {
  try {
    if (!isObject(value) || !("execution" in value)) throw new Error();
    const execution = parseTestSuiteExecutionDetail(value.execution);
    if (execution.projectId !== projectId ||
        (expected.executionId !== undefined && execution.id !== expected.executionId) ||
        (expected.suiteId !== undefined && execution.suiteId !== expected.suiteId)) throw new Error();
    return execution;
  } catch { throw new Error("Invalid test suite execution response"); }
}

export function createApiClient(_legacySessionToken?: string): InspectorApiClient {
  const headers = {
    "Content-Type": "application/json",
  };

  return {
    async listProjects() {
      const response = await fetch("/api/projects", { headers });
      return (await decodeResponse<{ projects: ProjectSummary[] }>(response)).projects;
    },
    async createProject(name) {
      const response = await fetch("/api/projects", {
        method: "POST",
        headers,
        body: JSON.stringify({ name }),
      });
      return (await decodeResponse<{ project: ProjectSummary }>(response)).project;
    },
    async openProject(projectId) {
      const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/open`, {
        method: "POST",
        headers,
      });
      return (await decodeResponse<{ project: ProjectSummary }>(response)).project;
    },
    async listConnections(projectId) {
      const response = await fetch(
        `/api/projects/${encodeURIComponent(projectId)}/connections`,
        { headers },
      );
      return decodeConnectionList(await decodeConnectionResponse(response), projectId);
    },
    async createConnection(projectId, input) {
      const response = await fetch(
        `/api/projects/${encodeURIComponent(projectId)}/connections`,
        { method: "POST", headers, body: JSON.stringify(input) },
      );
      return decodeCreatedConnection(await decodeConnectionResponse(response), projectId);
    },
    async updateConnection(projectId, connectionId, input) {
      const response = await fetch(
        `/api/projects/${encodeURIComponent(projectId)}/connections/${encodeURIComponent(connectionId)}`,
        { method: "PATCH", headers, body: JSON.stringify(input) },
      );
      const updated = decodeCreatedConnection(await decodeConnectionResponse(response), projectId);
      if (updated.id !== connectionId) throw new Error("Invalid connection response");
      return updated;
    },
    async exportConnection(projectId, connectionId) {
      const response = await fetch(
        `/api/projects/${encodeURIComponent(projectId)}/connections/${encodeURIComponent(connectionId)}/export`,
        { headers },
      );
      const value = decodeServerExport(await decodeResponse<unknown>(response), projectId, connectionId);
      return new Blob([`${JSON.stringify(value, null, 2)}\n`], { type: "application/json" });
    },
    async deleteConnection(projectId, connectionId) {
      const response = await fetch(
        `/api/projects/${encodeURIComponent(projectId)}/connections/${encodeURIComponent(connectionId)}`,
        { method: "DELETE", headers },
      );
      if (!response.ok) await decodeResponse<never>(response);
    },
    async connectConnection(projectId, connectionId) {
      const response = await fetch(
        `/api/projects/${encodeURIComponent(projectId)}/connections/${encodeURIComponent(connectionId)}/connect`,
        { method: "POST", headers },
      );
      return decodeCreatedConnection(await decodeConnectionResponse(response), projectId);
    },
    async disconnectConnection(projectId, connectionId) {
      const response = await fetch(
        `/api/projects/${encodeURIComponent(projectId)}/connections/${encodeURIComponent(connectionId)}/disconnect`,
        { method: "POST", headers },
      );
      return decodeCreatedConnection(await decodeConnectionResponse(response), projectId);
    },
    async listTools(projectId, connectionId) {
      const response = await fetch(
        `/api/projects/${encodeURIComponent(projectId)}/connections/${encodeURIComponent(connectionId)}/tools`,
        { headers },
      );
      return decodeToolList(await decodeResponse<unknown>(response), projectId, connectionId);
    },
    async refreshTools(projectId, connectionId) {
      const response = await fetch(
        `/api/projects/${encodeURIComponent(projectId)}/connections/${encodeURIComponent(connectionId)}/tools/refresh`,
        { method: "POST", headers },
      );
      return decodeToolList(await decodeResponse<unknown>(response), projectId, connectionId);
    },
    async getTool(projectId, connectionId, toolName) {
      const response = await fetch(
        `/api/projects/${encodeURIComponent(projectId)}/connections/${encodeURIComponent(connectionId)}/tools/${encodeURIComponent(toolName)}`,
        { headers },
      );
      return decodeToolDetail(await decodeResponse<unknown>(response), projectId, connectionId, toolName);
    },
    async deleteTool(projectId, connectionId, toolName) {
      const response = await fetch(
        `/api/projects/${encodeURIComponent(projectId)}/connections/${encodeURIComponent(connectionId)}/tools/${encodeURIComponent(toolName)}`,
        { method: "DELETE", headers },
      );
      if (!response.ok) await decodeResponse<never>(response);
    },
    async listToolFolders(projectId, connectionId) {
      const response = await fetch(
        `/api/projects/${encodeURIComponent(projectId)}/connections/${encodeURIComponent(connectionId)}/tool-folders`,
        { headers },
      );
      return decodeToolFolders(await decodeResponse<unknown>(response), projectId, connectionId);
    },
    async createToolFolder(projectId, connectionId, name) {
      const response = await fetch(
        `/api/projects/${encodeURIComponent(projectId)}/connections/${encodeURIComponent(connectionId)}/tool-folders`,
        { method: "POST", headers, body: JSON.stringify({ name }) },
      );
      const value = await decodeResponse<unknown>(response);
      if (!isObject(value) || !("folder" in value)) throw new Error("Invalid Tool folder response");
      return decodeToolFolder(value.folder, projectId, connectionId);
    },
    async renameToolFolder(projectId, connectionId, folderId, name) {
      const response = await fetch(
        `/api/projects/${encodeURIComponent(projectId)}/connections/${encodeURIComponent(connectionId)}/tool-folders/${encodeURIComponent(folderId)}`,
        { method: "PATCH", headers, body: JSON.stringify({ name }) },
      );
      const value = await decodeResponse<unknown>(response);
      if (!isObject(value) || !("folder" in value)) throw new Error("Invalid Tool folder response");
      const folder = decodeToolFolder(value.folder, projectId, connectionId);
      if (folder.id !== folderId) throw new Error("Invalid Tool folder response");
      return folder;
    },
    async deleteToolFolder(projectId, connectionId, folderId) {
      const response = await fetch(
        `/api/projects/${encodeURIComponent(projectId)}/connections/${encodeURIComponent(connectionId)}/tool-folders/${encodeURIComponent(folderId)}`,
        { method: "DELETE", headers },
      );
      if (!response.ok) await decodeResponse<never>(response);
    },
    async moveToolToFolder(projectId, connectionId, toolName, folderId) {
      const response = await fetch(
        `/api/projects/${encodeURIComponent(projectId)}/connections/${encodeURIComponent(connectionId)}/tools/${encodeURIComponent(toolName)}/folder`,
        { method: "PUT", headers, body: JSON.stringify({ folderId }) },
      );
      const value = await decodeResponse<unknown>(response);
      if (!isObject(value) || !("tool" in value)) throw new Error("Invalid Tool response");
      const tool = decodeTool(value.tool, projectId, connectionId);
      if (tool.name !== toolName || tool.folderId !== folderId) throw new Error("Invalid Tool response");
      return tool;
    },
    async setToolFavorite(projectId, connectionId, toolName, favorite) {
      const response = await fetch(
        `/api/projects/${encodeURIComponent(projectId)}/connections/${encodeURIComponent(connectionId)}/tools/${encodeURIComponent(toolName)}/favorite`,
        { method: "PUT", headers, body: JSON.stringify({ favorite }) },
      );
      const value = await decodeResponse<unknown>(response);
      if (!isObject(value) || !("tool" in value)) throw new Error("Invalid Tool response");
      const tool = decodeTool(value.tool, projectId, connectionId);
      if (tool.name !== toolName || tool.favorite !== favorite) throw new Error("Invalid Tool response");
      return tool;
    },
    async markToolUsed(projectId, connectionId, toolName) {
      const response = await fetch(
        `/api/projects/${encodeURIComponent(projectId)}/connections/${encodeURIComponent(connectionId)}/tools/${encodeURIComponent(toolName)}/recent-use`,
        { method: "POST", headers },
      );
      const value = await decodeResponse<unknown>(response);
      if (!isObject(value) || !("tool" in value)) throw new Error("Invalid Tool response");
      const tool = decodeTool(value.tool, projectId, connectionId);
      if (tool.name !== toolName || tool.lastUsedAt === null) throw new Error("Invalid Tool response");
      return tool;
    },
    async getToolWorkflow(projectId, connectionId, toolName) {
      const response = await fetch(
        `/api/projects/${encodeURIComponent(projectId)}/connections/${encodeURIComponent(connectionId)}/tools/${encodeURIComponent(toolName)}/workflow`,
        { headers },
      );
      return decodeToolWorkflow(await decodeResponse<unknown>(response), projectId, connectionId, toolName);
    },
    async updateToolWorkflow(projectId, connectionId, toolName, input) {
      const response = await fetch(
        `/api/projects/${encodeURIComponent(projectId)}/connections/${encodeURIComponent(connectionId)}/tools/${encodeURIComponent(toolName)}/workflow`,
        { method: "PUT", headers, body: JSON.stringify(input) },
      );
      const workflow = decodeToolWorkflow(
        await decodeResponse<unknown>(response), projectId, connectionId, toolName,
      );
      if (workflow.revision !== input.revision + 1) throw new Error("Invalid workflow response");
      return workflow;
    },
    async validateToolWorkflow(projectId, connectionId, toolName, input) {
      const response = await fetch(
        `/api/projects/${encodeURIComponent(projectId)}/connections/${encodeURIComponent(connectionId)}/tools/${encodeURIComponent(toolName)}/workflow/validate`,
        { method: "POST", headers, body: JSON.stringify(input) },
      );
      const value = await decodeResponse<unknown>(response);
      try {
        if (!isObject(value) || !("validation" in value)) throw new Error();
        return workflowValidationResultSchema.parse(value.validation);
      } catch {
        throw new Error("Invalid workflow validation response");
      }
    },
    async debugToolWorkflow(projectId, connectionId, toolName, input, signal) {
      const response = await fetch(
        `/api/projects/${encodeURIComponent(projectId)}/connections/${encodeURIComponent(connectionId)}/tools/${encodeURIComponent(toolName)}/workflow/debug`,
        { method: "POST", headers, body: JSON.stringify(input), signal },
      );
      const value = await decodeResponse<unknown>(response);
      try {
        if (!isObject(value) || !("result" in value)) throw new Error();
        const result = workflowDebugResultSchema.parse(value.result);
        if (result.phase !== input.phase) throw new Error();
        return result;
      } catch {
        throw new Error("Invalid workflow debug response");
      }
    },
    async listEnvironmentVariables(projectId, connectionId) {
      const response = await fetch(environmentBase(projectId, connectionId), { headers });
      return decodeEnvironmentList(await decodeResponse<unknown>(response), projectId, connectionId);
    },
    async setEnvironmentVariable(projectId, connectionId, name, input) {
      const response = await fetch(`${environmentBase(projectId, connectionId)}/${encodeURIComponent(name)}`, {
        method: "PUT", headers, body: JSON.stringify(input),
      });
      const value = await decodeResponse<unknown>(response);
      if (!isObject(value) || !("variable" in value)) throw new Error("Invalid environment response");
      const variable = decodeEnvironmentVariable(value.variable, projectId, connectionId);
      if (variable.name !== name || variable.secret !== input.secret) throw new Error("Invalid environment response");
      return variable;
    },
    async deleteEnvironmentVariable(projectId, connectionId, name) {
      const response = await fetch(`${environmentBase(projectId, connectionId)}/${encodeURIComponent(name)}`, {
        method: "DELETE", headers,
      });
      if (!response.ok) await decodeResponse<never>(response);
    },
    async listEnvironmentProfiles(projectId) {
      const response = await fetch(profileBase(projectId), { headers });
      const value = await decodeResponse<unknown>(response);
      if (!isObject(value) || !Array.isArray(value.profiles)) throw new Error("Invalid environment profile response");
      const profiles = value.profiles.map((item) => decodeProfile(item, projectId));
      if (new Set(profiles.map(({ id }) => id)).size !== profiles.length) throw new Error("Invalid environment profile response");
      return profiles;
    },
    async createEnvironmentProfile(projectId, input) {
      const response = await fetch(profileBase(projectId), {
        method: "POST", headers, body: JSON.stringify(input),
      });
      const value = await decodeResponse<unknown>(response);
      if (!isObject(value) || !("profile" in value)) throw new Error("Invalid environment profile response");
      return decodeProfile(value.profile, projectId);
    },
    async updateEnvironmentProfile(projectId, profileId, input) {
      const response = await fetch(`${profileBase(projectId)}/${encodeURIComponent(profileId)}`, {
        method: "PUT", headers, body: JSON.stringify(input),
      });
      const value = await decodeResponse<unknown>(response);
      if (!isObject(value) || !("profile" in value)) throw new Error("Invalid environment profile response");
      return decodeProfile(value.profile, projectId, profileId);
    },
    async deleteEnvironmentProfile(projectId, profileId) {
      const response = await fetch(`${profileBase(projectId)}/${encodeURIComponent(profileId)}`, {
        method: "DELETE", headers,
      });
      if (!response.ok) await decodeResponse<never>(response);
    },
    async listEnvironmentProfileVariables(projectId, profileId, connectionId) {
      const response = await fetch(profileVariableBase(projectId, profileId, connectionId), { headers });
      const value = await decodeResponse<unknown>(response);
      if (!isObject(value) || !Array.isArray(value.variables)) throw new Error("Invalid environment profile response");
      return value.variables.map((item) => decodeProfileVariable(item, projectId, profileId, connectionId));
    },
    async setEnvironmentProfileVariable(projectId, profileId, connectionId, name, input) {
      const response = await fetch(
        `${profileVariableBase(projectId, profileId, connectionId)}/${encodeURIComponent(name)}`,
        { method: "PUT", headers, body: JSON.stringify(input) },
      );
      const value = await decodeResponse<unknown>(response);
      if (!isObject(value) || !("variable" in value)) throw new Error("Invalid environment profile response");
      const variable = decodeProfileVariable(value.variable, projectId, profileId, connectionId);
      if (variable.name !== name || variable.mode !== input.mode) throw new Error("Invalid environment profile response");
      return variable;
    },
    async deleteEnvironmentProfileVariable(projectId, profileId, connectionId, name) {
      const response = await fetch(
        `${profileVariableBase(projectId, profileId, connectionId)}/${encodeURIComponent(name)}`,
        { method: "DELETE", headers },
      );
      if (!response.ok) await decodeResponse<never>(response);
    },
    async getConnectionEnvironmentProfile(projectId, connectionId) {
      const response = await fetch(
        `/api/projects/${encodeURIComponent(projectId)}/connections/${encodeURIComponent(connectionId)}/environment-profile`,
        { headers },
      );
      const value = await decodeResponse<unknown>(response);
      if (!isObject(value) || !(value.profileId === null || typeof value.profileId === "string") || !("preview" in value)) {
        throw new Error("Invalid environment profile response");
      }
      return { profileId: value.profileId, preview: decodeProfilePreview(value.preview, value.profileId) };
    },
    async setConnectionEnvironmentProfile(projectId, connectionId, profileId) {
      const response = await fetch(
        `/api/projects/${encodeURIComponent(projectId)}/connections/${encodeURIComponent(connectionId)}/environment-profile`,
        { method: "PUT", headers, body: JSON.stringify({ profileId }) },
      );
      const value = await decodeResponse<unknown>(response);
      if (!isObject(value) || value.profileId !== profileId || !("preview" in value)) throw new Error("Invalid environment profile response");
      return { profileId, preview: decodeProfilePreview(value.preview, profileId) };
    },
    async previewConnectionEnvironmentProfile(projectId, connectionId, profileId) {
      const response = await fetch(
        `/api/projects/${encodeURIComponent(projectId)}/connections/${encodeURIComponent(connectionId)}/environment-profile/preview`,
        { method: "POST", headers, body: JSON.stringify({ profileId }) },
      );
      const value = await decodeResponse<unknown>(response);
      if (!isObject(value) || !("preview" in value)) throw new Error("Invalid environment profile response");
      return decodeProfilePreview(value.preview, profileId);
    },
    async listTabs(projectId, connectionId) {
      const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/tabs?connectionId=${encodeURIComponent(connectionId)}`, { headers });
      const tabs = decodeTabs(await decodeResponse<unknown>(response), projectId);
      if (tabs.some((tab) => tab.connectionId !== connectionId)) throw new Error("Invalid Tab response");
      return tabs;
    },
    async openTab(projectId, connectionId, toolName) {
      const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/tabs`, {
        method: "POST", headers, body: JSON.stringify({ connectionId, toolName }),
      });
      return decodeTabEnvelope(await decodeResponse<unknown>(response), projectId);
    },
    async replaceTabTool(projectId, tabId, connectionId, toolName) {
      const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/tabs/${encodeURIComponent(tabId)}/tool`, {
        method: "PUT", headers, body: JSON.stringify({ connectionId, toolName }),
      });
      return decodeTabEnvelope(await decodeResponse<unknown>(response), projectId);
    },
    async updateTab(projectId, tabId, patch) {
      const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/tabs/${encodeURIComponent(tabId)}`, {
        method: "PATCH", headers, body: JSON.stringify(patch),
      });
      return decodeTabEnvelope(await decodeResponse<unknown>(response), projectId);
    },
    async duplicateTab(projectId, tabId) {
      const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/tabs/${encodeURIComponent(tabId)}/duplicate`, { method: "POST", headers });
      return decodeTabEnvelope(await decodeResponse<unknown>(response), projectId);
    },
    async reorderTabs(projectId, connectionId, tabIds) {
      const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/tabs/reorder`, {
        method: "PUT", headers, body: JSON.stringify({ connectionId, tabIds }),
      });
      const tabs = decodeTabs(await decodeResponse<unknown>(response), projectId);
      if (tabs.some((tab) => tab.connectionId !== connectionId)) throw new Error("Invalid Tab response");
      return tabs;
    },
    async closeTab(projectId, tabId) {
      const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/tabs/${encodeURIComponent(tabId)}`, { method: "DELETE", headers });
      if (!response.ok) await decodeResponse<never>(response);
    },
    async closeOtherTabs(projectId, connectionId, tabId) {
      const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/tabs/${encodeURIComponent(tabId)}/close-others`, { method: "POST", headers });
      const tabs = decodeTabs(await decodeResponse<unknown>(response), projectId);
      if (tabs.some((tab) => tab.connectionId !== connectionId)) throw new Error("Invalid Tab response");
      return tabs;
    },
    async closeTabsRight(projectId, connectionId, tabId) {
      const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/tabs/${encodeURIComponent(tabId)}/close-right`, { method: "POST", headers });
      const tabs = decodeTabs(await decodeResponse<unknown>(response), projectId);
      if (tabs.some((tab) => tab.connectionId !== connectionId)) throw new Error("Invalid Tab response");
      return tabs;
    },
    async startRun(projectId, connectionId, tabId, idempotencyKey, args) {
      const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/runs`, {
        method: "POST", headers, body: JSON.stringify({ connectionId, tabId, idempotencyKey, arguments: args }),
      });
      const value = await decodeResponse<unknown>(response);
      if (!isObject(value) || !("run" in value)) throw new Error("Invalid Run response");
      const run = decodeRunSummary(value.run, projectId);
      if (run.connectionId !== connectionId || run.tabId !== tabId || run.idempotencyKey !== idempotencyKey) throw new Error("Invalid Run response");
      return run;
    },
    async startWorkflowExecution(projectId, connectionId, tabId, idempotencyKey, args, allowDestructiveHelpers = false) {
      const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/workflow-executions`, {
        method: "POST", headers, body: JSON.stringify({ connectionId, tabId, idempotencyKey, arguments: args, allowDestructiveHelpers }),
      });
      const execution = decodeWorkflowExecution(await decodeResponse<unknown>(response), projectId, { tabId, idempotencyKey });
      if (execution.connectionId !== connectionId) throw new Error("Invalid workflow execution response");
      return execution;
    },
    async getWorkflowExecution(projectId, executionId, signal) {
      const response = await fetch(
        `/api/projects/${encodeURIComponent(projectId)}/workflow-executions/${encodeURIComponent(executionId)}`,
        { headers, signal },
      );
      return decodeWorkflowExecution(await decodeResponse<unknown>(response), projectId, { executionId });
    },
    async getActiveWorkflowExecution(projectId, tabId, signal) {
      const response = await fetch(
        `/api/projects/${encodeURIComponent(projectId)}/workflow-executions/active?tabId=${encodeURIComponent(tabId)}`,
        { headers, signal },
      );
      const value = await decodeResponse<unknown>(response);
      if (!isObject(value) || !("execution" in value)) throw new Error("Invalid workflow execution response");
      if (value.execution === null) return null;
      return decodeWorkflowExecution(value, projectId, { tabId });
    },
    async cancelWorkflowExecution(projectId, executionId) {
      const response = await fetch(
        `/api/projects/${encodeURIComponent(projectId)}/workflow-executions/${encodeURIComponent(executionId)}/cancel`,
        { method: "POST", headers },
      );
      const value = await decodeResponse<unknown>(response);
      if (!isObject(value) || value.cancelled !== true || Object.keys(value).length !== 1) {
        throw new Error("Invalid workflow execution response");
      }
    },
    async getRunSummary(projectId, runId, signal) {
      const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/runs/${encodeURIComponent(runId)}/status`, { headers, signal });
      const value = await decodeResponse<unknown>(response);
      if (!isObject(value) || !("run" in value)) throw new Error("Invalid Run response");
      const run = decodeRunSummary(value.run, projectId);
      if (run.id !== runId) throw new Error("Invalid Run response");
      return run;
    },
    async getRun(projectId, runId, signal) {
      const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/runs/${encodeURIComponent(runId)}`, { headers, signal });
      const run = await decodeRunDetailResponse(response, projectId, runId);
      if (run.id !== runId) throw new Error("Invalid Run response");
      return run;
    },
    async listRuns(projectId, cursor, filter = {}) {
      const search = new URLSearchParams(); if (cursor !== undefined) search.set("cursor", cursor);
      if (filter.tabId !== undefined) search.set("tabId", filter.tabId);
      if (filter.connectionId !== undefined) search.set("connectionId", filter.connectionId);
      if (filter.toolName !== undefined) search.set("toolName", filter.toolName);
      if (filter.status !== undefined) search.set("status", filter.status);
      if (filter.origin !== undefined) search.set("origin", filter.origin);
      if (filter.pinned !== undefined) search.set("pinned", String(filter.pinned));
      if (filter.createdFrom !== undefined) search.set("createdFrom", filter.createdFrom);
      if (filter.createdTo !== undefined) search.set("createdTo", filter.createdTo);
      if (filter.limit !== undefined) search.set("limit", String(filter.limit));
      const query = search.size === 0 ? "" : `?${search.toString()}`;
      const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/runs${query}`, { headers });
      return decodeRunPage(await decodeResponse<unknown>(response), projectId, filter);
    },
    async setRunPinned(projectId, runId, pinned) {
      const response = await fetch(
        `/api/projects/${encodeURIComponent(projectId)}/runs/${encodeURIComponent(runId)}/pin`,
        { method: "PATCH", headers, body: JSON.stringify({ pinned }) },
      );
      const value = await decodeResponse<unknown>(response);
      if (!isObject(value) || !("run" in value)) throw new Error("Invalid Run response");
      const run = decodeRunSummary(value.run, projectId);
      if (run.id !== runId || run.pinned !== pinned) throw new Error("Invalid Run response");
      return run;
    },
    async getReplayPreflight(projectId, runId, signal) {
      const response = await fetch(
        `/api/projects/${encodeURIComponent(projectId)}/runs/${encodeURIComponent(runId)}/replay-preflight`,
        { headers, signal },
      );
      const value = await decodeResponse<unknown>(response);
      if (!isObject(value) || !("preflight" in value)) throw new Error("Invalid replay preflight response");
      const parsed = replayPreflightSchema.safeParse(value.preflight);
      if (!parsed.success || parsed.data.projectId !== projectId || parsed.data.sourceRunId !== runId) {
        throw new Error("Invalid replay preflight response");
      }
      return parsed.data;
    },
    async startReplay(projectId, runId, request) {
      const response = await fetch(
        `/api/projects/${encodeURIComponent(projectId)}/runs/${encodeURIComponent(runId)}/replay`,
        { method: "POST", headers, body: JSON.stringify(request) },
      );
      const value = await decodeResponse<unknown>(response);
      if (!isObject(value) || !("run" in value)) throw new Error("Invalid replay response");
      const replay = decodeRunSummary(value.run, projectId);
      if (replay.replayedFromRunId !== runId || replay.tabId !== null || replay.idempotencyKey !== request.idempotencyKey) {
        throw new Error("Invalid replay response");
      }
      return replay;
    },
    async listComparisonRules(projectId) {
      const response = await fetch(
        `/api/projects/${encodeURIComponent(projectId)}/comparison-rules`, { headers },
      );
      const parsed = comparisonRuleSetSchema.safeParse(await decodeResponse<unknown>(response));
      if (!parsed.success || parsed.data.rules.some((rule, position) =>
        rule.projectId !== projectId || rule.position !== position)) {
        throw new Error("Invalid comparison rules response");
      }
      return parsed.data;
    },
    async replaceComparisonRules(projectId, expressions) {
      const response = await fetch(
        `/api/projects/${encodeURIComponent(projectId)}/comparison-rules`,
        { method: "PUT", headers, body: JSON.stringify({ expressions }) },
      );
      const parsed = comparisonRuleSetSchema.safeParse(await decodeResponse<unknown>(response));
      if (!parsed.success || parsed.data.rules.some((rule, position) =>
        rule.projectId !== projectId || rule.position !== position)) {
        throw new Error("Invalid comparison rules response");
      }
      return parsed.data;
    },
    async getRunComparison(projectId, replayRunId, expressions, signal) {
      const base = `/api/projects/${encodeURIComponent(projectId)}/runs/${encodeURIComponent(replayRunId)}/comparison`;
      const response = await fetch(expressions === undefined ? base : `${base}/preview`, expressions === undefined
        ? { headers, signal }
        : { method: "POST", headers, body: JSON.stringify({ expressions }), signal });
      const value = await decodeResponse<unknown>(response);
      if (!isObject(value) || !("comparison" in value)) throw new Error("Invalid Run comparison response");
      const parsed = runComparisonSchema.safeParse(value.comparison);
      if (!parsed.success || parsed.data.projectId !== projectId || parsed.data.replayRunId !== replayRunId) {
        throw new Error("Invalid Run comparison response");
      }
      return parsed.data;
    },
    async openRunEventStream(projectId, runId, after, signal) {
      const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/runs/${encodeURIComponent(runId)}/events?after=${after}`, {
        headers: { Accept: "text/event-stream" }, signal,
      });
      if (!response.ok) await decodeResponse<never>(response);
      return response;
    },
    async listSavedItems(projectId, connectionId, toolName, cursor) {
      const base = `/api/projects/${encodeURIComponent(projectId)}/connections/${encodeURIComponent(connectionId)}/tools/${encodeURIComponent(toolName)}/saved-items`;
      const target = cursor === undefined ? base : `${base}?cursor=${encodeURIComponent(cursor)}`;
      const value = await decodeResponse<unknown>(await fetch(target, { headers }));
      if (!isObject(value) || !Array.isArray(value.items) || !(value.nextCursor === null ||
          (typeof value.nextCursor === "string" && value.nextCursor.length > 0 && value.nextCursor.length <= 4096 && /^[A-Za-z0-9_-]+$/.test(value.nextCursor)))) {
        throw new Error("Invalid saved item response");
      }
      const items = value.items.map((item) => decodeSavedItemSummary(item, projectId, connectionId, toolName));
      if (new Set(items.map(({ id }) => id)).size !== items.length) throw new Error("Invalid saved item response");
      return { items, nextCursor: value.nextCursor };
    },
    async getSavedItem(projectId, connectionId, toolName, itemId) {
      const base = `/api/projects/${encodeURIComponent(projectId)}/connections/${encodeURIComponent(connectionId)}/tools/${encodeURIComponent(toolName)}/saved-items`;
      const value = await decodeResponse<unknown>(await fetch(`${base}/${encodeURIComponent(itemId)}`, { headers }));
      if (!isObject(value) || !("item" in value)) throw new Error("Invalid saved item response");
      return decodeSavedItemDetail(value.item, projectId, connectionId, toolName, itemId);
    },
    async createSavedItem(projectId, connectionId, toolName, input) {
      const base = `/api/projects/${encodeURIComponent(projectId)}/connections/${encodeURIComponent(connectionId)}/tools/${encodeURIComponent(toolName)}/saved-items`;
      const value = await decodeResponse<unknown>(await fetch(base, { method: "POST", headers, body: JSON.stringify(input) }));
      if (!isObject(value) || !("item" in value)) throw new Error("Invalid saved item response");
      const item = decodeSavedItemDetail(value.item, projectId, connectionId, toolName);
      if (item.kind !== input.kind || item.sourceRunId !== input.sourceRunId) throw new Error("Invalid saved item response");
      return item;
    },
    async deleteSavedItem(projectId, connectionId, toolName, itemId) {
      const base = `/api/projects/${encodeURIComponent(projectId)}/connections/${encodeURIComponent(connectionId)}/tools/${encodeURIComponent(toolName)}/saved-items`;
      const response = await fetch(`${base}/${encodeURIComponent(itemId)}`, { method: "DELETE", headers });
      if (!response.ok) await decodeResponse<never>(response);
    },
    async listTestCases(projectId, input = {}) {
      const search = new URLSearchParams();
      if (input.kind !== undefined) search.set("kind", input.kind);
      if (input.connectionId !== undefined) search.set("connectionId", input.connectionId);
      if (input.tag !== undefined) search.set("tag", input.tag);
      if (input.query !== undefined) search.set("query", input.query);
      if (input.cursor !== undefined) search.set("cursor", input.cursor);
      if (input.limit !== undefined) search.set("limit", String(input.limit));
      const query = search.size === 0 ? "" : `?${search.toString()}`;
      const value = await decodeResponse<unknown>(await fetch(
        `/api/projects/${encodeURIComponent(projectId)}/test-cases${query}`, { headers },
      ));
      try {
        const page = testCasePageSchema.parse(value);
        if (page.items.some((item) => item.projectId !== projectId) ||
            new Set(page.items.map(({ id }) => id)).size !== page.items.length) throw new Error();
        return page;
      } catch { throw new Error("Invalid test case response"); }
    },
    async getTestCase(projectId, testCaseId) {
      const value = await decodeResponse<unknown>(await fetch(
        `/api/projects/${encodeURIComponent(projectId)}/test-cases/${encodeURIComponent(testCaseId)}`,
        { headers },
      ));
      return decodeTestCaseEnvelope(value, projectId, testCaseId);
    },
    async createTestCase(projectId, input) {
      const value = await decodeResponse<unknown>(await fetch(
        `/api/projects/${encodeURIComponent(projectId)}/test-cases`,
        { method: "POST", headers, body: JSON.stringify(input) },
      ));
      return decodeTestCaseEnvelope(value, projectId);
    },
    async updateTestCase(projectId, testCaseId, input) {
      const value = await decodeResponse<unknown>(await fetch(
        `/api/projects/${encodeURIComponent(projectId)}/test-cases/${encodeURIComponent(testCaseId)}`,
        { method: "PATCH", headers, body: JSON.stringify(input) },
      ));
      const definition = decodeTestCaseEnvelope(value, projectId, testCaseId);
      if (definition.revision !== input.revision + 1) throw new Error("Invalid test case response");
      return definition;
    },
    async deleteTestCase(projectId, testCaseId) {
      const response = await fetch(
        `/api/projects/${encodeURIComponent(projectId)}/test-cases/${encodeURIComponent(testCaseId)}`,
        { method: "DELETE", headers },
      );
      if (!response.ok) await decodeResponse<never>(response);
    },
    async listTestSuites(projectId) {
      const value = await decodeResponse<unknown>(await fetch(
        `/api/projects/${encodeURIComponent(projectId)}/test-suites`, { headers },
      ));
      try {
        const page = testSuitePageSchema.parse(value);
        if (page.items.some((item) => item.projectId !== projectId) ||
            new Set(page.items.map(({ id }) => id)).size !== page.items.length) throw new Error();
        return page;
      } catch { throw new Error("Invalid test suite response"); }
    },
    async getTestSuite(projectId, suiteId) {
      const value = await decodeResponse<unknown>(await fetch(
        `/api/projects/${encodeURIComponent(projectId)}/test-suites/${encodeURIComponent(suiteId)}`, { headers },
      ));
      return decodeTestSuiteEnvelope(value, projectId, suiteId);
    },
    async createTestSuite(projectId, input) {
      const value = await decodeResponse<unknown>(await fetch(
        `/api/projects/${encodeURIComponent(projectId)}/test-suites`,
        { method: "POST", headers, body: JSON.stringify(input) },
      ));
      return decodeTestSuiteEnvelope(value, projectId);
    },
    async updateTestSuite(projectId, suiteId, input) {
      const value = await decodeResponse<unknown>(await fetch(
        `/api/projects/${encodeURIComponent(projectId)}/test-suites/${encodeURIComponent(suiteId)}`,
        { method: "PATCH", headers, body: JSON.stringify(input) },
      ));
      const definition = decodeTestSuiteEnvelope(value, projectId, suiteId);
      if (definition.revision !== input.revision + 1) throw new Error("Invalid test suite response");
      return definition;
    },
    async deleteTestSuite(projectId, suiteId) {
      const response = await fetch(
        `/api/projects/${encodeURIComponent(projectId)}/test-suites/${encodeURIComponent(suiteId)}`,
        { method: "DELETE", headers },
      );
      if (!response.ok) await decodeResponse<never>(response);
    },
    async startTestSuiteExecution(projectId, suiteId, idempotencyKey, input = {}) {
      const value = await decodeResponse<unknown>(await fetch(
        `/api/projects/${encodeURIComponent(projectId)}/test-suites/${encodeURIComponent(suiteId)}/executions`,
        { method: "POST", headers: { ...headers, "Idempotency-Key": idempotencyKey }, body: JSON.stringify(input) },
      ));
      return decodeTestSuiteExecutionEnvelope(value, projectId, { suiteId });
    },
    async getTestSuiteExecution(projectId, executionId) {
      const value = await decodeResponse<unknown>(await fetch(
        `/api/projects/${encodeURIComponent(projectId)}/test-suite-executions/${encodeURIComponent(executionId)}`,
        { headers },
      ));
      return decodeTestSuiteExecutionEnvelope(value, projectId, { executionId });
    },
    async cancelTestSuiteExecution(projectId, executionId) {
      await decodeResponse<unknown>(await fetch(
        `/api/projects/${encodeURIComponent(projectId)}/test-suite-executions/${encodeURIComponent(executionId)}/cancel`,
        { method: "POST", headers },
      ));
    },
    async exportAutomatedTests(projectId) {
      try {
        const envelope = automatedTestsExportEnvelopeSchema.parse(await decodeResponse<unknown>(await fetch(
          `/api/projects/${encodeURIComponent(projectId)}/automated-tests/export`, { headers },
        )));
        if (envelope.sourceProject.id !== projectId) throw new Error();
        return envelope;
      } catch { throw new Error("Invalid automated test export response"); }
    },
    async importAutomatedTests(projectId, input) {
      try {
        return importAutomatedTestsResultSchema.parse(await decodeResponse<unknown>(await fetch(
          `/api/projects/${encodeURIComponent(projectId)}/automated-tests/import`,
          { method: "POST", headers, body: JSON.stringify(input) },
        )));
      } catch { throw new Error("Invalid automated test import response"); }
    },
    async previewTestCaseFromRun(projectId, runId) {
      const value = await decodeResponse<unknown>(await fetch(
        `/api/projects/${encodeURIComponent(projectId)}/test-cases/from-run`,
        { method: "POST", headers, body: JSON.stringify({ id: runId }) },
      ));
      try {
        if (!isObject(value) || !("preview" in value)) throw new Error();
        const preview = testCaseCreationPreviewSchema.parse(value.preview);
        if (preview.definition.target.connectionId.length === 0) throw new Error();
        return preview;
      } catch { throw new Error("Invalid test case preview response"); }
    },
    async previewTestCaseFromSavedItem(projectId, savedItemId) {
      const value = await decodeResponse<unknown>(await fetch(
        `/api/projects/${encodeURIComponent(projectId)}/test-cases/from-saved-item`,
        { method: "POST", headers, body: JSON.stringify({ id: savedItemId }) },
      ));
      try {
        if (!isObject(value) || !("preview" in value)) throw new Error();
        return testCaseCreationPreviewSchema.parse(value.preview);
      } catch { throw new Error("Invalid test case preview response"); }
    },
    async startTestExecution(projectId, testCaseId, idempotencyKey, input = {}) {
      const value = await decodeResponse<unknown>(await fetch(
        `/api/projects/${encodeURIComponent(projectId)}/test-cases/${encodeURIComponent(testCaseId)}/executions`,
        { method: "POST", headers: { ...headers, "Idempotency-Key": idempotencyKey }, body: JSON.stringify(input) },
      ));
      return decodeTestExecutionEnvelope(value, projectId, { testCaseId });
    },
    async listTestExecutions(projectId, input = {}) {
      const search = new URLSearchParams();
      if (input.cursor !== undefined) search.set("cursor", input.cursor);
      if (input.limit !== undefined) search.set("limit", String(input.limit));
      const query = search.size === 0 ? "" : `?${search.toString()}`;
      try {
        const page = testExecutionReportPageSchema.parse(await decodeResponse<unknown>(await fetch(
          `/api/projects/${encodeURIComponent(projectId)}/test-executions${query}`, { headers },
        )));
        if (page.items.some((item) => item.projectId !== projectId)) throw new Error();
        return page;
      } catch { throw new Error("Invalid test execution report response"); }
    },
    async updateTestExecutionBaseline(projectId, executionId, input) {
      try {
        const result = updateTestExecutionBaselineResultSchema.parse(await decodeResponse<unknown>(await fetch(
          `/api/projects/${encodeURIComponent(projectId)}/test-executions/${encodeURIComponent(executionId)}/baseline`,
          { method: "POST", headers, body: JSON.stringify(input) },
        )));
        if (result.testCase.projectId !== projectId) throw new Error();
        return result;
      } catch { throw new Error("Invalid test execution baseline response"); }
    },
    async getTestExecution(projectId, executionId) {
      const value = await decodeResponse<unknown>(await fetch(
        `/api/projects/${encodeURIComponent(projectId)}/test-executions/${encodeURIComponent(executionId)}`,
        { headers },
      ));
      return decodeTestExecutionEnvelope(value, projectId, { executionId });
    },
    async cancelTestExecution(projectId, executionId) {
      await decodeResponse<unknown>(await fetch(
        `/api/projects/${encodeURIComponent(projectId)}/test-executions/${encodeURIComponent(executionId)}/cancel`,
        { method: "POST", headers },
      ));
    },
  };
}
