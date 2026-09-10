import { z } from "zod";
import type { JsonObject, JsonValue } from "../tool-definition.js";
import type { AuthoringAccessMode } from "./policy.js";

export const authoringListInputSchema = z.object({
  cursor: z.string().min(1).max(2048).optional(),
  limit: z.number().int().min(1).max(100).optional().default(50),
  query: z.string().trim().max(200).optional().default(""),
}).strict();

export type AuthoringListInput = z.input<typeof authoringListInputSchema>;

export interface AuthoringPage<T> {
  items: T[];
  nextCursor: string | null;
}

export interface AuthoringProjectSummary {
  id: string;
  name: string;
  updatedAt: string;
}

export interface AuthoringConnectionSummary {
  id: string;
  projectId: string;
  name: string;
  status: string;
  authorizationStatus: string;
  protocolVersion: string | null;
  policy: {
    mode: AuthoringAccessMode;
    revision: number;
    requireCleanupForDraftMutations: boolean;
    maxCallsPerMinute: number;
    maxConcurrentCalls: number;
    maxCallDurationMs: number;
  };
  toolSnapshot: { total: number; stale: number };
}

export interface AuthoringToolSummary {
  name: string;
  title: string | null;
  description: string | null;
  schemaHash: string;
  stale: boolean;
  snapshotAt: string;
  untrusted: true;
}

export interface AuthoringToolDetail extends AuthoringToolSummary {
  inputSchema: JsonObject;
  outputSchema: JsonObject | undefined;
  annotations: JsonObject | undefined;
  execution: JsonObject | undefined;
  extensions: Record<string, JsonValue>;
}
