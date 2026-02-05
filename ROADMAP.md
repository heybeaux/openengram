# Engram Roadmap

*Last Updated: 2026-02-04*

## Executive Summary

Engram is a memory storage and retrieval system for AI agents. The core infrastructure is **stable and working**: extraction pipeline fixed, Memory Intelligence v2 shipped (type classification, effectiveScore, safety-critical detection, sleep consolidation), dashboard with graph visualization and docs site live, health endpoint operational, temporal recall shipped.

**Current focus:** Open source launch, cloud planning, remaining documentation, and research into next-generation memory architectures.

---

## Completed Work

### Phase 1: Fix Broken Fundamentals ✅ (2026-02-03)

| ID | Task | Status |
|----|------|--------|
| P0-001 | Fix LLM response case sensitivity | ✅ Complete |
| P0-002 | Add proper error logging to extraction | ✅ Complete |
| P0-003 | Verify entity storage pipeline | ✅ Complete |
| P1-001 | Backfill existing memories (221 → all with 5W1H) | ✅ Complete |
| P1-002 | Fix auto-extractor case sensitivity | ✅ Complete |

---

### Phase 2: Enhance Quality ✅

| ID | Task | Status | Notes |
|----|------|--------|-------|
| P2-002 | Fix memory linking | ✅ Complete | 87+ links working |
| P2-003 | Implement decay | ✅ Complete | Via effectiveScore + ImportanceScorerService |
| P2-004 | Field-level confidence scores | ✅ Complete | Per-field 0.0-1.0 confidence on 5W1H |

---

### Phase 3: Integration ✅

| ID | Task | Status | Notes |
|----|------|--------|-------|
| P3-003 | Context optimization | ✅ Complete | loadContext ranks by effectiveScore DESC, safety-critical never evicted |
| — | OpenClaw hook integration | ✅ Complete | Bidirectional capture (user + assistant messages) |

---

### Phase 4: Dashboard ✅

| ID | Task | Status | Notes |
|----|------|--------|-------|
| P4-001 | Memory browser UI | ✅ Complete | Full dashboard with search/filter |
| P4-003 | Health endpoint | ✅ Complete | `GET /v1/health` (public, no auth) |
| — | D3 graph visualization | ✅ Complete | Node size by effectiveScore, safety-critical badges |
| — | Documentation site | ✅ Complete | 9 pages (intro, quickstart, architecture, API, intelligence features) |

---

### Phase 5: Memory Intelligence & Self-Awareness ✅ (2026-02-03)

| ID | Task | Status | Notes |
|----|------|--------|-------|
| P5-001 | Memory correction / edit API | ✅ Complete | PATCH endpoint + contradiction tracking |
| P5-002 | User identity backfill | ✅ Complete | Normalized user references |
| P5-003 | Intelligent layer classification | ✅ Complete | LLM-based type classification (v2) |
| P5-004 | Agent self-memories | ✅ Complete | subjectType: AGENT support |

---

### Memory Intelligence v2 ✅ (2026-02-04)

Priority-based retrieval with type classification.

| Feature | Status |
|---------|--------|
| Type classification (CONSTRAINT > PREFERENCE > FACT > TASK > EVENT) | ✅ |
| effectiveScore (decay + novelty + usage + pinned) | ✅ |
| ImportanceScorerService (45 tests) | ✅ |
| SafetyDetectorService (16 patterns) | ✅ |
| Safety-critical: never evicted from context (floor 0.6) | ✅ |
| Sleep Consolidation v2 (LLM gist extraction) | ✅ |
| Field-level confidence scores (per-field 0.0-1.0) | ✅ |
| Temporal recall (time-aware query parsing) | ✅ |

**effectiveScore formula:**
```
max(safetyFloor, (baseScore × decayFactor) + noveltyBoost + usageBoost + pinnedBoost)
```

**Decay half-lives:** IDENTITY=∞, PROJECT=60d, SESSION=14d, TASK=3d

---

## In Progress

| Task | Priority | Status | Notes |
|------|----------|--------|-------|
| Dashboard auth | P2 | ⏳ Not Started | Dashboard currently open |
| Nightly consolidation scheduling | P2 | ⏳ Not Started | Service works, needs cron setup |

---

## Remaining Work

### Core

| ID | Task | Priority | Effort | Status |
|----|------|----------|--------|--------|
| P1-003 | Improve basicExtraction fallback | P2 | 2h | 🔴 Not Started |
| P2-001 | Verify deduplication | P2 | 2h | 🔴 Not Started |
| P3-002 | Webhook events | P3 | 8h | 🔴 Not Started |
| P4-002 | Analytics dashboard | P3 | 8h | 🔴 Not Started |

### Documentation

| Page | Status |
|------|--------|
| Concepts: Memory Layers | 🔴 Not Started |
| Concepts: Memory Types | 🔴 Not Started |
| Concepts: Extraction Pipeline | 🔴 Not Started |
| Operations: Self-Hosting Guide | 🔴 Not Started |
| Operations: Configuration Reference | 🔴 Not Started |
| Operations: Health Monitoring | 🔴 Not Started |
| SDK / Client Libraries (Python) | 🔴 Not Started |

### Cloud (Engram Cloud)

| Task | Priority | Status |
|------|----------|--------|
| Multi-tenant architecture | P1 | 🔴 Not Started |
| Stripe billing integration | P1 | 🔴 Not Started |
| Usage metering | P1 | 🔴 Not Started |
| Cloud dashboard (analytics) | P2 | 🔴 Not Started |
| SSO/SAML (Enterprise) | P3 | 🔴 Not Started |

---

## Phase 6: Research — Next-Generation Memory

### P6-001: Video Codec Memory Encoding
**Status:** 🔬 Research
Encode embedding sequences as video frames — leverage hardware-accelerated codec compression.

### P6-002: Multimodal Memory (CLIP-style)
**Status:** 🔬 Research
Joint image-text embeddings so agents can remember screenshots, diagrams, UI states.

### P6-003: Graph Memory (Associative Networks)
**Status:** 🔬 Research
Graph DB for associative retrieval — link memories by causation, temporal proximity, emotional resonance.

### P6-004: Emotional Weighting System
**Status:** 🔬 Research
Sentiment analysis + explicit importance signals + usage-based reinforcement.

### P6-005: Hierarchical Compression (Sleep Consolidation)
**Status:** 🟢 v1 Shipped
LLM-based gist extraction in ConsolidationService. Next: multi-resolution storage (gist vs detail).

### P6-006: Temporal Memory Context
**Status:** 🟢 v1 Shipped
Temporal query parser (13+ expressions), time-aware recall with blended scoring. Next: storage-time resolution of relative dates, rotted time detection.

### P6-007: Sparse Distributed Memory (SDM)
**Status:** 🔬 Research
Mathematical model of human long-term memory. Pattern completion, noise tolerance, biological plausibility.

---

## Architecture

### Key Endpoints

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/v1/memories` | POST | ✅ | Store a memory |
| `/v1/memories/:id` | PATCH | ✅ | Edit a memory |
| `/v1/memories/query` | POST | ✅ | Semantic + temporal search |
| `/v1/memories/graph` | GET | ✅ | Graph data for visualization |
| `/v1/context` | POST | ✅ | Load context for system prompt |
| `/v1/observe` | POST | ✅ | Auto-capture from conversations |
| `/v1/consolidate` | POST | ✅ | Trigger sleep consolidation |
| `/v1/health` | GET | ❌ | System health + metrics |

### Tech Stack

- **Backend:** NestJS, Prisma, PostgreSQL, TypeScript
- **Vector:** pgvector (default) + Pinecone (optional)
- **LLM:** Multi-provider (OpenAI, Anthropic, Ollama, LM Studio)
- **Dashboard:** Next.js, D3.js, Tailwind CSS

---

## Priority Order

1. **Dashboard auth** — Security before wider adoption
2. **Verify deduplication** — Validate existing feature
3. **Remaining doc pages** — Critical for external developers
4. **Python SDK** — Unlock the Python ML/AI community
5. **Webhook events** — Enable reactive integrations
6. **Analytics dashboard** — Usage insights
7. **Engram Cloud** — Managed hosting (see [MONETIZATION.md](./MONETIZATION.md))
8. **Research (P6)** — Long-term exploratory work

---

*Every agent deserves to remember.*
