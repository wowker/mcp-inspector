export type ConnectionStatus = "disconnected" | "connecting" | "connected" | "failed";

export interface ConnectionError {
  code: string;
  message: string;
}

export interface ConnectionRecord {
  id: string;
  projectId: string;
  name: string;
  url: string;
  transport: "streamable-http";
  authMode: "none";
  timeoutMs: number;
  status: ConnectionStatus;
  lastProtocolVersion: string | null;
  lastServerInfo: Record<string, unknown> | null;
  lastError: ConnectionError | null;
}

export interface CreateConnectionInput {
  name: string;
  url: string;
  transport: "streamable-http";
  authMode: "none";
  timeoutMs: number;
}

export type UpdateConnectionInput = Partial<Pick<CreateConnectionInput,
  "name" | "url" | "timeoutMs">>;
