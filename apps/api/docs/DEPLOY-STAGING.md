# Staging Backend Deploy

## Prerequisites

- **Railway CLI** installed: `npm i -g @railway/cli` (or use `npx @railway/cli`)
- Access to the **believable-integrity** Railway project
- Logged in: `railway login`
- Linked to project: `railway link` → select `believable-integrity`

## Deploy

```bash
git pull origin main
npx @railway/cli up
```

Railway will build and deploy from the current working directory. Wait for the deploy to complete in the CLI output.

## Health Check

```bash
curl https://staging-api.openengram.ai/v1/health
```

Expected: `200 OK` with a JSON body indicating healthy status.

## Key Endpoints to Verify

| Endpoint | Method | Expected |
|---|---|---|
| `/v1/health` | GET | 200 |
| `/v1/memories` | GET | 200 (auth required) |
| `/v1/agents` | GET | 200 |
| `/v1/identities` | GET | 200 |
| `/v1/contracts` | GET | 200 |
| `/v1/challenges` | GET | 200 |
| `/v1/teams` | GET | 200 |
| `/v1/trust-profiles` | GET | 200 |
| `/v1/search` | POST | 200 |
| `/v1/sync/status` | GET | 200 |

## Rollback

If the deploy is broken, see [ROLLBACK.md](./ROLLBACK.md) for rollback procedures. In Railway you can also redeploy a previous deployment from the dashboard.
