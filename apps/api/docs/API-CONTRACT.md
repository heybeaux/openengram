# API Contract

Engram uses auto-generated OpenAPI specs as the contract between the API and the dashboard.

## How it works

1. **Swagger decorators** on NestJS controllers define the API schema
2. **`pnpm api:spec`** bootstraps the app and writes `api-spec.json` to the repo root
3. **`pnpm api:routes`** reads `api-spec.json` and generates `shared/api-routes.ts` — typed route constants for the dashboard
4. **Interactive docs** are served at `/api-docs` when the server is running

## Updating the spec

```bash
pnpm api:spec     # Regenerate api-spec.json
pnpm api:routes   # Regenerate shared/api-routes.ts
```

Both files are committed to the repo so the dashboard can import route constants without running the API.

## Dashboard integration

Import route constants from `shared/api-routes.ts`:

```typescript
import { API_ROUTES } from '@engram/shared/api-routes';

fetch(`${API_BASE}${API_ROUTES.V1_MEMORIES}`);
```

This ensures the dashboard always references valid routes. If a route is renamed or removed, TypeScript will catch it at compile time.

## CI check

On every push to `main`, the `api-spec` workflow:

1. Generates the spec
2. Checks for breaking changes (removed routes → build fails)
3. Auto-commits any spec updates

## Auth schemes

The spec defines three auth schemes:
- **Bearer** — JWT token in `Authorization` header
- **api-key** — `X-AM-API-Key` header
- **user-id** — `X-AM-User-ID` header
