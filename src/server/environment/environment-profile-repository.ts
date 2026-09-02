import {
  parseEnvironmentProfile,
  parseEnvironmentProfileVariable,
  type EnvironmentProfile,
  type EnvironmentProfileMutation,
  type EnvironmentProfileVariable,
  type EnvironmentProfileVariableMutation,
} from "../../shared/environment-profile.js";
import type { JsonValue } from "../../shared/tool-definition.js";
import type { ProjectStore } from "../projects/project-store.js";

interface ProfileRow {
  id: string;
  project_id: string;
  name: string;
  description: string;
  parent_profile_id: string | null;
  revision: number;
  created_at: string;
  updated_at: string;
}

interface ProfileVariableRow {
  id: string;
  project_id: string;
  profile_id: string;
  connection_id: string | null;
  name: string;
  mode: "value" | "unset";
  value_json: string | null;
  secret: number;
  created_at: string;
  updated_at: string;
}

export type StoredProfileVariable = EnvironmentProfileVariable & {
  storedValue?: JsonValue;
};

function profileFromRow(row: ProfileRow): EnvironmentProfile {
  return parseEnvironmentProfile({
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    description: row.description,
    parentProfileId: row.parent_profile_id,
    revision: row.revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function variableFromRow(row: ProfileVariableRow): StoredProfileVariable {
  const common = {
    id: row.id,
    projectId: row.project_id,
    profileId: row.profile_id,
    connectionId: row.connection_id,
    name: row.name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  if (row.mode === "unset") {
    return parseEnvironmentProfileVariable({
      ...common, mode: "unset", secret: false,
    });
  }
  const storedValue = JSON.parse(row.value_json!) as JsonValue;
  const visible = row.secret === 1
    ? { ...common, mode: "value" as const, secret: true as const }
    : { ...common, mode: "value" as const, secret: false as const, value: storedValue };
  return { ...parseEnvironmentProfileVariable(visible), storedValue };
}

export class EnvironmentProfileRepository {
  constructor(private readonly store: ProjectStore) {}

  list(projectId: string): EnvironmentProfile[] {
    return (this.store.database.prepare(`
      SELECT id, project_id, name, description, parent_profile_id, revision, created_at, updated_at
      FROM environment_profiles
      WHERE project_id = ?
      ORDER BY name COLLATE NOCASE, name, id
    `).all(projectId) as ProfileRow[]).map(profileFromRow);
  }

  get(projectId: string, profileId: string): EnvironmentProfile | undefined {
    const row = this.store.database.prepare(`
      SELECT id, project_id, name, description, parent_profile_id, revision, created_at, updated_at
      FROM environment_profiles WHERE project_id = ? AND id = ?
    `).get(projectId, profileId) as ProfileRow | undefined;
    return row === undefined ? undefined : profileFromRow(row);
  }

  create(
    projectId: string,
    id: string,
    input: EnvironmentProfileMutation,
    timestamp: string,
  ): EnvironmentProfile {
    this.store.database.prepare(`
      INSERT INTO environment_profiles
        (id, project_id, name, description, parent_profile_id, revision, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 1, ?, ?)
    `).run(id, projectId, input.name, input.description, input.parentProfileId, timestamp, timestamp);
    return this.get(projectId, id)!;
  }

  update(
    projectId: string,
    profileId: string,
    revision: number,
    input: EnvironmentProfileMutation,
    timestamp: string,
  ): EnvironmentProfile | undefined {
    const result = this.store.database.prepare(`
      UPDATE environment_profiles
      SET name = ?, description = ?, parent_profile_id = ?,
          revision = revision + 1, updated_at = ?
      WHERE project_id = ? AND id = ? AND revision = ?
    `).run(
      input.name, input.description, input.parentProfileId, timestamp,
      projectId, profileId, revision,
    );
    return result.changes === 1 ? this.get(projectId, profileId) : undefined;
  }

  delete(projectId: string, profileId: string): boolean {
    return this.store.database.prepare(`
      DELETE FROM environment_profiles WHERE project_id = ? AND id = ?
    `).run(projectId, profileId).changes === 1;
  }

  listVariables(
    projectId: string,
    profileId: string,
    connectionId: string | null,
  ): StoredProfileVariable[] {
    return (this.store.database.prepare(`
      SELECT id, project_id, profile_id, connection_id, name, mode, value_json,
             secret, created_at, updated_at
      FROM environment_profile_variables
      WHERE project_id = ? AND profile_id = ? AND connection_id IS ?
      ORDER BY name COLLATE NOCASE, name, id
    `).all(projectId, profileId, connectionId) as ProfileVariableRow[]).map(variableFromRow);
  }

  setVariable(
    projectId: string,
    profileId: string,
    connectionId: string | null,
    name: string,
    id: string,
    input: EnvironmentProfileVariableMutation,
    timestamp: string,
  ): StoredProfileVariable {
    const existing = this.store.database.prepare(`
      SELECT id FROM environment_profile_variables
      WHERE project_id = ? AND profile_id = ? AND connection_id IS ? AND name = ? COLLATE NOCASE
    `).get(projectId, profileId, connectionId, name) as { id: string } | undefined;
    const targetId = existing?.id ?? id;
    const valueJson = input.mode === "value" ? JSON.stringify(input.value) : null;
    const secret = input.mode === "value" && input.secret ? 1 : 0;
    if (existing === undefined) {
      this.store.database.prepare(`
        INSERT INTO environment_profile_variables
          (id, project_id, profile_id, connection_id, name, mode, value_json, secret, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        targetId, projectId, profileId, connectionId, name, input.mode,
        valueJson, secret, timestamp, timestamp,
      );
    } else {
      this.store.database.prepare(`
        UPDATE environment_profile_variables
        SET name = ?, mode = ?, value_json = ?, secret = ?, updated_at = ?
        WHERE project_id = ? AND id = ?
      `).run(name, input.mode, valueJson, secret, timestamp, projectId, targetId);
    }
    const row = this.store.database.prepare(`
      SELECT id, project_id, profile_id, connection_id, name, mode, value_json,
             secret, created_at, updated_at
      FROM environment_profile_variables WHERE project_id = ? AND id = ?
    `).get(projectId, targetId) as ProfileVariableRow;
    return variableFromRow(row);
  }

  deleteVariable(
    projectId: string,
    profileId: string,
    connectionId: string | null,
    name: string,
  ): boolean {
    return this.store.database.prepare(`
      DELETE FROM environment_profile_variables
      WHERE project_id = ? AND profile_id = ? AND connection_id IS ? AND name = ? COLLATE NOCASE
    `).run(projectId, profileId, connectionId, name).changes === 1;
  }

  getActiveProfileId(projectId: string, connectionId: string): string | null {
    const row = this.store.database.prepare(`
      SELECT profile_id FROM connection_environment_profiles
      WHERE project_id = ? AND connection_id = ?
    `).get(projectId, connectionId) as { profile_id: string } | undefined;
    return row?.profile_id ?? null;
  }

  isProfileActive(projectId: string, profileId: string): boolean {
    return this.store.database.prepare(`
      SELECT 1 FROM connection_environment_profiles
      WHERE project_id = ? AND profile_id = ? LIMIT 1
    `).get(projectId, profileId) !== undefined;
  }

  setActiveProfileId(
    projectId: string,
    connectionId: string,
    profileId: string | null,
    timestamp: string,
  ): void {
    if (profileId === null) {
      this.store.database.prepare(`
        DELETE FROM connection_environment_profiles
        WHERE project_id = ? AND connection_id = ?
      `).run(projectId, connectionId);
      return;
    }
    this.store.database.prepare(`
      INSERT INTO connection_environment_profiles
        (project_id, connection_id, profile_id, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(project_id, connection_id) DO UPDATE SET
        profile_id = excluded.profile_id,
        updated_at = excluded.updated_at
    `).run(projectId, connectionId, profileId, timestamp);
  }
}
