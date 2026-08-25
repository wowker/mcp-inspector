import { randomUUID } from "node:crypto";
import { z } from "zod";
import { ProjectNotFoundError, type ProjectService } from "../projects/project-service.js";
import { SavedItemRepository, type SavedItemDetail, type SavedItemKind, type SavedItemSummary } from "./saved-item-repository.js";

const uuid = z.string().uuid();
const name = z.string().trim().min(1).max(120);
const description = z.string().max(1000);
const toolName = z.string().trim().min(1).max(512);
const kind = z.enum(["request", "response"]);
const MAX_PAYLOAD_BYTES = 25 * 1024 * 1024;

export class SavedItemNotFoundError extends Error { constructor() { super("Saved item not found"); this.name = "SavedItemNotFoundError"; } }
export class InvalidSavedItemError extends Error { constructor(message = "Saved item payload is invalid") { super(message); this.name = "InvalidSavedItemError"; } }
export class SavedItemToolNotFoundError extends Error { constructor() { super("Tool not found"); this.name = "SavedItemToolNotFoundError"; } }

export interface CreateSavedItemInput {
  projectId: string; connectionId: string; toolName: string; kind: SavedItemKind;
  name: string; description: string; payload: unknown; sourceRunId: string | null;
}
export interface SavedItemService {
  list(projectId: string, connectionId: string, toolName: string, cursor?: string): { items: SavedItemSummary[]; nextCursor: string | null };
  get(projectId: string, id: string): SavedItemDetail;
  create(input: CreateSavedItemInput): SavedItemDetail;
  remove(projectId: string, id: string): void;
}

interface Cursor { projectId: string; connectionId: string; toolName: string; createdAt: string; id: string }
function decodeCursor(value: string | undefined, scope: Omit<Cursor, "createdAt" | "id">): { createdAt: string; id: string } | null {
  if (value === undefined) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Cursor;
    if (parsed.projectId !== scope.projectId || parsed.connectionId !== scope.connectionId || parsed.toolName !== scope.toolName ||
        typeof parsed.createdAt !== "string" || new Date(parsed.createdAt).toISOString() !== parsed.createdAt ||
        !uuid.safeParse(parsed.id).success) throw new Error();
    return { createdAt: parsed.createdAt, id: parsed.id };
  } catch { throw new InvalidSavedItemError("Saved item cursor is invalid"); }
}

function jsonText(value: unknown): string {
  let text: string | undefined;
  try { text = JSON.stringify(value); } catch { throw new InvalidSavedItemError(); }
  if (text === undefined) throw new InvalidSavedItemError();
  if (Buffer.byteLength(text, "utf8") > MAX_PAYLOAD_BYTES) throw new InvalidSavedItemError("Saved item payload is too large");
  return text;
}

function projectId(value: string): string {
  const parsed = uuid.safeParse(value); if (!parsed.success) throw new ProjectNotFoundError(); return parsed.data;
}
function connectionId(value: string): string {
  const parsed = uuid.safeParse(value); if (!parsed.success) throw new SavedItemToolNotFoundError(); return parsed.data;
}
function itemId(value: string): string {
  const parsed = uuid.safeParse(value); if (!parsed.success) throw new SavedItemNotFoundError(); return parsed.data;
}

export function createSavedItemService(projects: ProjectService, options: {
  createId?: () => string; now?: () => Date;
} = {}): SavedItemService {
  const createId = options.createId ?? randomUUID; const now = options.now ?? (() => new Date());
  const repository = (value: string) => new SavedItemRepository(projects.open(projectId(value)));
  return {
    list(rawProjectId, rawConnectionId, rawToolName, cursor) {
      const parsedProjectId = projectId(rawProjectId); const parsedConnectionId = connectionId(rawConnectionId);
      const parsedToolName = toolName.safeParse(rawToolName); if (!parsedToolName.success) throw new SavedItemToolNotFoundError();
      const repo = repository(parsedProjectId); if (!repo.hasTool(parsedProjectId, parsedConnectionId, parsedToolName.data)) throw new SavedItemToolNotFoundError();
      const scope = { projectId: parsedProjectId, connectionId: parsedConnectionId, toolName: parsedToolName.data };
      const page = repo.list(parsedProjectId, parsedConnectionId, parsedToolName.data, 100, decodeCursor(cursor, scope));
      return { items: page.items, nextCursor: page.next === null ? null : Buffer.from(JSON.stringify({ ...scope, ...page.next })).toString("base64url") };
    },
    get(rawProjectId, id) {
      const parsedProjectId = projectId(rawProjectId); const item = repository(parsedProjectId).get(parsedProjectId, itemId(id));
      if (item === null) throw new SavedItemNotFoundError();
      return item;
    },
    create(input) {
      let parsed: { projectId: string; connectionId: string; toolName: string; kind: SavedItemKind;
        name: string; description: string; sourceRunId: string | null };
      try { parsed = { projectId: uuid.parse(input.projectId), connectionId: uuid.parse(input.connectionId),
        toolName: toolName.parse(input.toolName), kind: kind.parse(input.kind), name: name.parse(input.name),
        description: description.parse(input.description), sourceRunId: input.sourceRunId === null ? null : uuid.parse(input.sourceRunId) }; }
      catch { throw new InvalidSavedItemError(); }
      if (parsed.kind === "request" && (typeof input.payload !== "object" || input.payload === null || Array.isArray(input.payload))) {
        throw new InvalidSavedItemError("Saved request payload must be a JSON object");
      }
      const payloadJson = jsonText(input.payload);
      const repo = repository(parsed.projectId);
      if (!repo.hasTool(parsed.projectId, parsed.connectionId, parsed.toolName)) throw new SavedItemToolNotFoundError();
      if (parsed.kind === "request" && parsed.sourceRunId !== null) throw new InvalidSavedItemError();
      if (parsed.sourceRunId !== null && !repo.runMatches(parsed.projectId, parsed.sourceRunId, parsed.connectionId, parsed.toolName)) {
        throw new InvalidSavedItemError("Source Run does not belong to this Tool");
      }
      const timestamp = now().toISOString(); const id = createId();
      if (!uuid.safeParse(id).success) throw new Error("Saved item ID generator returned an invalid UUID");
      return repo.insert({ ...parsed, id, payload: input.payload, createdAt: timestamp, updatedAt: timestamp }, payloadJson);
    },
    remove(rawProjectId, id) {
      const parsedProjectId = projectId(rawProjectId);
      if (!repository(parsedProjectId).remove(parsedProjectId, itemId(id))) throw new SavedItemNotFoundError();
    },
  };
}
