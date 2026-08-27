import {
  parseEnvironmentVariable,
  type EnvironmentVariable,
} from "../../shared/script-workflow.js";
import type { JsonValue } from "../../shared/tool-definition.js";
import type { ProjectStore } from "../projects/project-store.js";

interface VariableRow {
  id: string;
  project_id: string;
  connection_id: string | null;
  name: string;
  value_json: string;
  secret: number;
  created_at: string;
  updated_at: string;
}

export type StoredEnvironmentVariable = EnvironmentVariable & { storedValue: JsonValue };

function fromRow(row: VariableRow): StoredEnvironmentVariable {
  const storedValue = JSON.parse(row.value_json) as JsonValue;
  const visible = row.secret === 1
    ? {
      id: row.id, projectId: row.project_id, connectionId: row.connection_id,
      name: row.name, secret: true as const, createdAt: row.created_at, updatedAt: row.updated_at,
    }
    : {
      id: row.id, projectId: row.project_id, connectionId: row.connection_id,
      name: row.name, secret: false as const, value: storedValue,
      createdAt: row.created_at, updatedAt: row.updated_at,
    };
  return { ...parseEnvironmentVariable(visible), storedValue };
}

export interface EnvironmentMutation {
  id: string;
  connectionId: string | null;
  name: string;
  value: JsonValue;
  secret: boolean;
}

export class EnvironmentRepository {
  constructor(private readonly store: ProjectStore) {}

  list(projectId: string, connectionId: string | null): StoredEnvironmentVariable[] {
    const rows = this.store.database.prepare(`
      SELECT id, project_id, connection_id, name, value_json, secret, created_at, updated_at
      FROM environment_variables
      WHERE project_id = ? AND connection_id IS ?
      ORDER BY name COLLATE NOCASE, name, id
    `).all(projectId, connectionId) as VariableRow[];
    return rows.map(fromRow);
  }

  set(
    projectId: string,
    mutation: EnvironmentMutation,
    timestamp: string,
  ): StoredEnvironmentVariable {
    return this.store.database.transaction(() => {
      const existing = this.store.database.prepare(`
        SELECT id FROM environment_variables
        WHERE project_id = ? AND connection_id IS ? AND name = ? COLLATE NOCASE
      `).get(projectId, mutation.connectionId, mutation.name) as { id: string } | undefined;
      const valueJson = JSON.stringify(mutation.value);
      const id = existing?.id ?? mutation.id;
      if (existing === undefined) {
        this.store.database.prepare(`
          INSERT INTO environment_variables
            (id, project_id, connection_id, name, value_json, secret, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          id, projectId, mutation.connectionId, mutation.name, valueJson,
          mutation.secret ? 1 : 0, timestamp, timestamp,
        );
      } else {
        this.store.database.prepare(`
          UPDATE environment_variables
          SET name = ?, value_json = ?, secret = ?, updated_at = ?
          WHERE id = ? AND project_id = ?
        `).run(mutation.name, valueJson, mutation.secret ? 1 : 0, timestamp, id, projectId);
      }
      const row = this.store.database.prepare(`
        SELECT id, project_id, connection_id, name, value_json, secret, created_at, updated_at
        FROM environment_variables WHERE id = ? AND project_id = ?
      `).get(id, projectId) as VariableRow;
      return fromRow(row);
    })();
  }

  commit(projectId: string, mutations: EnvironmentMutation[], timestamp: string): void {
    this.store.database.transaction(() => {
      for (const mutation of mutations) this.set(projectId, mutation, timestamp);
    })();
  }

  delete(projectId: string, connectionId: string | null, name: string): boolean {
    return this.store.database.prepare(`
      DELETE FROM environment_variables
      WHERE project_id = ? AND connection_id IS ? AND name = ? COLLATE NOCASE
    `).run(projectId, connectionId, name).changes === 1;
  }
}
