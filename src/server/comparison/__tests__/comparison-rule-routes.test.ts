import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../../app.js";
import { createProjectService } from "../../projects/project-service.js";

describe("comparison rule routes", () => {
  const roots: string[] = [];
  afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

  it("inherits session auth and returns stable validation errors", async () => {
    const root = mkdtempSync(join(tmpdir(), "mcp-inspector-comparison-routes-"));
    roots.push(root);
    const projects = createProjectService({ dataRoot: root });
    const projectId = projects.create("Comparison routes").id;
    const app = createApp({
      sessionToken: "session", allowedOrigin: "http://127.0.0.1:5173", version: "1", projects,
    });
    const headers = { Origin: "http://127.0.0.1:5173", "X-MCP-Inspector-Session": "session" };
    const url = `/api/projects/${projectId}/comparison-rules`;
    try {
      expect((await app.request(url)).status).toBe(401);
      const saved = await app.request(url, {
        method: "PUT", headers, body: JSON.stringify({ expressions: ["$.requestId"] }),
      });
      expect(saved.status).toBe(200);
      const savedBody = await saved.json();
      expect(savedBody).toEqual({ rules: [expect.objectContaining({
        projectId, expression: '$["requestId"]', position: 0,
      })] });
      expect(await (await app.request(url, { headers })).json()).toEqual(savedBody);
      const invalid = await app.request(url, {
        method: "PUT", headers, body: JSON.stringify({ expressions: ["$..secret"] }),
      });
      expect(invalid.status).toBe(400);
      expect(await invalid.json()).toEqual({ error: {
        code: "COMPARISON_RULES_INVALID", message: "Comparison ignore rules are invalid",
      } });
    } finally { projects.close(); }
  });
});
