# Staging Smoke Test Checklist

Run after every staging deploy (backend or dashboard).

## Automated (API)

Run the automated script first:

```bash
./scripts/smoke-test.sh https://staging-api.openengram.ai
```

## Manual (UI)

Open [staging.openengram.ai](https://staging.openengram.ai) and verify:

- [ ] **Health** — `/v1/health` returns healthy
- [ ] **Login** — Login flow completes, redirects to dashboard
- [ ] **Memories** — Memories page shows data (not empty)
- [ ] **Graph** — Graph page renders without errors
- [ ] **Identity overview** — Loads list of agents
- [ ] **Identity agent detail** — Clicking an agent shows detail view
- [ ] **Contracts** — Contracts page loads
- [ ] **Challenges** — Challenges page loads
- [ ] **Teams** — Teams page loads
- [ ] **Trust profiles** — Trust profiles load
- [ ] **Search** — Search returns results for a known query
- [ ] **Settings** — Settings page loads and is editable
- [ ] **Sync status** — Sync status page loads
- [ ] **Mobile nav** — Resize to mobile width; nav matches desktop routes
