# Changelog

All notable changes to the Engram project will be documented in this file.

## [0.5.0] — 2026-02-08

### Added

#### Dedup & Quality v2
- Three-tier deduplication with configurable similarity thresholds:
  - **Auto-merge** (≥0.93) — silently merges near-identical memories
  - **Reinforce** (≥0.85) — boosts existing memory's confidence instead of creating a duplicate
  - **Flag** (≥0.78) — marks for human review
- Confidence scoring by source type (observed conversation vs explicit statement vs inferred)
- Reinforcement-aware decay — memories that get reinforced decay slower

#### Contextual Recall API
- New endpoint: `POST /v1/recall/contextual`
- Automatic topic shift detection via cosine distance between consecutive messages
- 30-second cooldown to prevent recall flooding
- Per-session rate limiting
- Returns relevant memories when conversation topic changes significantly

#### Dream Cycle
- New endpoint: `POST /v1/consolidation/dream-cycle`
- 4-stage consolidation pipeline:
  1. **Dedup** — finds and merges duplicate memories
  2. **Staleness** — identifies and soft-deletes stale, low-value memories
  3. **Patterns** — extracts recurring themes into higher-order memories
  4. **Report** — generates a summary of all consolidation actions
- Soft-delete only (no permanent data loss)
- Protected memory types (CONSTRAINT, pinned) are never touched

#### Generate Context (Dream Cycle Stage 5)
- New endpoint: `POST /v1/consolidation/generate-context`
- Auto-curates top memories into a `MEMORY_CONTEXT.md` file
- Configurable token budget for output size control
- Groups memories by category (User Identity, Current Project, Recent Context, etc.)
- Designed to run as Stage 5 after Dream Cycle completion

#### Ensemble Search Improvements
- PgVector provider updated to search `memory_embeddings` table (multi-model embeddings)
- Configurable search model via `VECTOR_SEARCH_MODEL` environment variable
- Automatic fallback to inline `embedding` column when `memory_embeddings` has no match
- Dual-write on upsert: writes to both inline column and `memory_embeddings` table

### Fixed

- **ImportanceScorerService DI** — Added `@Optional()` and `@Inject()` decorators for `SCORING_CONFIG` token to prevent startup crashes when config is not provided
- **minScore threshold** — DTO default (0.75) was silently overriding the service default, causing relevant memories to be missed. Changed default to 0.65
- **Data integrity** — Reassigned 1,289 memories from null/rook `agentId` to `clawd-agent-001`
- **Embedding backfill** — Backfilled 229 missing inline embeddings from the `memory_embeddings` table
- **Full re-embed** — All 1,539 active memories now have ensemble embeddings (previously only 757)

### Eval Results

| Metric | Result | Grade |
|--------|--------|-------|
| Recall | 23/25 (92%) | A |
| F1 Score | 0.577 | — |
| Context Relevance | 7/8 topics | B |
| Latency (p50) | 124ms | A |
| Latency (p95) | 132ms | A |
| Dedup Density | 2.15% | — |

---

### Related Changes

#### OpenClaw Fork (`openclaw-fork`)
- Cherry-picked 3 Engram hook commits for `message:sent` / `message:received` event hooks
- Updated `copy-hook-metadata.ts` to transpile `handler.ts` → `handler.js` (fixes hook loading)
- New `engram-recall` workspace hook at `hooks/engram-recall/` — triggers contextual recall on incoming messages

#### Engram Dashboard (`engram-dashboard`)
- Added **Consolidation** page at `/consolidation` — UI for Dream Cycle and Generate Context
- Fixed mobile navigation (Code page was missing from mobile nav)
- Fixed CORS issue — `Authorization` header was not included in allowed headers
