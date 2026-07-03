# RFC: OpenEngram Monorepo Migration

## Decision

Create a new public repository, `heybeaux/openengram`, as a controlled Engram platform monorepo.

Do not convert an existing repository in place. Existing repositories remain intact until migrated apps/services have passed build, test, deploy, and rollback parity.

## Goals

- Reduce codebase spread and cross-repo drift.
- Keep independently deployable apps and services.
- Centralize shared contracts, generated clients, CI, deployment manifests, and cross-app verification.
- Preserve existing repo history and rollback paths.

## Non-goals

- No monolith.
- No production cutover during import-only PRs.
- No deletion or archiving of old repositories during initial migration.
- No secrets, local agent files, generated artifacts, or environment files copied into this repo.

## Initial scope

P0 imports:

- `apps/dashboard` from `heybeaux/engram-dashboard`
- `apps/api` from `heybeaux/engram`

P1/P2 later imports:

- `apps/code-api` from `heybeaux/engram-code`
- `services/embed` from `heybeaux/engram-embed`
- package repos such as `engram-client`, `engram-mcp`, and `engram-channel-intelligence`

## Operating principles

1. Import-only commits stay import-only.
2. Independent deploys stay independent.
3. Source SHAs must be recorded in the manifest.
4. Path-filtered CI should avoid unnecessary builds.
5. Contract tests should prevent dashboard/API drift.
