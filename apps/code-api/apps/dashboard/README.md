# engram-code dashboard

Next.js 15 (App Router) dashboard for the engram-code v1 API.

## Run

```bash
# from repo root
pnpm install
pnpm --filter dashboard dev   # http://localhost:3001
```

The backend API is expected on `http://localhost:3000` (override with
`EC_API_URL`). Start it with `pnpm start:dev` from the repo root.

## Endpoints wrapped

`lib/api.ts` exposes a typed client over the v1 endpoints introduced in
EC-28:

- `getCard(path, lod?)` — `GET /v1/cards/<path>?lod=`
- `getMap(root?, depth?)` — `GET /v1/map`
- `searchConcept(query, opts?)` — `POST /v1/search/concept`
- `listSubsystems()` — `GET /v1/subsystems`

Response shapes are validated against the zod schemas in
`lib/schemas.ts`, which mirror `src/v2/api/dto/index.ts` on the backend.

## Tests

```bash
pnpm --filter dashboard test
```

## Environment

| Var          | Default                 | Purpose                                                |
|--------------|-------------------------|--------------------------------------------------------|
| `EC_API_URL` | `http://localhost:3000` | Base URL for the engram-code v1 API the dashboard hits |

On Vercel, set `EC_API_URL` (preview + production) to the deployed backend, e.g.
`https://engram-code-api.example.com`. Without it, the preview will render but
every card/search call will fail.

## Deploy (Vercel)

The dashboard ships as its own Vercel project rooted at `apps/dashboard/`.

```bash
# one-time, from repo root
cd apps/dashboard
vercel link            # pick scope, accept "dashboard" as the project name
vercel env add EC_API_URL preview      # paste the preview API URL
vercel env add EC_API_URL production   # paste the production API URL

# manual preview deploy
vercel
```

CI auto-deploys preview builds when `VERCEL_TOKEN` is set on the workflow —
see `.github/workflows/dashboard-ci.yml`.

The included `vercel.json` pins `framework: nextjs`, builds via the workspace
(`pnpm --filter dashboard build`), and uses an `ignoreCommand` so unrelated
backend commits don't trigger redeploys.
