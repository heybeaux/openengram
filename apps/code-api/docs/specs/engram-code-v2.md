# engram-code v2 — Multi-Pass Codebase Understanding

**Status:** Draft spec
**Author:** Kit 🦊 (with Beaux)
**Date:** 2026-05-24
**Targets:** v0.1 (TS/Python/Go), language-agnostic primitives throughout

---

## 1. Problem

engram-code v1 is a **retrieval** system: chunk → embed → vector search. It answers "what code is similar to this query" — but agents working on real codebases need to answer:

- *What does this codebase **do**?* (intent, not implementation)
- *How is it **structured**?* (concepts, contracts, boundaries)
- *What's **load-bearing** vs incidental?* (hotspots, coupling)
- *What are the **gotchas**?* (the weird stuff a newcomer needs to know)

These can't be answered by similarity search over raw chunks. They require **multi-pass reasoning** over the codebase, **synthesized** into layered artifacts an agent can navigate cheaply.

## 2. North-Star Experience

> *An agent (North, Factory worker, Cursor) opens a codebase it's never seen. In ~50 tokens it knows the shape. In ~500 it knows the subsystem boundaries. In ~2k it has the contract surface for the area it's about to touch. In ~20k it has full deep context for that area — no more, no less.*

This is **ACR (Agent Capability Runtime) applied to codebases**: LoD-based context with on-demand drill-down.

## 3. Design Principles

1. **Concepts over files.** The unit of understanding is the *capability/subsystem*, not the file. Files are an implementation detail surfaced when needed.
2. **Markdown is the primary substrate.** Human + agent readable, git-versionable, diffable. DB is the queryable index over markdown.
3. **Language-agnostic primitives, language-aware extractors.** Tree-sitter for structure; per-language extractors layer semantic richness on top.
4. **Configurable model routing.** Default pass→model mapping ships; per-codebase config overrides; optional router agent for dynamic selection.
5. **Incremental by default.** Git-diff-driven rescans; periodic full re-index for drift correction.
6. **Multi-pass, not monolithic.** Each pass has one job, one model strength, one output shape. Composable.
7. **Engram is memory, not generator.** v2 *generates* artifacts; Engram stores/queries them.

## 4. Architecture

### 4.1 High-Level Pipeline

```
                       ┌──────────────────────────────────────────────┐
                       │              Indexing Pipeline                │
                       │                                              │
   git diff / cron ───▶│  ┌──────────┐                                │
                       │  │ Scheduler│ — decides scope (full/incr)    │
                       │  └────┬─────┘                                │
                       │       ▼                                      │
                       │  ┌──────────┐                                │
                       │  │  Pass 1  │ Structure (tree-sitter)        │
                       │  │  Pass 2  │ Intent (LLM, per module)       │
                       │  │  Pass 3  │ Contracts (public surface)     │
                       │  │  Pass 4  │ Hotspots (git + coupling)      │
                       │  │  Pass 5  │ Gotchas (anomaly detection)    │
                       │  │  Pass 6  │ Synthesis (LoD cards)          │
                       │  └────┬─────┘                                │
                       │       ▼                                      │
                       │  ┌──────────┐    writes      ┌────────────┐  │
                       │  │Synthesizer│──────────────▶│ .engram/   │  │
                       │  └────┬─────┘    markdown    │ artifacts/ │  │
                       │       │                      └─────┬──────┘  │
                       │       │ indexes                    │         │
                       │       ▼                            │         │
                       │  ┌──────────────────────┐          │         │
                       │  │ Postgres + pgvector  │◀─────────┘         │
                       │  │  - cards (LoD)       │  (also embeds      │
                       │  │  - chunks (v1 schema)│   the cards)       │
                       │  │  - graph edges       │                    │
                       │  │  - hotspots / stats  │                    │
                       │  └──────────────────────┘                    │
                       └──────────────────────────────────────────────┘
                                          │
                                          ▼
                              ┌──────────────────────┐
                              │     Query Layer       │
                              │  - /v1/cards/:id?lod │
                              │  - /v1/map           │
                              │  - /v1/search (v1)   │
                              │  - /v1/graph         │
                              │  - /v1/hotspots      │
                              └──────────────────────┘
```

### 4.2 The Passes

Each pass is an independent module with a typed input/output contract and a default model. Passes can be re-run individually.

#### Pass 1 — Structure (mechanical, no LLM)

- **Job:** Build the skeleton — files, modules, packages, classes, functions, imports.
- **Tooling:** Tree-sitter (language-agnostic), supplemented by language compilers where available (TS compiler, Apex parser, etc.).
- **Output:** `structure.json` — AST-derived graph of nodes + edges (contains, imports, calls, extends).
- **Model:** None. Pure code.
- **Re-run trigger:** Any file change.

#### Pass 2 — Intent (LLM, per-module)

- **Job:** Answer "what is this module *for*?" — purpose, responsibilities, what it owns.
- **Input:** Pass 1 output for a module + the module's source.
- **Output:** `intent.md` per module (~200–500 words).
- **Model:** Default = mid-tier (Sonnet/Gemini Flash). Cost-controlled by module size.
- **Re-run trigger:** Source change in module OR upstream contract change.

#### Pass 3 — Contracts (LLM-assisted extraction)

- **Job:** Surface the *public API* — what other modules can/should depend on.
- **Input:** Pass 1 (exported symbols) + Pass 2 (intent).
- **Output:** `contract.md` per module — list of exports with signatures, semantics, stability notes.
- **Model:** Default = mid-tier; can be mechanical for typed languages (TS/Go) with LLM only for semantic notes.
- **Re-run trigger:** Export change or signature change.

#### Pass 4 — Hotspots (mechanical + LLM annotation)

- **Job:** Identify *load-bearing* code and risky areas.
- **Inputs:**
  - Git history (churn, age, # contributors)
  - Pass 1 graph (in-degree = how many modules depend on this)
  - Test coverage (if available)
  - Complexity metrics (cyclomatic, lines per function)
- **Output:** `hotspots.md` — ranked list with annotations ("changed 47x in 90d, depended on by 12 modules, no tests").
- **Model:** Mechanical scoring; LLM only for the human-readable annotation.
- **Re-run trigger:** Daily (cheap) or after significant commits.

#### Pass 5 — Gotchas (LLM, sparse)

- **Job:** Capture *the weird stuff* — workarounds, intentional violations, "don't change this without reading X."
- **Inputs:**
  - Comments (TODO, FIXME, HACK, NOTE, XXX)
  - Long-form docstrings
  - Code that diverges from project conventions (detected via pattern frequency)
  - Files with `.md` siblings (ADRs, READMEs)
- **Output:** `gotchas.md` per module — bullet list of "things to know."
- **Model:** Default = mid-tier; runs against pre-filtered candidates only (cheap).
- **Re-run trigger:** Comment change or convention-violation detected.

#### Pass 6 — Synthesis (LLM, layered)

- **Job:** Produce the **LoD cards** an agent actually consumes.
- **Input:** All prior passes for a module/capability.
- **Output:**
  - `index.md` (~15 tokens) — one-line identity
  - `summary.md` (~100 tokens) — what + why
  - `standard.md` (~500 tokens) — intent + contracts + key gotchas
  - `deep.md` (~2k tokens) — everything, including hotspots, design rationale, inline examples
- **Model:** Default = high-tier (Opus/Gemini Pro) for top-level synthesis; mid-tier for module-level.
- **Re-run trigger:** Any upstream pass changes.

### 4.3 Conceptual Hierarchy

Cards exist at multiple levels — the synthesizer rolls up:

```
repository (1 card)
  └─ subsystem (3–15 cards) ───── "auth", "billing", "ingestion pipeline"
       └─ module/package (10–100 cards)
            └─ capability (50–500 cards) ─── individual classes/functions
                 └─ chunk (v1 retrieval layer)
```

Subsystems are **discovered**, not declared — Pass 2/6 cluster modules by intent overlap and dependency density.

### 4.4 Model Routing

Three layers, in order of precedence:

1. **Default pass→model map** (shipped):
   ```yaml
   passes:
     structure:  none
     intent:    { model: gemini-flash, fallback: sonnet }
     contracts: { model: sonnet,       fallback: gemini-flash }
     hotspots:  { annotate: gemini-flash }
     gotchas:   { model: sonnet }
     synthesis:
       module:     { model: sonnet }
       subsystem:  { model: opus, fallback: gemini-pro }
       repository: { model: opus }
   ```

2. **Per-codebase config** (`.engram/config.yaml` in repo root): overrides per pass or per path glob.

3. **Optional router agent**: when enabled, can override based on file size, language, complexity, or budget. Off by default.

Budget guardrails: per-repo daily token cap + per-pass max cost, both configurable.

### 4.5 Storage Model

#### On-disk (primary)

```
<repo>/
  .engram/
    config.yaml
    artifacts/
      repository.md
      subsystems/
        auth.md
        billing.md
      modules/
        auth/
          intent.md
          contract.md
          hotspots.md
          gotchas.md
          index.md
          summary.md
          standard.md
          deep.md
      structure.json          # machine-readable graph
      hotspots.json
      runs/
        2026-05-24T08-15.json # pass log: what ran, cost, duration, deltas
```

Markdown is committable; agents can read it without the server running. The DB is a **derived index**, rebuildable from disk.

#### Database (derived)

Extend v1 schema:

- `cards` — one row per LoD card (repo/subsystem/module level), with `lod` enum, `concept_path`, `content`, embeddings.
- `graph_edges` — typed edges: contains/imports/calls/extends/depends-on.
- `hotspot_scores` — per-node ranking metrics.
- `pass_runs` — observability: when each pass ran, on what, cost, output hash.
- `code_chunks` — unchanged from v1 (still used for fine-grained semantic search).

### 4.6 Query Layer (new endpoints)

| Endpoint | Purpose |
|----------|---------|
| `GET /v1/cards/:conceptPath?lod=summary` | Fetch a card at requested LoD |
| `GET /v1/map?root=<path>&depth=2` | Repo map at a given depth |
| `POST /v1/search/concept` | Semantic search over **cards** (not chunks) |
| `GET /v1/graph/:nodeId?direction=both&hops=2` | Dependency graph traversal |
| `GET /v1/hotspots?limit=20` | Ranked hotspot list |
| `POST /v1/explain` | "Given this query, return the smallest LoD set that answers it" (router) |

Plus all v1 endpoints remain (`/v1/search`, etc.).

## 5. The Scheduler

Two modes:

- **Incremental** (default, on-commit hook or cron every N min):
  Diff vs last successful run → invalidate affected cards → re-run only dirty passes for affected modules.
- **Full** (weekly or manual):
  Rebuild from scratch. Detects drift between cached cards and actual code.

Trigger sources:
- `engram-code index <repo>` (CLI, on-demand)
- Git hook (`post-commit`)
- Cron (configurable)
- Webhook (GitHub push)

## 6. Engram Integration

engram-code v2 emits **observations** to Engram (the memory faculty) for cross-codebase learning:

- "Repository X has subsystem Y with intent Z" → agents querying Engram for "where is auth handled" across all known repos get answers.
- Pass-run metrics → token spend tracking.
- Hotspot deltas → "this changed a lot last week" surfaced proactively.

Engram does **not** generate cards. engram-code v2 generates; Engram remembers.

## 7. Phasing

### Phase 1 — Foundation (1–2 weeks)
- Pass 1 (structure) via tree-sitter for TS/Python/Go.
- Pass 6 (synthesis) at module level only — Sonnet default.
- New schema (`cards`, `graph_edges`).
- `GET /v1/cards/:path` and `GET /v1/map`.
- CLI: `engram-code index <repo>`.
- **Exit criteria:** can produce module-level LoD cards for engram-code's own repo and Endeavour.

### Phase 2 — Intelligence (2–3 weeks)
- Pass 2 (intent), Pass 3 (contracts), Pass 5 (gotchas).
- Subsystem detection (clustering).
- Repository-level synthesis.
- Per-codebase config (`.engram/config.yaml`).
- **Exit criteria:** an agent given only the LoD cards can correctly answer "where would I add a new payment provider" for a real repo.

### Phase 3 — Maintenance (1–2 weeks)
- Pass 4 (hotspots) with git integration.
- Incremental rescans driven by git diff.
- Pass-run observability + budget guardrails.
- Engram observation emission.
- **Exit criteria:** nightly cron keeps cards fresh on 3+ repos without manual intervention.

### Phase 4 — Polish & Scale (ongoing)
- Optional router agent (dynamic model selection).
- More languages (Elixir, Rust, Swift, Apex/LWC already there).
- Dashboard views (engram-dashboard) for repo maps and hotspots.
- Endeavour/North integration: ContextBuilder consumes cards via LoD.

## 8. Non-Goals (v2)

- Code generation or modification. v2 *describes*, doesn't *write*.
- Real-time (sub-second) updates. Incremental is "minutes," not "live."
- IDE plugin. Out of scope; the API + markdown artifacts are the surface.
- Replacing v1 chunk search. v2 builds on top; chunk search remains for fine-grained needs.

## 9. Open Questions

1. **Card identity & merge:** when a module is renamed/split, how do cards inherit history? Proposed: `concept_path` is the primary key; renames recorded as edges in `graph_edges` with `type: renamed-from`.
2. **Multi-repo synthesis:** when subsystems span repos (e.g., Forge + Engram), do we cross-link? Probably yes, via Engram as the union layer.
3. **Truth-checking:** can we detect when an LLM-generated intent.md is *wrong*? Proposal: cross-validate with a second model on a sample; flag drift.
4. **Sensitive code:** repos with secrets/PII in code — opt-in redaction pass before LLM calls. Default off, configurable.

## 10. Success Metrics

- **Adoption:** Endeavour/North uses LoD cards instead of raw file reads for 80%+ of context-building.
- **Token efficiency:** Median context-build cost drops 5×+ vs raw file ingestion.
- **Freshness:** 95% of cards reflect HEAD within 1h of commit (incremental mode).
- **Cost:** Per-repo full index < $5 for typical (10k file) codebase using default model routing.

---

**Decision log:**
- Build on engram-code (don't fork). v1 chunk search remains as the fine-grained layer. [Beaux, 2026-05-24]
- Markdown + Postgres hybrid (markdown primary, DB derived). [Beaux, 2026-05-24]
- TS/Python/Go ship together in Phase 1. Tree-sitter throughout for language-agnostic primitives. [Beaux, 2026-05-24]
- Configurable model routing per-codebase with sensible defaults; router agent optional. [Beaux, 2026-05-24]
- Initial 6-pass list is a starting point; iterate as we build. New passes may be added (test inventory, data flow) once we have signal. [Beaux, 2026-05-24]
- LoD targets (15/100/500/2k tokens) are ACR-inspired starting points; tune empirically once we have real cards on real repos. [Beaux, 2026-05-24]
