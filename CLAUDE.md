# CLAUDE.md — Engram Development Rules

## What is Engram?
A NestJS memory API with Prisma, PostgreSQL + pgvector. Stores, retrieves, and manages semantic memories for AI agents. Runs on port 3001.

## Quick Commands
```bash
npm run start:dev     # Dev server with hot reload
npm test              # Run all tests (Jest, 1100+ tests)
npm run test:cov      # Tests with coverage
npm run lint          # ESLint
npm run build         # Production build
npx tsc --noEmit      # Type check without emitting
npm run migrate:deploy  # Apply migrations (PRODUCTION SAFE)
npm run migrate:safe    # Apply with safety wrapper
```

## MANDATORY Rules

### Every code change MUST include tests
- No exceptions. Unit tests for services, integration tests for controllers.
- Tests live alongside source: `foo.service.ts` → `foo.service.spec.ts`
- Run `npm test` before committing. CI will catch you anyway.

### Migration Safety
- **NEVER** use `prisma migrate dev` on production — only `prisma migrate deploy`
- `package.json` blocks `prisma migrate dev` via `premigrate:dev` script
- Every SQL migration MUST be idempotent:
  - `CREATE TABLE` → `CREATE TABLE IF NOT EXISTS`
  - `CREATE INDEX` → `CREATE INDEX IF NOT EXISTS`  
  - RLS policies → `DROP POLICY IF EXISTS` then `CREATE POLICY`
  - `ALTER TABLE ADD COLUMN` → wrap in `DO $$ BEGIN ... EXCEPTION WHEN duplicate_column THEN NULL; END $$;`
- Use `npm run migrate:safe` or `npm run migrate:deploy`

### DTO Decorators (class-validator)
- Every DTO field MUST have class-validator decorators (`@IsString()`, `@IsOptional()`, etc.)
- ValidationPipe runs with `whitelist: true` — undecorated fields are **silently stripped**
- If your field works in tests but not via HTTP, you forgot a decorator

### Architecture Layers (dependency direction: down only)
```
Types/Interfaces
    ↓
Config (ConfigService)
    ↓
Repository (PrismaService)
    ↓
Service (business logic)
    ↓
Controller (HTTP layer)
```
- Controllers never touch Prisma directly
- Services never import controllers
- Cross-module: import the service, not the repository

## File Structure
```
src/
  {module}/
    {module}.module.ts        # NestJS module
    {module}.service.ts       # Business logic
    {module}.service.spec.ts  # Tests
    {module}.controller.ts    # HTTP endpoints
    {module}.types.ts         # Types/interfaces
    dto/                      # Request/response DTOs
```

## Testing Patterns
- Use `@nestjs/testing` `Test.createTestingModule()` — auto-cleanup handled by `src/test-setup.ts`
- Mock PrismaService with plain objects: `{ memory: { create: jest.fn(), findMany: jest.fn() } }`
- Mock ConfigService: `{ get: jest.fn().mockReturnValue('value') }`
- Tests use SWC transform via ts-jest for speed
- Jest config in `package.json` — rootDir is `src/`, testRegex `.*\.spec\.ts$`

## Authentication
- API key auth via `ApiKeyGuard` in `src/common/guards/api-key.guard.ts`
- User identification via `x-am-user-id` header (required for most endpoints)
- Localhost requests bypass API key auth

## Common Gotchas

### PrefetchCache Infinite Loop
The prefetch module had a bug where cache invalidation triggered re-prefetch which triggered invalidation. If you touch prefetch logic, verify no circular triggers exist.

### Ensemble DTO Decorators
The ensemble module's DTOs were missing decorators, causing fields to be silently stripped by `whitelist: true`. Always verify DTOs have full decorator coverage.

### Migration Idempotency
Prisma generates non-idempotent SQL by default. You MUST manually edit migration files to add `IF NOT EXISTS`/`IF EXISTS` guards before committing.

### x-am-user-id Headers
Most endpoints require `x-am-user-id`. Missing it returns 400/401. In tests, always set this header on request objects.

## Dev Setup
```bash
# Prerequisites: Node 20+, PostgreSQL with pgvector
cp .env.example .env  # Set DATABASE_URL
npm install
npx prisma generate
npx prisma migrate deploy
npm run start:dev
```
