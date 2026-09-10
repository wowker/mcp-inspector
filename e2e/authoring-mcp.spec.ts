import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { startInspector } from "../dist/server/main.js";
import { startStreamableMcpServer } from "../test-support/streamable-mcp-server.js";
import { inspectorApiHeaders } from "./session.js";

interface InspectorRuntime { address: { origin: string }; close(): Promise<void> }
interface AuthoringEnvelope<T> { ok: boolean; data?: T; error?: { code: string } }

function authoringData<T>(result: { structuredContent?: unknown }): T {
  const envelope = result.structuredContent as AuthoringEnvelope<T> | undefined;
  expect(envelope?.ok).toBe(true);
  expect(envelope?.data).toBeDefined();
  return envelope!.data!;
}

async function connectAuthoring(endpoint: string, token: string): Promise<Client> {
  const client = new Client({ name: "authoring-e2e-ai-host", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(endpoint), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  });
  await client.connect(transport);
  return client;
}

test("external AI authors traceable automation through the production Authoring MCP", async ({ page, request }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1024, height: 900 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  const dataRoot = mkdtempSync(join(tmpdir(), "mcp-inspector-authoring-e2e-"));
  const audits: unknown[] = [];
  let downstream: Awaited<ReturnType<typeof startStreamableMcpServer>> | undefined;
  let inspector: InspectorRuntime | undefined;
  let authoring: Client | undefined;
  let rotatedAuthoring: Client | undefined;
  try {
    downstream = await startStreamableMcpServer({ controlCalls: true,
      expectedRequestHeaders: { "X-Tenant-Key": "alpha-secret" } });
    let browserUrl = "";
    inspector = await startInspector({ host: "127.0.0.1", port: 0, dataRoot,
      version: "3.0.0-e2e", installSignalHandlers: false,
      writeAudit: (event) => audits.push(event), openBrowser: async (url) => { browserUrl = url; } });
    await page.goto(browserUrl);
    const headers = { ...(await inspectorApiHeaders(page, inspector.address.origin)),
      "Content-Type": "application/json" };
    await page.getByLabel("项目名称").fill("Authoring E2E");
    await page.getByRole("button", { name: "创建并打开" }).click();
    const projects = await (await request.get(`${inspector.address.origin}/api/projects`, { headers })).json() as
      { projects: Array<{ id: string; name: string }> };
    const projectId = projects.projects.find(({ name }) => name === "Authoring E2E")!.id;

    const createConnection = async (name: string, tenantKey: string) => {
      const response = await request.post(`${inspector!.address.origin}/api/projects/${projectId}/connections`, {
        headers, data: { name, url: downstream!.url, transport: "streamable-http", authMode: "none",
          headers: { "X-Tenant-Key": tenantKey }, redactSensitiveInfo: true, timeoutMs: 10_000 },
      });
      expect(response.status()).toBe(201);
      return ((await response.json()) as { connection: { id: string } }).connection.id;
    };
    const alphaConnectionId = await createConnection("Authoring Alpha", "alpha-secret");
    const betaConnectionId = await createConnection("Authoring Beta", "beta-secret");
    expect((await request.post(
      `${inspector.address.origin}/api/projects/${projectId}/connections/${alphaConnectionId}/connect`,
      { headers })).status()).toBe(200);
    expect((await request.post(
      `${inspector.address.origin}/api/projects/${projectId}/connections/${betaConnectionId}/connect`,
      { headers })).status()).toBeGreaterThanOrEqual(400);
    expect((await request.post(
      `${inspector.address.origin}/api/projects/${projectId}/connections/${alphaConnectionId}/tools/refresh`,
      { headers })).status()).toBe(200);

    await page.reload();
    await expect(page.getByRole("heading", { name: "Servers", level: 1 })).toBeVisible();
    await page.getByRole("button", { name: "配置 Authoring Alpha 的 Authoring MCP 权限" }).click();
    const policyDialog = page.getByRole("dialog", { name: "Authoring MCP 权限" });
    await policyDialog.getByLabel("权限模式").selectOption("FULL_ACCESS");
    const savePolicy = policyDialog.getByRole("button", { name: "保存权限" });
    await expect(savePolicy).toBeDisabled();
    await policyDialog.getByRole("checkbox", { name: /我确认授予/ }).check();
    const safetyDisclosure = policyDialog.getByRole("button", { name: "安全限制" });
    await expect(safetyDisclosure).toHaveAttribute("aria-expanded", "false");
    await safetyDisclosure.click();
    await expect(safetyDisclosure).toHaveAttribute("aria-expanded", "true");
    const cleanupRequirement = policyDialog.getByRole("checkbox", { name: /变更操作必须配置清理步骤/ });
    if (await cleanupRequirement.isChecked()) await cleanupRequirement.uncheck();
    await savePolicy.click();
    await expect(policyDialog).toBeHidden();

    await page.getByRole("button", { name: "Authoring MCP", exact: true }).click();
    await page.getByRole("button", { name: "启用服务" }).click();
    const token = await page.locator(".authoring-token code").innerText();
    const endpoint = await page.getByLabel("Streamable HTTP 地址").inputValue();
    expect(endpoint).toBe(`${inspector.address.origin}/mcp/authoring`);
    expect(new URL(page.url()).search).not.toContain(token);
    expect((await new AxeBuilder({ page }).include(".authoring-page")
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze()).violations).toEqual([]);

    const draftsTab = page.getByRole("tab", { name: "Drafts" });
    await draftsTab.focus();
    await page.keyboard.press("ArrowRight");
    await expect(page.getByRole("tab", { name: "调用记录" })).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("ArrowLeft");
    await expect(draftsTab).toHaveAttribute("aria-selected", "true");
    await page.getByRole("button", { name: "切换到深色主题" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-color-mode", "dark");
    expect((await new AxeBuilder({ page }).include(".authoring-page")
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze()).violations).toEqual([]);
    await page.getByRole("combobox", { name: "界面语言" }).selectOption("en-US");
    await expect(page.getByRole("heading", { name: "Authoring MCP", level: 1 })).toBeVisible();
    await page.getByRole("combobox", { name: "Interface language" }).selectOption("zh-CN");
    await page.setViewportSize({ width: 720, height: 900 });
    expect(await page.locator(".authoring-workspace").evaluate((element) =>
      getComputedStyle(element).gridTemplateColumns.trim().split(/\s+/u))).toHaveLength(1);
    await page.setViewportSize({ width: 1024, height: 900 });

    authoring = await connectAuthoring(endpoint, token);
    const toolNames = (await authoring.listTools()).tools.map(({ name }) => name);
    expect(toolNames).toContain("inspector_save_draft");
    const capabilities = authoringData<{ features: { atomicApply: boolean; mandatoryRedaction: boolean } }>(
      await authoring.callTool({ name: "inspector_get_capabilities", arguments: {} }));
    expect(capabilities.features).toEqual(expect.objectContaining({ atomicApply: true, mandatoryRedaction: true }));
    const discoveredProjects = authoringData<{ items: Array<{ id: string }> }>(
      await authoring.callTool({ name: "inspector_list_projects", arguments: { limit: 100 } }));
    expect(discoveredProjects.items).toContainEqual(expect.objectContaining({ id: projectId }));
    const discoveredConnections = authoringData<{ items: Array<{ id: string }> }>(
      await authoring.callTool({ name: "inspector_list_connections", arguments: { projectId } }));
    expect(discoveredConnections.items.map(({ id }) => id)).toEqual([alphaConnectionId]);
    const tools = authoringData<{ items: Array<{ name: string; schemaHash: string }> }>(
      await authoring.callTool({ name: "inspector_list_tools",
        arguments: { projectId, connectionId: alphaConnectionId } }));
    const echo = tools.items.find(({ name }) => name === "echo")!;
    const sum = tools.items.find(({ name }) => name === "sum")!;
    expect(sum.schemaHash).toMatch(/^[0-9a-f]{64}$/u);
    const described = authoringData<{ name: string; untrusted: boolean }>(
      await authoring.callTool({ name: "inspector_describe_tool",
        arguments: { projectId, connectionId: alphaConnectionId, toolName: "sum" } }));
    expect(described).toMatchObject({ name: "sum", untrusted: true });

    const standaloneSecret = "Bearer authoring-e2e-secret";
    const standalone = authoringData<{ callId: string; runId: string; arguments: unknown; response: unknown }>(
      await authoring.callTool({ name: "inspector_call_tool", arguments: {
        projectId, connectionId: alphaConnectionId, toolName: "echo", toolSchemaHash: echo.schemaHash,
        arguments: { message: standaloneSecret }, context: { kind: "STANDALONE", label: "AI diagnosis" },
        purpose: "DIAGNOSTIC", idempotencyKey: randomUUID(),
      } }));
    expect(standalone.callId).toMatch(/[0-9a-f-]{36}/u);
    expect(standalone.runId).toMatch(/[0-9a-f-]{36}/u);
    expect(JSON.stringify(standalone)).not.toContain("authoring-e2e-secret");

    const created = authoringData<{ draftId: string; revision: number }>(
      await authoring.callTool({ name: "inspector_create_draft", arguments: {
        projectId, goal: "AI generated sum regression", idempotencyKey: randomUUID(),
      } }));
    const definition = { version: 1, testCases: [{ localId: "sum-case", kind: "tool",
      name: "AI sum case", description: "Created through Authoring MCP", tags: ["ai"],
      target: { connectionId: alphaConnectionId, toolName: "sum" }, arguments: { a: 2, b: 3 },
      assertions: [{ id: "total", source: "MCP_RESULT", path: "$.structuredContent.total",
        operator: "EQUALS", expected: 5 }], timeoutMs: 10_000 }],
      suites: [{ localId: "sum-suite", name: "AI sum suite", description: "", tags: ["ai"],
        members: [{ localId: "sum-member", testCaseLocalId: "sum-case", position: 0, isEnabled: true }],
        executionPolicy: { concurrency: 1, stopOnFailure: true } }], sourceAssets: [], evidence: [] };
    const replaced = authoringData<{ revision: number }>(
      await authoring.callTool({ name: "inspector_replace_draft", arguments: {
        projectId, draftId: created.draftId, expectedRevision: created.revision,
        goal: "AI generated sum regression", definition, idempotencyKey: randomUUID(),
      } }));
    const validation = authoringData<{ status: string; validationDigest: string }>(
      await authoring.callTool({ name: "inspector_validate_draft", arguments: {
        projectId, draftId: created.draftId, revision: replaced.revision,
      } }));
    expect(validation.status).toBe("VALID");
    const execution = authoringData<{ id: string }>(await authoring.callTool({
      name: "inspector_execute_draft", arguments: { projectId, draftId: created.draftId,
        revision: replaced.revision, validationDigest: validation.validationDigest,
        idempotencyKey: randomUUID(), inputs: {} },
    }));
    await expect.poll(() => downstream!.enteredTotals).toContain(5);
    downstream.release(5);
    await expect.poll(async () => authoringData<{ status: string }>(await authoring!.callTool({
      name: "inspector_get_draft_execution", arguments: { projectId, executionId: execution.id },
    })).status).toBe("PASSED");
    const applied = authoringData<{ assets: Array<{ kind: string; formalAssetId: string }> }>(
      await authoring.callTool({ name: "inspector_save_draft", arguments: {
        projectId, draftId: created.draftId, expectedRevision: replaced.revision,
        validationDigest: validation.validationDigest, idempotencyKey: randomUUID(),
      } }));
    expect(applied.assets).toHaveLength(2);
    const formalCase = applied.assets.find(({ kind }) => kind === "TEST_CASE")!;
    const savedCaseResponse = await request.get(
      `${inspector.address.origin}/api/projects/${projectId}/test-cases/${formalCase.formalAssetId}`, { headers });
    expect(savedCaseResponse.status()).toBe(200);
    expect((await savedCaseResponse.json()) as unknown).toMatchObject({ testCase: {
      id: formalCase.formalAssetId, name: "AI sum case", isEnabled: false,
    } });
    await page.getByRole("button", { name: "自动化测试" }).click();
    await page.getByRole("button", { name: /AI sum case/ }).click();
    await page.getByRole("button", { name: "基本信息" }).click();
    await expect(page.getByLabel("名称")).toHaveValue("AI sum case");
    await expect(page.getByRole("switch", { name: "是否启用" })).not.toBeChecked();

    const cancelDraft = authoringData<{ draftId: string; revision: number }>(
      await authoring.callTool({ name: "inspector_create_draft", arguments: {
        projectId, goal: "Cancellation proof", idempotencyKey: randomUUID(),
      } }));
    const cancelDefinition = { ...definition, testCases: [{ ...definition.testCases[0],
      localId: "cancel-case", name: "Cancellation case", arguments: { a: 40, b: 59 } }], suites: [] };
    const cancelRevision = authoringData<{ revision: number }>(
      await authoring.callTool({ name: "inspector_replace_draft", arguments: {
        projectId, draftId: cancelDraft.draftId, expectedRevision: cancelDraft.revision,
        goal: "Cancellation proof", definition: cancelDefinition, idempotencyKey: randomUUID(),
      } }));
    const cancelValidation = authoringData<{ validationDigest: string }>(
      await authoring.callTool({ name: "inspector_validate_draft", arguments: {
        projectId, draftId: cancelDraft.draftId, revision: cancelRevision.revision,
      } }));
    const cancelExecution = authoringData<{ id: string }>(await authoring.callTool({
      name: "inspector_execute_draft", arguments: { projectId, draftId: cancelDraft.draftId,
        revision: cancelRevision.revision, validationDigest: cancelValidation.validationDigest,
        idempotencyKey: randomUUID(), inputs: {} },
    }));
    await expect.poll(() => downstream!.enteredTotals).toContain(99);
    const cancelled = authoringData<{ cancelled: boolean }>(await authoring.callTool({
      name: "inspector_cancel_draft_execution", arguments: { projectId, executionId: cancelExecution.id },
    }));
    expect(cancelled.cancelled).toBe(true);
    await expect.poll(async () => authoringData<{ status: string }>(await authoring!.callTool({
      name: "inspector_get_draft_execution", arguments: { projectId, executionId: cancelExecution.id },
    })).status).toBe("CANCELLED");
    downstream.release(99);

    const secondProjectResponse = await request.post(`${inspector.address.origin}/api/projects`, {
      headers, data: { name: "Authoring isolated project" },
    });
    const secondProjectId = ((await secondProjectResponse.json()) as { project: { id: string } }).project.id;
    const crossProject = (await authoring.callTool({ name: "inspector_list_tools", arguments: {
      projectId: secondProjectId, connectionId: alphaConnectionId,
    } })).structuredContent as AuthoringEnvelope<unknown>;
    expect(crossProject).toMatchObject({ ok: false });

    const rotated = await request.post(`${inspector.address.origin}/api/authoring/settings/token`, { headers });
    const rotatedToken = ((await rotated.json()) as { token: string }).token;
    expect(rotatedToken).not.toBe(token);
    await expect(authoring.callTool({ name: "inspector_get_capabilities", arguments: {} })).rejects.toBeTruthy();
    await authoring.close().catch(() => undefined);
    authoring = undefined;
    rotatedAuthoring = await connectAuthoring(endpoint, rotatedToken);
    expect(authoringData<{ appVersion: string }>(await rotatedAuthoring.callTool({
      name: "inspector_get_capabilities", arguments: {},
    })).appVersion).toBe("3.0.0-e2e");

    const storage = await page.evaluate(() => JSON.stringify({
      local: Object.fromEntries(Object.entries(localStorage)),
      session: Object.fromEntries(Object.entries(sessionStorage)),
    }));
    for (const secret of [token, rotatedToken, "alpha-secret", "beta-secret", "authoring-e2e-secret"]) {
      expect(storage).not.toContain(secret);
      expect(JSON.stringify(audits)).not.toContain(secret);
    }
    expect(audits).toContainEqual(expect.objectContaining({ projectId, connectionId: alphaConnectionId,
      toolName: "echo", policyDecision: "ALLOWED", status: "SUCCEEDED" }));
  } finally {
    await authoring?.close().catch(() => undefined);
    await rotatedAuthoring?.close().catch(() => undefined);
    await inspector?.close();
    await downstream?.stop();
    rmSync(dataRoot, { recursive: true, force: true });
  }
});
