# Cutover Parity Plan

This document tracks what must be true before `heybeaux/openengram` becomes the canonical repository for Engram apps, packages, and services.

The migration rule is simple: import and integrate first; cut over deploys only after parity is proven; archive legacy repositories only after rollback paths are understood.

## Current integration state

| Surface              | Monorepo path                   | Source repo                            | Workspace/CI status                                                                                                                                    | Current cutover state                                                                  |
| -------------------- | ------------------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| Dashboard            | `apps/dashboard`                | `heybeaux/engram-dashboard`            | Root pnpm workspace; `dashboard` workflow runs Turbo lint/test/build                                                                                   | Imported and CI-covered; deployment cutover still needs platform config verification   |
| Core API/runtime     | `apps/api`                      | `heybeaux/engram` (`staging`)          | Root pnpm workspace; `api` workflow runs build and DB-backed test subset                                                                               | Imported and CI-covered; production/staging deploy parity still needs verification     |
| Client package       | `packages/client-js`            | `heybeaux/engram-client`               | Root pnpm workspace; package lint/typecheck/test plus contract tests                                                                                   | Imported; package publishing/canonical-source cutover still needs release plan         |
| MCP package          | `packages/mcp`                  | `heybeaux/engram-mcp`                  | Root pnpm workspace; package lint/typecheck/test plus contract tests                                                                                   | Imported; package publishing/canonical-source cutover still needs release plan         |
| Channel intelligence | `packages/channel-intelligence` | `heybeaux/engram-channel-intelligence` | Root pnpm workspace; smoke test plus contract tests                                                                                                    | Imported; package publishing/canonical-source cutover still needs release plan         |
| Code API             | `apps/code-api`                 | `heybeaux/engram-code`                 | Root pnpm workspace; `code-api` workflow runs pgvector-backed Prisma migrate, Turbo lint/typecheck/build/test, and nested dashboard build/test         | Integrated; deployment cutover still needs Railway/project config parity               |
| Embed service        | `services/embed`                | `heybeaux/engram-embed`                | Dedicated Rust workflow on macOS: `cargo fmt --check`, `cargo check --locked --all-targets`, `cargo test --locked`; intentionally outside JS workspace | Integrated; deployment/runtime cutover still needs service config and model-cache plan |

## CI coverage matrix

| Workflow    | Scope                 | Trigger paths                                          | What it proves                                                                                    | Intentional gaps                                                                     |
| ----------- | --------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `ci`        | Root/package baseline | All PRs and pushes to `main`                           | Root install, formatting, package lint/typecheck/test, route contract tests                       | App-level checks are delegated to app workflows to keep this job service-free        |
| `dashboard` | `apps/dashboard`      | Dashboard, packages, lockfile/workspace/Turbo/workflow | Next/Vitest/Turbo dashboard lane                                                                  | Does not deploy; no production smoke                                                 |
| `api`       | `apps/api`            | Core API, packages, lockfile/workspace/Turbo/workflow  | Prisma generate, Nest build, pgvector/Redis-backed DB migrations and test subset                  | API lint/typecheck is still not fully normalized; test excludes known heavy lanes    |
| `code-api`  | `apps/code-api`       | Code API and workflow                                  | Prisma generate/migrate on pgvector, Turbo lint/typecheck/build/test, nested dashboard build/test | Unsafe-any lint debt is warning-level; nested dashboard remains a nested import lane |
| `embed`     | `services/embed`      | Embed service and workflow                             | Rust fmt/check/test on macOS with locked Cargo dependencies                                       | Model-download/server tests are ignored by default; no deployment smoke              |

## Cutover gates

### Global gates

Before any legacy repository is archived or marked read-only:

1. Monorepo `main` is green across all workflows after the relevant integration PRs.
2. The corresponding legacy repository has a final source SHA recorded in `docs/migration/source-manifest.md`.
3. Deployment platform can build from the monorepo subdirectory without secret drift.
4. Rollback is documented: which legacy repo/branch/SHA remains deployable and how to point the platform back at it.
5. Ownership is clear: one canonical repo for new changes, with legacy repos either read-only or explicitly labelled as pre-monorepo archives.

### Dashboard cutover gates

- Confirm Vercel/project config can build from `apps/dashboard` in `heybeaux/openengram`.
- Confirm environment variables match the current `engram-dashboard` production/staging projects.
- Run the dashboard workflow on the cutover commit.
- Run a production-safe page-walk smoke after deployment.
- Keep the previous dashboard deployment/repo available for rollback until at least one production deploy cycle is clean.

### Core API cutover gates

- Confirm the deployment platform can build from `apps/api` and run the existing Dockerfile/start command.
- Confirm production/staging database, Redis, vector extension, and secrets are unchanged.
- Run Prisma migration status/deploy against the intended staging environment before production.
- Run the `api` workflow and any release-specific smoke tests.
- Keep the `heybeaux/engram` production/staging branches available for rollback until the monorepo deployment has survived a release cycle.

### Code API cutover gates

- Confirm Railway/project config can build from `apps/code-api` and use the correct Dockerfile/start command.
- Confirm `DATABASE_URL`, model/provider secrets, repository access secrets, and any webhook URLs are present in the monorepo-backed deployment.
- Run the `code-api` workflow on the cutover commit.
- Run a staging smoke that exercises project discovery/ingest without relying on local-only paths.
- Decide whether the nested dashboard under `apps/code-api/apps/dashboard` remains nested during cutover or is split/deferred.

### Embed service cutover gates

- Decide the first target runtime: local Mac service, Docker service, or managed deployment.
- Confirm model cache location, warm-start behavior, and disk requirements.
- Run the `embed` workflow on the cutover commit.
- Run at least one model-backed smoke outside CI if the target deploy needs real embeddings, because CI intentionally skips model-download tests.
- Document fallback behavior for callers if local embeddings are unavailable.

### Packages cutover gates

For `packages/client-js`, `packages/mcp`, and `packages/channel-intelligence`:

- Decide whether npm publishing should happen from the monorepo immediately or after one more legacy release.
- Confirm package names, versions, package files, and README/source links point at the canonical repo.
- Run package lint/typecheck/test and `pnpm test:contracts`.
- Publish dry-run from the monorepo before the first real publish.
- After publishing from the monorepo, label legacy package repos as archived sources or mirror-only.

## Known deferred cleanup

- `apps/api` still has mutating `lint` and does not yet have a clean app-level lint/typecheck lane in monorepo CI.
- `apps/code-api` lint allows imported unsafe-any debt as warnings to avoid a noisy fake cleanup PR.
- `apps/code-api/apps/dashboard` remains nested and separately installed/tested.
- `services/embed` has warning-only Rust cleanup and ignored model/server tests in default CI.
- Production deploy configs are not yet represented as shared monorepo infrastructure-as-code.

## Recommended next PRs

1. Add deployment notes/manifests for each app/service, starting with the current production platform and subdirectory build command.
2. Normalize `apps/api` scripts the same way `apps/code-api` was normalized: non-mutating lint, explicit typecheck, and warning/debt policy if needed.
3. Add package publish dry-run CI for changed packages.
4. Add a production-safe dashboard/API smoke script that can run after monorepo-backed deployments.
