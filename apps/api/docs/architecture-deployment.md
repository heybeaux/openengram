# Deployment Architecture

Mode detection, feature gating, cloud link, and backup sync — added in HEY-63 through HEY-68. For core system architecture (modules, embedding pipeline, Dream Cycle), see [ARCHITECTURE.md](./ARCHITECTURE.md).

---

## Mode Detection

Engram auto-detects its deployment mode on startup:

```
DEPLOYMENT_MODE env var set to "cloud"?
  ├─ Yes → Cloud mode (SaaS at app.openengram.ai)
  └─ No  → Self-hosted mode (default)
```

The mode is exposed via `GET /v1/instance/info` and determines which features are available. The dashboard calls this endpoint on load and adapts the UI — no manual configuration needed.

### Flow

1. API starts → reads `DEPLOYMENT_MODE` env var
2. Resolves feature flags based on mode + cloud link status
3. Dashboard fetches `/v1/instance/info` → adapts sidebar, onboarding, settings

---

## Feature Gating

Features are gated by deployment mode and (for self-hosted) whether the instance is linked to cloud.

| Feature | Cloud | Self-Hosted | Self-Hosted + Linked |
|---------|-------|-------------|---------------------|
| Local embeddings (4 models) | N/A | ✅ | ✅ |
| Cloud ensemble models | Plan-gated | ❌ | ✅ (subscription) |
| Code Search | ❌ | ✅ | ✅ |
| Cloud backup | Automatic | ❌ | ✅ (subscription) |
| Cross-device sync | ✅ | ❌ | ✅ (subscription) |
| Billing / Stripe | ✅ | ❌ | Via openengram.ai |
| Dream Cycle | ✅ | ✅ | ✅ |
| Ensemble search (RRF) | Cloud models | Local models | Both |

**Self-hosted unlocks all local features with no plan limits.** Cloud features require an OpenEngram subscription, accessed by linking your instance.

### Dashboard Adaptations

- **Sidebar:** Code Search shown only in self-hosted; Billing shown in cloud and linked self-hosted
- **Ensemble page:** Shows local models (self-hosted), cloud models (cloud), or both (linked)
- **Settings:** Self-hosted shows "Cloud Connection" section; cloud does not
- **Onboarding:** Cloud shows registration flow; self-hosted shows setup wizard on first run

---

## Cloud Link Architecture

Self-hosted instances can link to OpenEngram Cloud for premium features.

### Linking Flow

1. User enters their OpenEngram Cloud API key in **Settings → Cloud Connection**
2. API validates the key against `POST /v1/cloud/link` → cloud API confirms validity + subscription tier
3. Connection config (API key, subscription status) is stored locally (encrypted with `ENCRYPTION_KEY`)
4. Feature flags update to reflect linked status

### Ongoing

- **Subscription refresh:** `POST /v1/cloud/refresh` periodically checks subscription status against cloud
- **Unlinking:** `DELETE /v1/cloud/link` removes the connection and reverts to local-only mode
- **Status check:** `GET /v1/cloud/status` returns current link status and subscription details

### Security

- Cloud API key is encrypted at rest using `ENCRYPTION_KEY`
- Key validation happens server-side only — never exposed to the browser
- Unlinking immediately revokes cloud feature access

---

## Backup Sync Protocol

Linked self-hosted instances can sync memories to OpenEngram Cloud for backup and cross-device access.

### Manual Sync

`POST /v1/cloud/sync` triggers a one-time sync:

1. Collects memories modified since last sync timestamp
2. Encrypts and batches memories for upload
3. Sends to cloud API
4. Updates local sync cursor on success

Check progress with `GET /v1/cloud/sync/status`.

### Auto-Sync

Enable with `PUT /v1/cloud/sync/auto-sync`:

```json
{ "enabled": true, "intervalMinutes": 60 }
```

When enabled, syncs run automatically at the configured interval. Disable by setting `enabled: false`.

### Conflict Resolution

- Cloud is treated as a **backup target**, not a bidirectional sync
- Local instance is the source of truth
- If the same memory exists in cloud (by ID), it's updated; otherwise created
- Deletions are synced (soft-delete propagation)

---

## First-Run Detection

`GET /v1/auth/setup-status` checks whether any accounts exist in the database:

- **No accounts** → returns `{ "setupRequired": true }` → dashboard shows setup wizard
- **Accounts exist** → returns `{ "setupRequired": false }` → normal login screen

During first-run, the auth system allows creating an admin account without existing authentication. After the first account is created, this path is closed.

---

## Related Documentation

- [Self-Hosted vs Cloud Spec](./specs/self-hosted-vs-cloud.md) — Full specification
- [Configuration](./CONFIGURATION.md) — Environment variables
- [Getting Started](./getting-started.md) — Setup guides
