# Engram v1.5.0 release notes draft

> Draft only. Do not tag, publish, or create a GitHub Release from this document without explicit release approval.

Engram v1.5.0 turns the first public release into a stronger self-hosted and cloud-ready memory platform. The headline work is the local/cloud edition split, first-run registration, cloud backup plumbing, instance-level keys, row-level security hardening, and a larger reliability/test pass around dashboard and memory APIs.

## Highlights

- **Self-hosted first-run setup** — adds setup-status and registration flows so new local installs can bootstrap through supported API/dashboard paths instead of manual database edits.
- **Local/cloud edition split** — introduces edition-aware configuration and CI so local-only deployments can stay simple while cloud/hybrid surfaces keep their own guardrails.
- **Cloud backup and migration foundations** — adds import/export APIs, cloud-link services, push-only cloud sync, content hashing, and instance sync keys for hybrid self-hosted ↔ cloud workflows.
- **Production auth and tenancy hardening** — adds multi-tenant accounts, usage limits, stricter auth guards, local-only LAN trust behavior, instance-level API keys, and RLS enablement across core tables.
- **Dashboard/API reliability** — fixes dashboard stats, JWT user resolution, default-agent resolution for instance keys, sync/admin transaction timeouts, CORS for local dashboard ports, and Railway build generation.
- **Memory and search improvements** — adds cloud ensemble embedding support, 5W extraction improvements, storage/embedding abstractions, git intelligence ingestion, and event/webhook infrastructure.
- **CI and test coverage** — splits local/cloud workflows, adds GitHub Actions hardening, and expands tests across auth guards, dashboard, account/admin/plan-limits, feedback, memory pipeline, Dream Cycle, and generate-context paths.

## Upgrade notes

- Use `pnpm run migrate:deploy` or `pnpm run migrate:safe` for existing/shared databases. Do **not** run `prisma migrate dev` or `prisma migrate reset` against real data.
- Review `EDITION`, local trust, CORS, cloud sync, and instance-key environment variables before promoting a deployment.
- Run the local and cloud CI workflows before cutting the release artifact.
- Verify self-hosted quickstart, first-run registration, `/v1/health`, and dashboard setup wizard against a clean database.

## Release checklist before publishing

- [ ] Confirm `staging` is the intended source for the release branch.
- [ ] Confirm all required CI checks are green.
- [ ] Confirm the release tag target SHA.
- [ ] Confirm package publishing scope, if any. The root API service has OSS metadata, but the package intentionally remains `private: true` until a package allowlist/scope is approved.
- [ ] Create the GitHub Release/tag only after explicit approval.
- [ ] Publish npm packages only after explicit approval.

## Evidence used for this draft

- Existing `v1.5.0` git tag target: `be41d6e` (`release: v1.5.0 — cloud sync, RLS, instance keys, auth guards, dashboard fixes`)
- `git log --first-parent v1.0.0..v1.5.0`
- Current `CHANGELOG.md` and root `package.json`
