# Verification Status

**Rule: Nothing is production-ready until independently verified with evidence.**

"It should work" ≠ "It works." A feature is WIP until someone confirms it with actual output, logs, or a test result.

---

## API Endpoints (Railway: api.openengram.ai)

### Auth
| Endpoint | Method | Status | Verified | Evidence |
|---|---|---|---|---|
| POST /v1/auth/register | POST | Fixed + Verified | ✅ LOCAL 2026-02-14 | Rate limited at 4 req, returns 201/429 |
| POST /v1/auth/login | POST | Verified | ✅ LOCAL 2026-02-14 | Returns JWT (stress test) |
| POST /v1/auth/forgot-password | POST | Verified | ✅ LOCAL 2026-02-14 | Returns 200 (stress test) |
| POST /v1/auth/reset-password | POST | Verified | ✅ LOCAL 2026-02-14 | Returns 400 on bad token (stress test) |
| POST /v1/auth/change-password | POST | Fixed + Verified | ✅ LOCAL 2026-02-14 | Returns 200 with success message |

### Account
| Endpoint | Method | Status | Verified | Evidence |
|---|---|---|---|---|
| DELETE /v1/account | DELETE | Deployed | ❌ NOT VERIFIED | — |
| GET /v1/account/usage | GET | Deployed | ❌ NOT VERIFIED | — |
| GET /v1/account/api-keys | GET | Verified | ✅ LOCAL 2026-02-14 | Returns 200 with keys (stress test) |
| POST /v1/account/api-keys | POST | Verified | ✅ LOCAL 2026-02-14 | Returns 403 on plan limit (stress test) |
| DELETE /v1/account/api-keys/:id | DELETE | Fixed + Verified | ✅ LOCAL 2026-02-14 | Returns 204 on deletion |
| PATCH /v1/account | PATCH | Fixed + Verified | ✅ LOCAL 2026-02-14 | Returns 200 with updated data |

### Core (Memory)
| Endpoint | Method | Status | Verified | Evidence |
|---|---|---|---|---|
| POST /v1/memories | POST | Verified | ✅ LOCAL 2026-02-14 | 201, createdAt is ISO string (bug #7 fixed) |
| POST /v1/memories/search | POST | Fixed + Verified | ✅ LOCAL 2026-02-14 | Route wired, alias for /query (bug #2 fixed) |
| GET /v1/memories/search | GET | Fixed + Verified | ✅ LOCAL 2026-02-14 | Route wired (bug #2 fixed) |
| GET /v1/memories/:id | GET | Verified | ✅ LOCAL 2026-02-14 | Returns 200 (stress test) |
| DELETE /v1/memories/:id | DELETE | Verified | ✅ LOCAL 2026-02-14 | Returns 204 (stress test) |

### Feedback
| Endpoint | Method | Status | Verified | Evidence |
|---|---|---|---|---|
| POST /v1/feedback | POST | Verified | ✅ LOCAL 2026-02-14 | Returns 201 (stress test) |

### Billing
| Endpoint | Method | Status | Verified | Evidence |
|---|---|---|---|---|
| POST /v1/billing/checkout | POST | Verified | ✅ LOCAL 2026-02-14 | Returns 201 + Stripe URL (stress test) |
| POST /v1/billing/portal | POST | Verified | ✅ LOCAL 2026-02-14 | Returns 200 + Stripe URL (stress test) |
| POST /v1/billing/webhook | POST | Deployed | ❌ NOT VERIFIED | — |

### Infrastructure
| Check | Status | Verified | Evidence |
|---|---|---|---|
| Railway deploy healthy | Triggered | ❌ NOT VERIFIED | — |
| API responds on api.openengram.ai | — | ❌ NOT VERIFIED | — |
| Database connectivity from Railway | — | ❌ NOT VERIFIED | — |
| Rate limiting active | Working | ✅ LOCAL 2026-02-14 | 429 after 4 rapid auth requests |
| Sentry error reporting | — | ❌ NOT VERIFIED | — |
| UsageLimitGuard enforcing plan tiers | — | ❌ NOT VERIFIED | — |

---

## Dashboard (Vercel: app.openengram.ai)

| Feature | Status | Verified | Evidence |
|---|---|---|---|
| Signup page renders | Built | ❌ NOT VERIFIED | — |
| Login page renders | Built | ❌ NOT VERIFIED | — |
| Onboarding flow | Built | ❌ NOT VERIFIED | — |
| Settings page | Built | ❌ NOT VERIFIED | — |
| Billing page (Stripe) | Built | ❌ NOT VERIFIED | — |
| API key management | Built | ❌ NOT VERIFIED | — |
| Usage meters | Built | ❌ NOT VERIFIED | — |
| Feedback widget | Built | ❌ NOT VERIFIED | — |
| Auth middleware | Built | ❌ NOT VERIFIED | — |
| PostHog analytics | Configured | ❌ NOT VERIFIED | — |
| Domain app.openengram.ai | Not configured | ❌ NOT VERIFIED | — |

---

## Marketing Site (Vercel: openengram.ai)

| Feature | Status | Verified | Evidence |
|---|---|---|---|
| Site renders at openengram.ai | Was working, now 404 | ❌ BROKEN | Confirmed 404 on Feb 14 |
| SEO (Schema.org, llms.txt) | Built | ❌ NOT VERIFIED | — |
| Pricing section | Built | ❌ NOT VERIFIED | — |

---

## Infrastructure

| Component | Status | Verified | Evidence |
|---|---|---|---|
| Automated backups (6am/2pm/10pm) | Configured | ✅ Manual backup verified Feb 14 | 2,182 memories, 38MB |
| Auto-backup LaunchAgent | Configured | ❌ NOT VERIFIED (2pm run pending) | — |
| CI passing | ✅ VERIFIED | ✅ | 1,349 tests, commits 6604da8/43cc046 |
| DB role lockdown | ✅ VERIFIED | ✅ | clawdbot stripped, engram_admin created |
| RLS migration | Generated, NOT applied | ❌ Blocked on supabase_user_id | — |
| Dream Cycle cron | Failing | ❌ BROKEN | 401 auth error at 3am |

---

## How to Verify

When verifying an endpoint or feature, record:
1. **Date/time** of verification
2. **Method** (curl, browser, test suite, logs)
3. **Actual response** (status code, body snippet, screenshot)
4. **Who verified** (human or agent)

Update this file with evidence. Mark ✅ only with proof.

---

*Last updated: 2026-02-14 08:52 PST*
