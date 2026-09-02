export type { JsonPrimitive, JsonValue, ToolDefinition } from "../../shared/tool-definition.js";
import type { ToolDefinition } from "../../shared/tool-definition.js";

export type ToolStatus = "current" | "changed" | "removed";

export interface ToolSnapshot {
  id: string;
  projectId: string;
  connectionId: string;
  toolName: string;
  contentHash: string;
  definition: ToolDefinition;
  createdAt: string;
}

export interface CatalogTool {
  projectId: string;
  connectionId: string;
  name: string;
  status: ToolStatus;
  folderId: string | null;
  favorite: boolean;
  lastUsedAt: string | null;
  updatedAt: string;
  currentSnapshot: ToolSnapshot;
}

export interface ToolFolder {
  id: string;
  projectId: string;
  connectionId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface ToolDetail {
  tool: CatalogTool;
  snapshots: ToolSnapshot[];
}
