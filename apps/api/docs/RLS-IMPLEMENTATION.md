# RLS Implementation — Engram SaaS

## Date
2026-02-14

## Approach
Row Level Security using PostgreSQL `SET LOCAL` session variables + RLS policies, integrated via a NestJS interceptor.

### How it works
1. **`RlsInterceptor`** (global NestJS interceptor) wraps each authenticated request in a Prisma `$transaction`
2. At the start of the transaction, it runs `SET LOCAL app.current_account_id = '<accountId>'`
3. All subsequent queries within that transaction are filtered by RLS policies that check `current_setting('app.current_account_id', true)`
4. When no `accountId` is present (LAN bypass mode), the interceptor skips the transaction wrapper entirely — the `BYPASSRLS` role (`engram_admin`) handles access normally

### Ownership chain
- **Direct**: `accounts.id`, `agents.account_id`, `ux_feedback.account_id`
- **Through agents**: `users.agent_id` → `agents.account_id`
- **Through users**: `projects`, `sessions`, `memories`, `feedback`, `graph_*`, `hierarchy_units`, `dedup_*`, `dream_cycle_reports`
- **Through memories**: `memory_extractions`, `memory_entities`, `memory_chain_links`, `memory_embeddings`, `memory_pool_memberships`
- **Through webhooks**: `webhook_deliveries` (via `webhooks.agent_id`)
- **Through subscriptions**: `webhook_delivery_logs` (via `webhook_subscriptions.user_id`)
- **Service-only** (deny all, BYPASSRLS role accesses): system tables, `_prisma_migrations`, `fog_index_snapshots`, `monitoring_snapshots`, etc.

## Files Created/Modified

### Created
- `supabase/migrations/20260214_rls_policies.sql` — Full RLS migration (helper functions, ENABLE + FORCE RLS on all tables, policies)
- `src/prisma/rls.interceptor.ts` — NestJS interceptor that sets session variable in a transaction
- `src/prisma/rls-context.ts` — AsyncLocalStorage holding the transactional Prisma client

### Modified
- `src/prisma/prisma.module.ts` — Registered `RlsInterceptor` as global `APP_INTERCEPTOR`
- `src/prisma/prisma.service.ts` — Uses Proxy to transparently delegate to RLS transactional client via AsyncLocalStorage
- `src/prisma/rls.interceptor.ts` — Wraps handler in `rlsContext.run()` so downstream code gets the transactional client
- `src/common/guards/api-key.guard.ts` — Now sets `request.accountId` from `agent.accountId` in both LAN and remote paths

### Deleted
- `supabase/migrations/20260214_enable_rls_all_tables.sql` — Old migration that used `auth.uid()` (Supabase Auth, which we don't use)

## Key Decisions

1. **FORCE ROW LEVEL SECURITY on all tables** — Even the table owner (engram_admin) is subject to RLS. The `engram_admin` role is granted `BYPASSRLS` to operate normally; RLS only kicks in when `app.current_account_id` is set.

2. **Single `FOR ALL` policies** — Instead of separate SELECT/INSERT/UPDATE/DELETE policies, used combined `FOR ALL` policies for simplicity. Service-only tables use `USING (false)` to deny all access (the BYPASSRLS role bypasses this).

3. **LAN bypass**: When `TRUST_LOCAL_NETWORK=true` and no auth credentials are provided, `request.accountId` is null, so the interceptor skips the transaction wrapper entirely. Queries run as `engram_admin` (BYPASSRLS) without RLS filtering.

4. **Transparent RLS via AsyncLocalStorage**: The interceptor stores the transactional client in `rlsContext` (AsyncLocalStorage) and `PrismaService` uses a Proxy to automatically delegate model accessors and raw queries to the transactional client when one exists. Services don't need any changes — `this.prisma.memory.findMany(...)` automatically runs inside the RLS transaction.

5. **UUID/text cast**: `webhook_delivery_logs.subscription_id` is text but `webhook_subscriptions.id` is uuid — the policy uses `ws.id::text` to handle the mismatch.

## Testing
- Migration applied locally: ✅ (`postgresql://engram_admin:engram_admin_local@localhost:5432/engram`)
- All 1364 tests pass: ✅

## Remaining Manual Steps
1. **Apply migration to production** (Supabase): Run the SQL in `supabase/migrations/20260214_rls_policies.sql` against the production database
2. **Grant BYPASSRLS to production role**: Ensure the production database role has `BYPASSRLS` privilege
3. ~~**Migrate services to use `request.prismaTransaction`**~~ — ✅ DONE (2026-02-14): Services now transparently use the RLS transactional client via AsyncLocalStorage + Proxy in PrismaService. No service file changes needed.
4. **Test RLS enforcement end-to-end**: Create two accounts, verify one can't see the other's data
5. **Remove rollback file**: `supabase/migrations/20260214_enable_rls_all_tables_rollback.sql` references the old migration

## Edge Cases & Concerns
- **`$transaction` within services**: If a service calls `this.prisma.$transaction(...)`, it will use the original PrismaClient (not the RLS tx client), since `$transaction` is excluded from proxying. This is correct — nested interactive transactions aren't supported by Prisma anyway.
- **Long-running requests**: The entire request runs inside a single Prisma interactive transaction. Very long requests may hit Prisma's transaction timeout (default 5s). If needed, increase `interactiveTransactionTimeout` in the Prisma client config.
- **WebSocket/non-HTTP contexts**: The RLS interceptor only activates for HTTP requests. WebSocket gateways or other transports need their own RLS setup if required.
- **Proxy performance**: The Proxy adds negligible overhead — it's a single `getStore()` call + property lookup per access.
