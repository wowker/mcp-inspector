import { cpSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { createProjectService } from "../project-service.js";
import { resolveDefaultMigrationsUrl } from "../project-store.js";

describe("2.0 release migration matrix", () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  it("preserves data from the published 1.0.4 schema 11 baseline", () => {
    const dataRoot = mkdtempSync(join(tmpdir(), "mcp-inspector-release-1-0-4-"));
    const migrationsRoot = mkdtempSync(join(tmpdir(), "mcp-inspector-release-1-0-4-migrations-"));
    roots.push(dataRoot, migrationsRoot);
    const sourceMigrations = resolveDefaultMigrationsUrl();
    for (const name of readdirSync(sourceMigrations).filter((entry) => /^(00[1-9]|010|011)_/u.test(entry))) {
      cpSync(new URL(name, sourceMigrations), join(migrationsRoot, name));
    }

    const legacy = createProjectService({ dataRoot, migrationsUrl: pathToFileURL(`${migrationsRoot}/`) });
    const project = legacy.create("Published 1.0.4 fixture");
    const database = legacy.open(project.id).database;
    const now = "2026-08-27T00:00:00.000Z";
    const connectionId = "00000000-0000-4000-8000-000000002101";
    const snapshotId = "00000000-0000-4000-8000-000000002102";
    const tabId = "00000000-0000-4000-8000-000000002103";
    const runId = "00000000-0000-4000-8000-000000002104";
    const variableId = "00000000-0000-4000-8000-000000002105";

    database.transaction(() => {
      database.prepare(`INSERT INTO connections
        (id, project_id, name, url, transport, auth_mode, timeout_ms, created_at, updated_at,
         headers_json, redact_sensitive_info, bearer_token)
        VALUES (?, ?, '1.0.4 Server', 'https://example.test/mcp', 'streamable-http', 'bearer',
          15000, ?, ?, '{"X-Legacy":"{{LEGACY_KEY}}"}', 1, '{{LEGACY_TOKEN}}')`)
        .run(connectionId, project.id, now, now);
      database.prepare(`INSERT INTO tool_snapshots
        (id, project_id, connection_id, tool_name, content_hash, definition_json, created_at)
        VALUES (?, ?, ?, 'legacy_lookup', ?, '{"name":"legacy_lookup","inputSchema":{"type":"object"}}', ?)`)
        .run(snapshotId, project.id, connectionId, "b".repeat(64), now);
      database.prepare(`INSERT INTO tools
        (project_id, connection_id, name, current_snapshot_id, status, updated_at)
        VALUES (?, ?, 'legacy_lookup', ?, 'current', ?)`)
        .run(project.id, connectionId, snapshotId, now);
      database.prepare(`INSERT INTO debug_tabs
        (id, project_id, connection_id, tool_name, title, position, pinned, input_mode,
         arguments_json, raw_text, view_state_json, created_at, updated_at)
        VALUES (?, ?, ?, 'legacy_lookup', 'Legacy tab', 0, 1, 'form', '{"sku":"LEGACY-1"}',
          '{"sku":"LEGACY-1"}', '{"requestPaneExpanded":true}', ?, ?)`)
        .run(tabId, project.id, connectionId, now, now);
      database.prepare(`INSERT INTO runs
        (id, project_id, connection_id, tab_id, tool_name, tool_snapshot_id, idempotency_key,
         status, created_at, started_at, completed_at, duration_ms, network_duration_ms,
         protocol_version, server_info_json, client_info_json)
        VALUES (?, ?, ?, ?, 'legacy_lookup', ?, 'legacy-run', 'succeeded', ?, ?, ?, 21, 18,
          '2025-06-18', '{"name":"legacy-fixture"}', '{"name":"inspector-1.0.4"}')`)
        .run(runId, project.id, connectionId, tabId, snapshotId, now, now, now);
      database.prepare("INSERT INTO run_requests (run_id, arguments_json, jsonrpc_json, http_json) VALUES (?, ?, ?, ?)")
        .run(runId, '{"sku":"LEGACY-1"}', '{"jsonrpc":"2.0","id":1}', '{"method":"POST"}');
      database.prepare("INSERT INTO run_responses (run_id, result_json, error_json, truncated, original_bytes) VALUES (?, ?, NULL, 0, 18)")
        .run(runId, '{"itemId":"legacy-item"}');
      database.prepare("INSERT INTO run_events (run_id, sequence, kind, occurred_at, payload_json) VALUES (?, 1, 'response', ?, ?)")
        .run(runId, now, '{"itemId":"legacy-item"}');
      database.prepare(`INSERT INTO tool_workflows
        (project_id, connection_id, tool_name, revision, before_enabled, before_source,
         after_enabled, after_source, timeout_ms, created_at, updated_at)
        VALUES (?, ?, 'legacy_lookup', 2, 1, 'ctx.log("legacy-before")', 0, '', 5000, ?, ?)`)
        .run(project.id, connectionId, now, now);
      database.prepare(`INSERT INTO environment_variables
        (id, project_id, connection_id, name, value_json, secret, created_at, updated_at)
        VALUES (?, ?, ?, 'LEGACY_KEY', '"legacy-value"', 1, ?, ?)`)
        .run(variableId, project.id, connectionId, now, now);
    })();

    const selectFixture = (current: typeof database) => ({
      connection: current.prepare("SELECT id, name, url, auth_mode, headers_json, redact_sensitive_info, bearer_token FROM connections WHERE id = ?").get(connectionId),
      tool: current.prepare("SELECT connection_id, name, current_snapshot_id, status FROM tools WHERE connection_id = ? AND name = 'legacy_lookup'").get(connectionId),
      tab: current.prepare("SELECT id, arguments_json, raw_text, view_state_json, pinned FROM debug_tabs WHERE id = ?").get(tabId),
      run: current.prepare("SELECT id, connection_id, tab_id, tool_snapshot_id, status, duration_ms FROM runs WHERE id = ?").get(runId),
      request: current.prepare("SELECT * FROM run_requests WHERE run_id = ?").get(runId),
      response: current.prepare("SELECT * FROM run_responses WHERE run_id = ?").get(runId),
      event: current.prepare("SELECT sequence, kind, occurred_at, payload_json FROM run_events WHERE run_id = ?").get(runId),
      workflow: current.prepare("SELECT revision, before_enabled, before_source, after_enabled, after_source, timeout_ms FROM tool_workflows WHERE connection_id = ? AND tool_name = 'legacy_lookup'").get(connectionId),
      variable: current.prepare("SELECT id, connection_id, name, value_json, secret FROM environment_variables WHERE id = ?").get(variableId),
    });
    expect(database.prepare("SELECT max(version) AS version FROM schema_migrations").get()).toEqual({ version: 11 });
    const before = selectFixture(database);
    legacy.close();

    const upgraded = createProjectService({ dataRoot });
    try {
      const current = upgraded.open(project.id).database;
      expect(current.prepare("SELECT max(version) AS version FROM schema_migrations").get()).toEqual({ version: 18 });
      expect(selectFixture(current)).toEqual(before);
    } finally { upgraded.close(); }
  });

  it("preserves representative schema 13 automated-test data through the 2.0 migrations", () => {
    const dataRoot = mkdtempSync(join(tmpdir(), "mcp-inspector-release-upgrade-"));
    const migrationsRoot = mkdtempSync(join(tmpdir(), "mcp-inspector-release-migrations-"));
    roots.push(dataRoot, migrationsRoot);
    const sourceMigrations = resolveDefaultMigrationsUrl();
    for (const name of readdirSync(sourceMigrations).filter((entry) => /^(00[1-9]|01[0-3])_/u.test(entry))) {
      cpSync(new URL(name, sourceMigrations), join(migrationsRoot, name));
    }

    const legacy = createProjectService({ dataRoot, migrationsUrl: pathToFileURL(`${migrationsRoot}/`) });
    const project = legacy.create("1.x release fixture");
    const database = legacy.open(project.id).database;
    const now = "2026-09-02T00:00:00.000Z";
    const connectionId = "00000000-0000-4000-8000-000000002001";
    const snapshotId = "00000000-0000-4000-8000-000000002002";
    const tabId = "00000000-0000-4000-8000-000000002003";
    const runId = "00000000-0000-4000-8000-000000002004";
    const folderId = "00000000-0000-4000-8000-000000002005";
    const variableId = "00000000-0000-4000-8000-000000002006";
    const caseId = "00000000-0000-4000-8000-000000002007";
    const revisionId = "00000000-0000-4000-8000-000000002008";
    const suiteId = "00000000-0000-4000-8000-000000002009";
    const memberId = "00000000-0000-4000-8000-000000002010";

    database.transaction(() => {
      database.prepare(`INSERT INTO connections
        (id, project_id, name, url, transport, auth_mode, timeout_ms, created_at, updated_at,
         headers_json, redact_sensitive_info, bearer_token)
        VALUES (?, ?, 'Bearer fixture', 'https://example.test/mcp', 'streamable-http', 'bearer',
          12000, ?, ?, '{"X-Release":"{{RELEASE_KEY}}"}', 1, '{{RELEASE_TOKEN}}')`)
        .run(connectionId, project.id, now, now);
      database.prepare(`INSERT INTO tool_snapshots
        (id, project_id, connection_id, tool_name, content_hash, definition_json, created_at)
        VALUES (?, ?, ?, 'lookup', ?, '{"name":"lookup","inputSchema":{"type":"object"}}', ?)`)
        .run(snapshotId, project.id, connectionId, "a".repeat(64), now);
      database.prepare(`INSERT INTO tools
        (project_id, connection_id, name, current_snapshot_id, status, updated_at)
        VALUES (?, ?, 'lookup', ?, 'current', ?)`)
        .run(project.id, connectionId, snapshotId, now);
      database.prepare(`INSERT INTO debug_tabs
        (id, project_id, connection_id, tool_name, title, position, pinned, input_mode,
         arguments_json, raw_text, view_state_json, created_at, updated_at)
        VALUES (?, ?, ?, 'lookup', 'Release tab', 0, 1, 'form', '{"sku":"A-1"}',
          '{"sku":"A-1"}', '{"requestPaneExpanded":true}', ?, ?)`)
        .run(tabId, project.id, connectionId, now, now);
      database.prepare(`INSERT INTO runs
        (id, project_id, connection_id, tab_id, tool_name, tool_snapshot_id, idempotency_key,
         status, created_at, started_at, completed_at, duration_ms, network_duration_ms,
         protocol_version, server_info_json, client_info_json)
        VALUES (?, ?, ?, ?, 'lookup', ?, 'release-run', 'succeeded', ?, ?, ?, 12, 10,
          '2025-06-18', '{"name":"fixture"}', '{"name":"inspector"}')`)
        .run(runId, project.id, connectionId, tabId, snapshotId, now, now, now);
      database.prepare("INSERT INTO run_requests (run_id, arguments_json, jsonrpc_json, http_json) VALUES (?, ?, ?, ?)")
        .run(runId, '{"sku":"A-1"}', '{"jsonrpc":"2.0","id":1}', '{"method":"POST"}');
      database.prepare("INSERT INTO run_responses (run_id, result_json, error_json, truncated, original_bytes) VALUES (?, ?, NULL, 0, 18)")
        .run(runId, '{"ok":true}');
      database.prepare("INSERT INTO run_events (run_id, sequence, kind, occurred_at, payload_json) VALUES (?, 1, 'response', ?, ?)")
        .run(runId, now, '{"ok":true}');
      database.prepare(`INSERT INTO tool_folders (id, project_id, connection_id, name, created_at, updated_at)
        VALUES (?, ?, ?, 'Release', ?, ?)`)
        .run(folderId, project.id, connectionId, now, now);
      database.prepare(`INSERT INTO tool_folder_assignments (project_id, connection_id, tool_name, folder_id)
        VALUES (?, ?, 'lookup', ?)`)
        .run(project.id, connectionId, folderId);
      database.prepare(`INSERT INTO tool_workflows
        (project_id, connection_id, tool_name, revision, before_enabled, before_source,
         after_enabled, after_source, timeout_ms, created_at, updated_at)
        VALUES (?, ?, 'lookup', 3, 1, 'ctx.log("before")', 1, 'ctx.log("after")', 5000, ?, ?)`)
        .run(project.id, connectionId, now, now);
      database.prepare(`INSERT INTO environment_variables
        (id, project_id, connection_id, name, value_json, secret, created_at, updated_at)
        VALUES (?, ?, ?, 'RELEASE_KEY', '"fixture-value"', 1, ?, ?)`)
        .run(variableId, project.id, connectionId, now, now);
      database.prepare(`INSERT INTO test_cases
        (id, project_id, kind, name, description, tags_json, revision, enabled,
         definition_json, created_at, updated_at)
        VALUES (?, ?, 'tool', 'Release smoke', 'Preserve me', '["release"]', 1, 1,
          '{"version":1}', ?, ?)`)
        .run(caseId, project.id, now, now);
      database.prepare(`INSERT INTO test_case_targets (project_id, test_case_id, connection_id, tool_name)
        VALUES (?, ?, ?, 'lookup')`)
        .run(project.id, caseId, connectionId);
      database.prepare(`INSERT INTO test_case_revisions
        (id, project_id, test_case_id, revision, definition_json, created_at)
        VALUES (?, ?, ?, 1, '{"version":1}', ?)`)
        .run(revisionId, project.id, caseId, now);
      database.prepare(`INSERT INTO test_suites
        (id, project_id, name, description, tags_json, revision, concurrency, stop_on_failure,
         created_at, updated_at)
        VALUES (?, ?, 'Release suite', '', '[]', 1, 1, 1, ?, ?)`)
        .run(suiteId, project.id, now, now);
      database.prepare(`INSERT INTO test_suite_members
        (id, project_id, suite_id, test_case_id, position, enabled)
        VALUES (?, ?, ?, ?, 0, 1)`)
        .run(memberId, project.id, suiteId, caseId);
    })();

    const before = {
      connection: database.prepare("SELECT id, name, url, auth_mode, headers_json, redact_sensitive_info, bearer_token FROM connections WHERE id = ?").get(connectionId),
      tool: database.prepare("SELECT connection_id, name, current_snapshot_id, status FROM tools WHERE connection_id = ? AND name = 'lookup'").get(connectionId),
      tab: database.prepare("SELECT id, arguments_json, raw_text, view_state_json, pinned FROM debug_tabs WHERE id = ?").get(tabId),
      run: database.prepare("SELECT id, connection_id, tab_id, tool_snapshot_id, status, duration_ms FROM runs WHERE id = ?").get(runId),
      request: database.prepare("SELECT * FROM run_requests WHERE run_id = ?").get(runId),
      response: database.prepare("SELECT * FROM run_responses WHERE run_id = ?").get(runId),
      workflow: database.prepare("SELECT revision, before_enabled, before_source, after_enabled, after_source, timeout_ms FROM tool_workflows WHERE connection_id = ? AND tool_name = 'lookup'").get(connectionId),
      variable: database.prepare("SELECT id, connection_id, name, value_json, secret FROM environment_variables WHERE id = ?").get(variableId),
      testCase: database.prepare("SELECT id, name, description, tags_json, definition_json FROM test_cases WHERE id = ?").get(caseId),
      suiteMember: database.prepare("SELECT id, suite_id, test_case_id, position, enabled FROM test_suite_members WHERE id = ?").get(memberId),
    };
    expect(database.prepare("SELECT max(version) AS version FROM schema_migrations").get()).toEqual({ version: 13 });
    legacy.close();

    const upgraded = createProjectService({ dataRoot });
    try {
      const current = upgraded.open(project.id).database;
      expect(current.prepare("SELECT max(version) AS version FROM schema_migrations").get()).toEqual({ version: 18 });
      expect({
        connection: current.prepare("SELECT id, name, url, auth_mode, headers_json, redact_sensitive_info, bearer_token FROM connections WHERE id = ?").get(connectionId),
        tool: current.prepare("SELECT connection_id, name, current_snapshot_id, status FROM tools WHERE connection_id = ? AND name = 'lookup'").get(connectionId),
        tab: current.prepare("SELECT id, arguments_json, raw_text, view_state_json, pinned FROM debug_tabs WHERE id = ?").get(tabId),
        run: current.prepare("SELECT id, connection_id, tab_id, tool_snapshot_id, status, duration_ms FROM runs WHERE id = ?").get(runId),
        request: current.prepare("SELECT * FROM run_requests WHERE run_id = ?").get(runId),
        response: current.prepare("SELECT * FROM run_responses WHERE run_id = ?").get(runId),
        workflow: current.prepare("SELECT revision, before_enabled, before_source, after_enabled, after_source, timeout_ms FROM tool_workflows WHERE connection_id = ? AND tool_name = 'lookup'").get(connectionId),
        variable: current.prepare("SELECT id, connection_id, name, value_json, secret FROM environment_variables WHERE id = ?").get(variableId),
        testCase: current.prepare("SELECT id, name, description, tags_json, definition_json FROM test_cases WHERE id = ?").get(caseId),
        suiteMember: current.prepare("SELECT id, suite_id, test_case_id, position, enabled FROM test_suite_members WHERE id = ?").get(memberId),
      }).toEqual(before);
      expect(current.prepare("SELECT count(*) AS count FROM run_events WHERE run_id = ?").get(runId)).toEqual({ count: 1 });
      expect(current.prepare("SELECT folder_id FROM tool_folder_assignments WHERE connection_id = ? AND tool_name = 'lookup'").get(connectionId))
        .toEqual({ folder_id: folderId });
    } finally {
      upgraded.close();
    }
  });
});
