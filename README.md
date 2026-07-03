# OpenEngram

OpenEngram is the platform monorepo for Engram apps, services, packages, contracts, deployment manifests, and cross-application verification.

This repository is being introduced as a controlled consolidation target. Existing Engram repositories remain the source of production deployments until each app/service has been imported, validated, and explicitly cut over.

## Current migration scope

Initial scope:

- `apps/dashboard` — from `heybeaux/engram-dashboard`
- `apps/api` — from `heybeaux/engram`
- shared contracts and cross-app verification foundations

Later scope:

- `apps/code-api`
- `services/embed`
- package repos such as client, MCP, and channel intelligence

## Rules

- Monorepo, not monolith.
- Independent deploys stay independent.
- Import commits must avoid product changes.
- Existing repos stay intact until parity and cutover are proven.
- Source repo, branch, SHA, and import mode must be recorded in `docs/migration/source-manifest.md`.
