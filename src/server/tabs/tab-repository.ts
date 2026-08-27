import type { ProjectStore } from "../projects/project-store.js";

export type TabInputMode = "form" | "raw";
export interface TabViewState { editorScrollTop: number; resultScrollTop: number; splitRatio: number }
export interface DebugTab {
  id: string; projectId: string; connectionId: string; toolName: string; title: string;
  position: number; pinned: boolean; inputMode: TabInputMode;
  arguments: Record<string, unknown>; rawText: string; viewState: TabViewState; lastRunId: string | null;
}

interface TabRow {
  id: string; project_id: string; connection_id: string; tool_name: string; title: string;
  position: number; pinned: number; input_mode: TabInputMode; arguments_json: string;
  raw_text: string; view_state_json: string; last_run_id: string | null;
}

function objectJson(text: string, label: string): Record<string, unknown> {
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new Error(`Stored Tab ${label} is corrupt`); }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`Stored Tab ${label} is invalid`);
  }
  return value as Record<string, unknown>;
}

function fromRow(row: TabRow): DebugTab {
  const rawView = objectJson(row.view_state_json, "view state");
  const { editorScrollTop, resultScrollTop, splitRatio } = rawView;
  if (![editorScrollTop, resultScrollTop, splitRatio].every((item) => typeof item === "number" && Number.isFinite(item)) ||
      (editorScrollTop as number) < 0 || (resultScrollTop as number) < 0 ||
      (splitRatio as number) < 0.2 || (splitRatio as number) > 0.8) {
    throw new Error("Stored Tab view state is invalid");
  }
  if (typeof row.raw_text !== "string" || typeof row.title !== "string" || row.title.length === 0 ||
      !Number.isInteger(row.position) || row.position < 0 || (row.pinned !== 0 && row.pinned !== 1) ||
      (row.input_mode !== "form" && row.input_mode !== "raw")) throw new Error("Stored Tab record is invalid");
  return { id: row.id, projectId: row.project_id, connectionId: row.connection_id,
    toolName: row.tool_name, title: row.title, position: row.position, pinned: row.pinned === 1,
    inputMode: row.input_mode, arguments: objectJson(row.arguments_json, "arguments"), rawText: row.raw_text,
    viewState: { editorScrollTop: editorScrollTop as number, resultScrollTop: resultScrollTop as number,
      splitRatio: splitRatio as number }, lastRunId: row.last_run_id };
}

const columns = `id, project_id, connection_id, tool_name, title, position, pinned,
  input_mode, arguments_json, raw_text, view_state_json, last_run_id`;

export class TabRepository {
  constructor(private readonly store: ProjectStore) {}
  list(projectId: string, connectionId: string): DebugTab[] {
    return (this.store.database.prepare(`SELECT ${columns} FROM debug_tabs
      WHERE project_id = ? AND connection_id = ? ORDER BY position, id`)
      .all(projectId, connectionId) as TabRow[]).map(fromRow);
  }
  get(projectId: string, id: string): DebugTab | null {
    const row = this.store.database.prepare(`SELECT ${columns} FROM debug_tabs WHERE project_id = ? AND id = ?`)
      .get(projectId, id) as TabRow | undefined;
    return row === undefined ? null : fromRow(row);
  }
  insert(tab: DebugTab, timestamp: string): DebugTab {
    this.store.database.prepare(`INSERT INTO debug_tabs
      (id, project_id, connection_id, tool_name, title, position, pinned, input_mode,
       arguments_json, raw_text, view_state_json, last_run_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(tab.id, tab.projectId, tab.connectionId, tab.toolName, tab.title, tab.position,
        Number(tab.pinned), tab.inputMode, JSON.stringify(tab.arguments), tab.rawText,
        JSON.stringify(tab.viewState), tab.lastRunId, timestamp, timestamp);
    return tab;
  }
  replace(tab: DebugTab, timestamp: string): DebugTab {
    this.store.database.prepare(`UPDATE debug_tabs SET connection_id = ?, tool_name = ?, title = ?,
      position = ?, pinned = ?, input_mode = ?, arguments_json = ?, raw_text = ?,
      view_state_json = ?, last_run_id = ?, updated_at = ? WHERE project_id = ? AND id = ?`)
      .run(tab.connectionId, tab.toolName, tab.title, tab.position, Number(tab.pinned), tab.inputMode,
        JSON.stringify(tab.arguments), tab.rawText, JSON.stringify(tab.viewState), tab.lastRunId,
        timestamp, tab.projectId, tab.id);
    return tab;
  }
  deleteIds(projectId: string, connectionId: string, ids: string[]): void {
    if (ids.length === 0) return;
    this.store.database.transaction(() => {
      const del = this.store.database.prepare("DELETE FROM debug_tabs WHERE project_id = ? AND connection_id = ? AND id = ?");
      for (const id of ids) del.run(projectId, connectionId, id);
      const update = this.store.database.prepare("UPDATE debug_tabs SET position = ? WHERE project_id = ? AND connection_id = ? AND id = ?");
      this.list(projectId, connectionId).forEach((tab, index) => update.run(index, projectId, connectionId, tab.id));
    })();
  }
  reorder(projectId: string, connectionId: string, ids: string[], timestamp: string): void {
    this.store.database.transaction(() => {
      const update = this.store.database.prepare("UPDATE debug_tabs SET position = ?, updated_at = ? WHERE project_id = ? AND connection_id = ? AND id = ?");
      ids.forEach((id, index) => update.run(index, timestamp, projectId, connectionId, id));
    })();
  }
}
