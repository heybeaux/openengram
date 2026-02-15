# Self-Hosted vs Cloud Mode Spec

**Status:** Draft
**Date:** 2026-02-15
**Author:** Engram Team

---

## Overview

Engram runs in two deployment modes: **Cloud** (app.openengram.ai, managed SaaS) and **Self-Hosted** (user runs locally). The dashboard and API share a single codebase that adapts behavior based on the detected mode. Self-hosted users can optionally link to OpenEngram Cloud for hybrid functionality.

## Mode Detection

The API auto-detects mode on startup:

- `DEPLOYMENT_MODE=cloud` env var → **Cloud mode**
- Otherwise → **Self-hosted mode** (default)

**Endpoint:** `GET /v1/instance/info`

```json
{
  "mode": "cloud" | "self-hosted",
  "features": {
    "localEmbeddings": true,
    "cloudEnsemble": false,
    "codeSearch": true,
    "cloudBackup": false,
    "crossDeviceSync": false,
    "billing": false
  },
  "cloudLinked": false
}
```

The dashboard calls this on load and adapts the UI accordingly. No manual configuration needed.

## Authentication

### Cloud

Standard email/password registration + JWT. Users register → select plan → payment (if paid) → dashboard.

### Self-Hosted

**First run** (no accounts exist): Setup wizard replaces the login screen.

1. **Create admin account** — email, password, name
2. **Choose mode:**
   - **Local only** — everything runs on their machine, zero cloud dependencies
   - **Connect to OpenEngram Cloud** — enter API key → unlocks cloud ensemble models, backup, cross-device sync
3. **Done** → redirect to dashboard

After the first account is created, subsequent visits show the normal login screen. Users can change their cloud connection later in Settings.

## Plans & Feature Access

### Cloud

Standard tiered plans: FREE / STARTER / PRO / SCALE. Features gated by plan level.

### Self-Hosted

**All local features are unlocked** — no plan limits, no artificial restrictions.

- All 4 local embedding models (bge-base, minilm, gte-base, nomic)
- Code Search (engram-code)
- Dream Cycle, deduplication, consolidation

**Cloud features require an OpenEngram subscription:**

- Cloud ensemble models (openai-small, openai-large, cohere-v3)
- Cloud backup
- Cross-device sync

## Hybrid Mode (Self-Hosted + Cloud Link)

Self-hosted users can link their instance to an OpenEngram cloud account. This enables:

- **Cloud backup** — back up local memories to cloud
- **Cross-device access** — view memories from other devices via cloud dashboard
- **Cloud ensemble** — use cloud models alongside local models

**Monetization path:** Free self-hosted → paid cloud subscription for premium features.

Managed in Settings → "Cloud Connection" section (enter/manage API key, view subscription status).

## Feature Matrix

| Feature | Cloud | Self-Hosted (Local) | Self-Hosted (Linked) |
|---------|-------|--------------------|--------------------|
| Auth | Email/password + JWT | Setup wizard → JWT | Same |
| Plans | FREE/STARTER/PRO/SCALE | All unlocked | All local unlocked + cloud plan |
| Local embeddings | N/A | All 4 models | All 4 models |
| Cloud ensemble | Yes (plan-gated) | No | Yes (subscription) |
| Code Search | No | Yes | Yes |
| Cloud backup | Automatic | No | Yes (subscription) |
| Cross-device sync | Yes | No | Yes (subscription) |
| Billing/Stripe | Yes | No | Via openengram.ai |
| Dream Cycle | Yes | Yes | Yes |
| Ensemble page | Cloud models only | Local models only | Both |

## Dashboard Behavior

### Sidebar

| Nav Item | Cloud | Self-Hosted | Self-Hosted (Linked) |
|----------|-------|-------------|---------------------|
| Code | Hidden | Shown | Shown |
| Billing | Shown | Hidden | Shown (links to openengram.ai) |

### Ensemble Page

- **Cloud:** Shows cloud models (openai-small, openai-large, cohere-v3) with coverage stats
- **Self-hosted:** Shows local models (bge-base, minilm, gte-base, nomic) with coverage stats
- **Self-hosted + linked:** Shows both sections

### Onboarding

- **Cloud:** Register → select plan → payment (if paid) → dashboard
- **Self-hosted first run:** Setup wizard → create account → choose mode → dashboard

### Settings

- **Self-hosted:** Additional "Cloud Connection" section — link/unlink OpenEngram account, show subscription status
- **Cloud:** No cloud connection section

## API Changes

### 1. Instance Info Endpoint

`GET /v1/instance/info` — Returns mode and feature flags. Called by dashboard on load.

### 2. Auth Service: First-Run Detection

Detect when no accounts exist in the database. When true, the auth endpoints allow the setup wizard flow (create first admin without existing auth).

### 3. Cloud Link Service

- Validate OpenEngram API key against cloud API
- Store connection config (API key, subscription status)
- Periodically refresh subscription status

## Migration

- **Existing self-hosted instances** (e.g., local dev) auto-detect as self-hosted (no `DEPLOYMENT_MODE` set)
- **Cloud instance** (Railway) must have `DEPLOYMENT_MODE=cloud` env var set

## Open Questions

- **Multi-user self-hosted:** Should self-hosted users invite others? (team/family use)
- **Rate limiting:** None for self-hosted? Configurable?
- **Auto-updates:** Mechanism for self-hosted update notifications or automatic updates?
