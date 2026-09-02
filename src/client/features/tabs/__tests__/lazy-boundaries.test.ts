import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const workspaceSource = readFileSync(
  fileURLToPath(new URL("../DebugWorkspace.tsx", import.meta.url)),
  "utf8",
);
const appSource = readFileSync(
  fileURLToPath(new URL("../../../app/App.tsx", import.meta.url)),
  "utf8",
);

describe("DebugWorkspace feature boundaries", () => {
  it("keeps definition and script editors out of the initial workspace chunk", () => {
    expect(workspaceSource).not.toMatch(/import \{ ToolDefinitionView \} from/);
    expect(workspaceSource).not.toMatch(/import \{ ScriptWorkflowView \} from/);
    expect(workspaceSource).toContain('import("./ToolDefinitionView.js")');
    expect(workspaceSource).toContain('import("./ScriptWorkflowView.js")');
  });

  it("loads the full workbench only after a project opens", () => {
    expect(appSource).not.toMatch(/import \{ InspectorWorkbench \} from/);
    expect(appSource).toContain('import("./InspectorWorkbench.js")');
  });
});
