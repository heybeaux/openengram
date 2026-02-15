# Authentication & Authorization Architecture

## Overview

Engram uses a custom auth system built on **JWT tokens** and **bcrypt password hashing** for the SaaS dashboard, plus **SHA-256 hashed API keys** for programmatic access. Row Level Security (RLS) ensures data isolation between accounts.

## Auth Methods

### 1. API Key Auth (`X-AM-API-Key` + `X-AM-User-ID`)

The primary auth method for agent-to-API communication.

**Headers:**
- `X-AM-API-Key` — The raw API key (e.g., `eng_a1b2c3...`)
- `X-AM-User-ID` — The external user ID the agent is acting on behalf of

**Flow:**
1. Guard hashes the API key with SHA-256
2. Looks up `agents.api_key_hash` for a match
3. Finds or creates the `User` record (by `agentId + externalId`)
4. Sets `request.agent`, `request.user`, and `request.accountId`

**Key format:** `eng_` prefix + 24 random hex bytes (48 chars). Only the SHA-256 hash is stored; the raw key is shown once at creation.

### 2. JWT Auth (`Authorization: Bearer <token>`)

Used by the SaaS dashboard (web app).

**Flow:**
1. Guard extracts the Bearer token from the `Authorization` header
2. Verifies the JWT signature via `JwtService`
3. Extracts `sub` (account ID) from the payload
4. Resolves the account's first active agent for API compatibility
5. Sets `request.accountId` and `request.agent`

**Token payload:** `{ sub: accountId, email: string }`

### 3. LAN Bypass (Self-Hosted)

When `TRUST_LOCAL_NETWORK=true`, requests from local IPs bypass auth entirely.

**Flow:**
1. Guard checks `request.ip` against local IP ranges (`127.0.0.1`, `::1`, `10.*`, `192.168.*`)
2. If local: grants access without credentials (agent/user context is optional)
3. If API key headers are provided on a local request, they're resolved for context but not required

**Security:** Only checks the socket IP — never trusts spoofable headers like `Host` or `Origin`. Should be disabled behind reverse proxies.

## Guards

### `ApiKeyGuard`
- **File:** `src/common/guards/api-key.guard.ts`
- **Used on:** All memory CRUD endpoints
- Handles both remote (API key required) and LAN bypass paths
- Auto-creates users on first access

### `ApiKeyOrJwtGuard`
- **File:** `src/common/guards/api-key-or-jwt.guard.ts`
- **Used on:** Dashboard endpoints that also accept API keys
- Tries API key first (`X-AM-API-Key` header), falls back to JWT (`Authorization: Bearer`)

### `UsageLimitGuard`
- **File:** `src/common/guards/usage-limit.guard.ts`
- **Used on:** Account-authenticated routes (after auth guard)
- Checks plan limits: daily API calls and memory count
- Resets daily counter on date change
- Returns HTTP 429 when limits exceeded

## Registration Flow

1. Client sends `POST /account/register` with `{ email, password, name?, plan?, accessCode? }`
2. Validates: must provide either `plan` or `accessCode` (no free tier on cloud)
3. If `accessCode`: validates against `ACCESS_CODES` env var (JSON array), checks persistent usage count from DB
4. Hashes password with bcrypt (cost factor 12)
5. Creates `Account` + default `Agent` in a single transaction
6. Generates API key (`eng_` + random hex), stores SHA-256 hash
7. Returns JWT token, raw API key (shown once), account info, and `needsPayment` flag

**Access codes** are configured via the `ACCESS_CODES` environment variable:
```json
[{ "code": "BETA2026", "plan": "PRO", "maxUses": 100, "expiresAt": "2026-12-31" }]
```

Usage is tracked persistently via `account.access_code` — survives deploys.

## Login Flow

1. Client sends `POST /account/login` with `{ email, password }`
2. Looks up account by email
3. Compares password with bcrypt hash
4. Signs and returns JWT token + account info

## Password Reset Flow

1. **Request reset:** `POST /account/forgot-password` with `{ email }`
   - Generates 32-byte random token
   - Stores SHA-256 hash in `accounts.reset_token` (raw token never stored)
   - Sets 1-hour expiry in `accounts.reset_token_expires_at`
   - Sends email via **Resend** (`RESEND_API_KEY`) with reset link
   - Always returns success (prevents email enumeration)

2. **Complete reset:** `POST /account/reset-password` with `{ token, newPassword }`
   - Hashes the provided token with SHA-256
   - Looks up account by `reset_token` hash
   - Validates expiry
   - Updates password hash, clears reset token

## RLS Integration

After authentication, the `RlsInterceptor` enforces data isolation:

1. Resolves `accountId` from `request.accountId` or `request.agent.accountId`
2. Wraps the entire request in a Prisma interactive transaction
3. Runs `SET LOCAL app.current_account_id = '<accountId>'`
4. Stores the transactional client in `AsyncLocalStorage` (`rlsContext`)
5. All downstream queries automatically use the RLS-filtered client via `PrismaService` proxy

When no `accountId` is present (LAN bypass), the interceptor skips the transaction — queries run as `engram_admin` with `BYPASSRLS`.

See [RLS-IMPLEMENTATION.md](./RLS-IMPLEMENTATION.md) for full details.

## Plan Limits

| Plan | Memories | API Calls/Day | Agents | Users/Agent |
|------|----------|---------------|--------|-------------|
| FREE | 1,000 | 100 | 1 | 1 |
| STARTER | 10,000 | 1,000 | 3 | 10 |
| PRO | 100,000 | 10,000 | 10 | 100 |
| SCALE | 1,000,000 | 100,000 | ∞ | ∞ |

Free tier is only available via self-hosting. Cloud registration requires STARTER+ or an access code.

## Key Files

- `src/account/account.service.ts` — Registration, login, password reset, API key management
- `src/account/plan-limits.ts` — Plan limit definitions
- `src/common/guards/api-key.guard.ts` — API key authentication + LAN bypass
- `src/common/guards/api-key-or-jwt.guard.ts` — Combined API key / JWT guard
- `src/common/guards/usage-limit.guard.ts` — Plan limit enforcement
- `src/prisma/rls.interceptor.ts` — RLS transaction wrapper
- `src/prisma/rls-context.ts` — AsyncLocalStorage for transactional client

---

*This is a critical architectural document. Update it when auth flows or guards change.*
