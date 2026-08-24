export type JsonPrimitive = null | boolean | number | string;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export interface ToolDefinition {
  name: string;
  [key: string]: JsonValue;
}

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
  updatedAt: string;
  currentSnapshot: ToolSnapshot;
}

export interface ToolDetail {
  tool: CatalogTool;
  snapshots: ToolSnapshot[];
}
