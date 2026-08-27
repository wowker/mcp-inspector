// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { InspectorApiClient } from "../../../api/api-client.js";
import { AppToaster } from "../../../app/AppToaster.js";
import { EnvironmentVariablesPage } from "../EnvironmentVariablesPage.js";

const projectId = "00000000-0000-4000-8000-000000000901";
const connectionId = "00000000-0000-4000-8000-000000000902";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("EnvironmentVariablesPage", () => {
  it("keeps inactive scope labels legible and preserves native table-cell layout", () => {
    const css = readFileSync(resolve(process.cwd(), "src/client/features/environment/environment-variables.css"), "utf8");

    expect(css).toMatch(/\.environment-page__scope\s*>\s*button\s*\{[^}]*color:\s*var\(--ui-text\)/s);
    expect(css).not.toMatch(/\.environment-table td:nth-child\(2\)\s*\{[^}]*display:\s*flex/s);
  });

  it("manages project and Server variables without revealing secret values", async () => {
    const setEnvironmentVariable = vi.fn().mockResolvedValue({
      id: "00000000-0000-4000-8000-000000000903", projectId, connectionId: null,
      name: "REGION", secret: false, value: "eu", createdAt: "2026-08-27T00:00:00.000Z", updatedAt: "2026-08-27T00:00:00.000Z",
    });
    const api = {
      listConnections: vi.fn().mockResolvedValue([{ id: connectionId, projectId, name: "OAuth Server" }]),
      listEnvironmentVariables: vi.fn().mockImplementation(async (_projectId, owner) => owner === null ? [] : [{
        id: "00000000-0000-4000-8000-000000000904", projectId, connectionId, name: "TOKEN", secret: true,
        createdAt: "2026-08-27T00:00:00.000Z", updatedAt: "2026-08-27T00:00:00.000Z",
      }]),
      setEnvironmentVariable,
      deleteEnvironmentVariable: vi.fn(),
    } as unknown as InspectorApiClient;
    const user = userEvent.setup();
    render(<><AppToaster /><EnvironmentVariablesPage api={api} projectId={projectId} /></>);

    expect(await screen.findByRole("heading", { name: "环境变量" })).toBeVisible();
    expect(screen.getByText("{{VARIABLE_NAME}}")).toBeVisible();
    await user.type(screen.getByLabelText("环境变量名称"), "REGION");
    await user.type(screen.getByLabelText("环境变量值"), "eu");
    await user.click(screen.getByRole("button", { name: "保存变量" }));
    await waitFor(() => expect(setEnvironmentVariable).toHaveBeenCalledWith(projectId, null, "REGION", { value: "eu", secret: false }));

    await user.click(screen.getByRole("tab", { name: "Server 变量" }));
    expect(await screen.findByText("TOKEN")).toBeVisible();
    expect(screen.getByText("••••••••")).toBeVisible();
    expect(screen.queryByText(/secret/i)).not.toBeInTheDocument();
  });
});
