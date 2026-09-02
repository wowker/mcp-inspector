// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReplayPreflight, RunDetail, RunSummary } from "../../../../shared/run-replay.js";
import { InspectorApiError, type InspectorApiClient } from "../../../api/api-client.js";
import { i18n } from "../../../i18n/index.js";
import { ReplayDialog } from "../ReplayDialog.js";

const projectId = "00000000-0000-4000-8000-000000000851";
const sourceId = "00000000-0000-4000-8000-000000000852";
const connectionId = "00000000-0000-4000-8000-000000000853";
const snapshotId = "00000000-0000-4000-8000-000000000854";
const source = {
  id: sourceId, projectId, connectionId, tabId: null, toolName: "update_item", toolSnapshotId: snapshotId,
  idempotencyKey: "source", status: "succeeded", createdAt: "2026-09-01T00:00:00.000Z",
  startedAt: "2026-09-01T00:00:00.000Z", completedAt: "2026-09-01T00:00:01.000Z",
  durationMs: 1_000, networkDurationMs: 900, pinned: false, replayedFromRunId: null,
  toolSnapshotHash: "a".repeat(64), protocolVersion: null, serverInfo: null, clientInfo: {},
  request: { arguments: { id: "source" }, jsonrpc: {}, http: null },
  response: { result: { ok: true }, error: null, truncated: false, originalBytes: 11 }, events: [],
} satisfies RunDetail;
const preflight = {
  projectId, sourceRunId: sourceId, connectionId, toolName: "update_item", arguments: { id: "source" },
  sourceToolSnapshotId: snapshotId, sourceToolSnapshotHash: "a".repeat(64),
  currentToolSnapshotId: snapshotId, currentToolSnapshotHash: "b".repeat(64), annotations: {},
  schemaChanges: [{ path: "/properties/id/type", kind: "CHANGED" }], sideEffectRisk: "UNKNOWN",
  blockers: [], requiredConfirmations: ["SCHEMA_DRIFT", "SIDE_EFFECT_RISK"], digest: "d".repeat(64),
} satisfies ReplayPreflight;
const replay = {
  ...source, id: "00000000-0000-4000-8000-000000000855", tabId: null, idempotencyKey: "replay",
  status: "queued", startedAt: null, completedAt: null, durationMs: null, networkDurationMs: null,
  replayedFromRunId: sourceId,
} satisfies RunSummary;

beforeEach(async () => {
  await i18n.changeLanguage("zh-CN");
  vi.spyOn(crypto, "randomUUID").mockReturnValue("00000000-0000-4000-8000-000000000856");
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("ReplayDialog", () => {
  it("shows immutable identity and arguments, then gates drift and risk separately", async () => {
    const getReplayPreflight = vi.fn().mockResolvedValue(preflight);
    const startReplay = vi.fn().mockResolvedValue(replay);
    const onStarted = vi.fn();
    render(<ReplayDialog api={{ getReplayPreflight, startReplay } as unknown as InspectorApiClient}
      projectId={projectId} source={source} onClose={vi.fn()} onStarted={onStarted} />);
    expect(await screen.findByText(connectionId)).toBeVisible();
    expect(screen.getByText("/properties/id/type")).toBeVisible();
    const start = screen.getByRole("button", { name: "开始回放" });
    expect(start).toBeDisabled();
    await userEvent.click(screen.getByRole("checkbox", { name: "我已检查 Schema 变化并确认继续" }));
    expect(start).toBeDisabled();
    await userEvent.click(screen.getByRole("checkbox", { name: "我已了解本次调用可能产生副作用" }));
    expect(start).toBeEnabled();
    await userEvent.click(start);
    await waitFor(() => expect(onStarted).toHaveBeenCalledWith(replay));
    expect(startReplay).toHaveBeenCalledWith(projectId, sourceId, {
      idempotencyKey: "00000000-0000-4000-8000-000000000856", preflightDigest: preflight.digest,
      confirmSchemaDrift: true, confirmSideEffects: true,
    });
  });

  it("refreshes a stale preflight, clears confirmations, and never double-starts", async () => {
    let resolveStart!: (value: RunSummary) => void;
    const pending = new Promise<RunSummary>((resolve) => { resolveStart = resolve; });
    const fresh = { ...preflight, digest: "e".repeat(64) };
    const getReplayPreflight = vi.fn().mockResolvedValueOnce(preflight).mockResolvedValueOnce(fresh);
    const startReplay = vi.fn()
      .mockRejectedValueOnce(new InspectorApiError("REPLAY_STALE_PREFLIGHT", "stale", 409))
      .mockReturnValueOnce(pending);
    render(<ReplayDialog api={{ getReplayPreflight, startReplay } as unknown as InspectorApiClient}
      projectId={projectId} source={source} onClose={vi.fn()} onStarted={vi.fn()} />);
    await screen.findByText(connectionId);
    const drift = screen.getByRole("checkbox", { name: "我已检查 Schema 变化并确认继续" });
    const risk = screen.getByRole("checkbox", { name: "我已了解本次调用可能产生副作用" });
    await userEvent.click(drift); await userEvent.click(risk); await userEvent.click(screen.getByRole("button", { name: "开始回放" }));
    await waitFor(() => expect(getReplayPreflight).toHaveBeenCalledTimes(2));
    expect(drift).not.toBeChecked(); expect(risk).not.toBeChecked();
    await userEvent.click(drift); await userEvent.click(risk);
    const start = screen.getByRole("button", { name: "开始回放" });
    await userEvent.click(start); await userEvent.click(start);
    expect(startReplay).toHaveBeenCalledTimes(2);
    resolveStart(replay);
  });

  it("discards a late start response after the dialog scope closes", async () => {
    let resolveStart!: (value: RunSummary) => void;
    const pending = new Promise<RunSummary>((resolve) => { resolveStart = resolve; });
    const safe = { ...preflight, schemaChanges: [], sideEffectRisk: "SAFE" as const, requiredConfirmations: [] };
    const onStarted = vi.fn();
    const view = render(<ReplayDialog api={{ getReplayPreflight: vi.fn().mockResolvedValue(safe),
      startReplay: vi.fn().mockReturnValue(pending) } as unknown as InspectorApiClient}
      projectId={projectId} source={source} onClose={vi.fn()} onStarted={onStarted} />);
    await screen.findByText(connectionId);
    await userEvent.click(screen.getByRole("button", { name: "开始回放" }));
    view.unmount();
    resolveStart(replay);
    await Promise.resolve();
    expect(onStarted).not.toHaveBeenCalled();
  });
});
