import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

describe("Authoring shutdown and restart orchestration", () => {
  it("rejects new Authoring work before cancelling executions and settling calls", () => {
    const source = readFileSync(fileURLToPath(new URL("../../main.ts", import.meta.url)), "utf8");
    const rejectNew = source.indexOf("authoringMcp.beginShutdown()");
    const cancelDrafts = source.indexOf("await authoringDraftExecutions.close()");
    const settleCalls = source.indexOf("await authoringCalls.close?.()");
    const closeSessions = source.indexOf("await authoringMcp.close()");
    const closeRuns = source.indexOf("await runs.close()");
    expect([rejectNew, cancelDrafts, settleCalls, closeSessions, closeRuns].every((index) => index >= 0)).toBe(true);
    expect(rejectNew).toBeLessThan(cancelDrafts);
    expect(cancelDrafts).toBeLessThan(settleCalls);
    expect(settleCalls).toBeLessThan(closeSessions);
    expect(closeSessions).toBeLessThan(closeRuns);
  });
});
