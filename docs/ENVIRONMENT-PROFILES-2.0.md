# Environment Profiles 2.0 contract

## Status

Tasks 16A, 16B and 16C implemented. This document is the source of truth for profile persistence, resolution, management, active selection, safe connection preview and secret-safe Server export.

## Compatibility

- Existing project and Server variables remain the implicit base layer.
- Calling the existing environment resolver without a profile is unchanged.
- A profile is selected by stable `profileId`; names are labels and are never identity keys.
- Authentication and Server-scoped values remain fenced by `projectId + connectionId`.

## Model

A project owns zero or more named profiles. A profile may inherit from one parent in the same project. The maximum resolved chain is eight profiles. Cross-project parents, missing parents, cycles, and deeper chains are rejected.

Each profile may define project-scoped overrides and connection-scoped Server overrides. An override is one of:

- `value`: replace the inherited value and its secret classification.
- `unset`: explicitly remove an inherited/base value at that scope.

Secret values are stored using the same local SQLite policy as existing environment variables, but public profile-variable responses omit their values.

## Deterministic resolution

Resolution applies layers in this order:

1. Existing project variables.
2. Existing variables for the exact connection ID.
3. Parent profile project overrides, from oldest ancestor to child.
4. Parent profile Server overrides for the exact connection ID, from oldest ancestor to child.

Project and Server maps remain separate. When a template is evaluated, the Server map wins over the project map, preserving the existing behavior. Secret provenance is also scope-aware: a public Server value that shadows a secret project value is treated as public, while a secret Server value remains secret.

The resolver returns the ordered profile chain and per-variable source metadata. Task 16B may render that metadata, but must not expose secret values in ordinary list or preview responses.

## Persistence

Migration `016_environment_profiles.sql` adds:

- `environment_profiles`
- `environment_profile_variables`

Migration `017_connection_environment_profiles.sql` stores the active Profile for an exact
`projectId + connectionId`. A connected or connecting Server must be disconnected before this
selection can change, so an existing MCP session never changes authentication or environment
mid-flight.

Released migrations 001–015 are not modified. Deleting a connection removes only its profile-scoped Server overrides. Deleting a profile removes its own overrides; a profile with children is protected until the children are reassigned or removed.

## Management and runtime behavior

- The Environment page provides bilingual Profile CRUD, inheritance, project/Server overrides,
  safe preview and active selection.
- Preview responses omit secret values and show scope, source Profile, inheritance chain and
  missing Header/Bearer variable references.
- Connection authentication and workflow script reads use the active Profile for the exact
  connection ID. Workflow commits continue to use the legacy base variable store; scripts do not
  silently rewrite Profile definitions.
- With no active Profile, connection and script behavior is byte-for-byte compatible with the
  legacy resolver.

## Server export compatibility

- Server export version 2 adds base environment variables, Profile definitions, inheritance,
  current-connection overrides and the exact connection's active Profile.
- Project variables are included once as the legacy-compatible base layer. Server variables and
  Profile Server overrides are limited to the exported connection ID.
- Public values are included. Secret entries contain only their name, scope and
  `redacted: true`; secret values are never added to the export object.
- The client continues to accept historical version 1 bundles and strictly validates the version
  2 environment section before creating a download.
- Server export remains a one-way diagnostic/backup artifact. Importing a complete Server bundle
  is not an exposed operation, so no ambiguous identity remapping or implicit secret restoration
  occurs.
