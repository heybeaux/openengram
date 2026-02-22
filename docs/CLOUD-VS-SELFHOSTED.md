# Cloud vs Self-Hosted Deployment

## Overview

Engram supports two deployment modes with fundamentally different architectures. The API is identical — only the infrastructure and auth model differ.

## Comparison

| Aspect | Cloud (SaaS) | Self-Hosted |
|--------|-------------|-------------|
| **URL** | `api.openengram.ai` | `localhost:3000` |
| **Cost** | Coming soon (join waitlist at openengram.ai) | Free |
| **Auth** | Required (API key or JWT) | Optional (LAN bypass) |
| **Accounts** | Full account system | Not needed |
| **Embeddings** | OpenAI + Cohere (cloud API) | engram-embed (local Metal GPU) |
| **Data isolation** | RLS per account | Single-tenant |
| **Email** | Resend (password reset) | Dev mode (log to console) |
| **Hosting** | Railway | Your hardware |

## Cloud (SaaS)

### Authentication
- All requests require either `X-AM-API-Key` + `X-AM-User-ID` headers or a JWT Bearer token
- Accounts created via registration
- Hosted cloud coming soon — join the waitlist at [openengram.ai](https://openengram.ai)

### Embeddings
- **Provider:** `cloud-ensemble` — OpenAI `text-embedding-3-small`, `text-embedding-3-large`, Cohere Embed v3
- Per-token API costs from OpenAI/Cohere
- Data sent to third-party APIs for embedding

### Data Isolation
- PostgreSQL Row Level Security (RLS) enforces strict account separation
- Every query runs inside a transaction with `SET LOCAL app.current_account_id`
- See [RLS-IMPLEMENTATION.md](./RLS-IMPLEMENTATION.md)

### Email
- Password reset emails via **Resend** (`RESEND_API_KEY`)
- From: `noreply@openengram.ai`

## Self-Hosted

### Authentication
- `TRUST_LOCAL_NETWORK=true` enables LAN bypass — no auth needed from local IPs
- API keys still work if configured (useful for multi-agent setups)
- No account system required for single-user deployments

### Embeddings
- **Provider:** `local` — [engram-embed](https://github.com/heybeaux/engram-embed) (Rust + Candle)
- 4 models running in parallel on Apple Silicon Metal GPU:
  - `bge-base-en-v1.5` (768-dim)
  - `all-MiniLM-L6-v2` (384-dim)
  - `gte-base-en-v1.5` (768-dim)
  - `nomic-embed-text-v1.5` (768-dim)
- Zero cost, ~50ms latency, all data stays local
- See [EMBEDDING-ARCHITECTURE.md](./EMBEDDING-ARCHITECTURE.md)

### Data Isolation
- Single-tenant: no RLS needed
- `engram_admin` role with `BYPASSRLS` handles all queries
- No account separation overhead

### Email
- No email service needed
- Password reset links logged to console in dev mode

## Configuration Differences

### Cloud Environment Variables

```bash
EMBEDDING_PROVIDER=cloud-ensemble
OPENAI_API_KEY=sk-...
COHERE_API_KEY=...              # Optional but recommended
TRUST_LOCAL_NETWORK=false       # Never trust local IPs in cloud
RESEND_API_KEY=re_...           # For password reset emails
DASHBOARD_URL=https://app.openengram.ai
ACCESS_CODES=[...]              # JSON array of registration codes
DATABASE_URL=postgresql://...   # RLS-enforced role (engram_app)
```

### Self-Hosted Environment Variables

```bash
EMBEDDING_PROVIDER=local        # Default
ENGRAM_EMBED_URL=http://localhost:8080
EMBED_DEVICE=metal              # Apple Silicon GPU
TRUST_LOCAL_NETWORK=true        # Enable LAN bypass
# RESEND_API_KEY not needed
# ACCESS_CODES not needed
DATABASE_URL=postgresql://engram_admin:...@localhost:5432/engram
```

### Key Config Flags

| Variable | Cloud | Self-Hosted | Purpose |
|----------|-------|-------------|---------|
| `EMBEDDING_PROVIDER` | `cloud-ensemble` | `local` | Selects embedding backend |
| `TRUST_LOCAL_NETWORK` | `false` | `true` | LAN bypass for auth |
| `RESEND_API_KEY` | Set | Unset | Password reset emails |
| `OPENAI_API_KEY` | Set | Unset | Cloud embeddings |
| `COHERE_API_KEY` | Optional | Unset | Cloud embeddings (3rd model) |
| `ENGRAM_EMBED_URL` | Unset | `http://localhost:8080` | Local embedding service |

## When to Choose What

**Choose Cloud if:**
- You want zero infrastructure setup
- You need multi-tenant data isolation
- You want the highest-quality commercial embedding models
- You're building a product that serves multiple customers

**Choose Self-Hosted if:**
- You want free, unlimited usage
- Data privacy is paramount (nothing leaves your machine)
- You have Apple Silicon hardware
- You're a single user/team with one deployment

## Key Files

- `src/embedding/cloud-ensemble.service.ts` — Cloud embedding orchestration
- `src/embedding/` — All embedding providers
- `src/common/guards/api-key.guard.ts` — LAN bypass logic
- `src/prisma/rls.interceptor.ts` — RLS enforcement (cloud only)
- `src/account/plan-limits.ts` — Plan definitions

---

*This is a critical architectural document. Update it when deployment modes or config options change.*
