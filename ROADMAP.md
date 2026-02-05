# Engram Roadmap

*Generated: 2026-02-02*
*Last Updated: 2026-02-04*

## Executive Summary

Engram is a memory storage and retrieval system for AI agents. The core infrastructure is **stable and working**: extraction pipeline fixed, Memory Intelligence v2 shipped (type classification, effectiveScore, safety-critical detection, sleep consolidation), dashboard with graph visualization and docs site live, health endpoint operational.

**Current focus:** Polish, auth, remaining documentation, and research into next-generation memory architectures.

### System Health (as of 2026-02-04)

| Metric | Count | Status |
|--------|-------|--------|
| Total Memories | 547 | ✅ Healthy |
| Extraction Rate | 97% | ✅ Healthy |
| WHO Extraction Rate | 92% | ✅ Healthy |
| Safety-Critical Flagged | 1 | ✅ Working |
| Consolidated | 0 | ⏳ Consolidation job not yet scheduled |
| Entities | 95+ | ✅ Working |
| Memory Links | 87+ | ✅ Working |

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

**Key commits:** `d38406d`, `fe215ed`, `813d400`, `ffb211e`

---

### Phase 2: Enhance Quality (Partial) ✅

| ID | Task | Status | Notes |
|----|------|--------|-------|
| P2-002 | Fix memory linking | ✅ Complete | 87+ links working |
| P2-003 | Implement decay | ✅ Complete | Via effectiveScore + ImportanceScorerService |

---

### Phase 3: OpenClaw Integration (Partial) ✅

| ID | Task | Status | Notes |
|----|------|--------|-------|
| P3-003 | Context optimization | ✅ Complete | loadContext ranks by effectiveScore DESC, safety-critical never evicted |

**Integration artifacts:**
- OpenClaw hook: `~/clawd/hooks/engram/` (captures both user + assistant messages)
- Hook integration doc: `docs/OPENCLAW_HOOK_INTEGRATION.md`
- Active Recall skill: `~/clawd/skills/engram-recall/`

---

### Phase 4: Dashboard & Analytics (Partial) ✅

| ID | Task | Status | Notes |
|----|------|--------|-------|
| P4-001 | Memory browser UI | ✅ Complete | Full dashboard at `localhost:3000` |
| P4-003 | Health checks | ✅ Complete | `GET /v1/health` (public, no auth) |

**Dashboard features shipped:**
- Memory browser with search/filter
- D3 graph visualization (node size by effectiveScore, red ring for safety-critical, 🏥 badge)
- Landing page (marketing)
- Users management page
- API key management
- Settings page
- Mobile-responsive layout
- **9 documentation pages** (intro, quickstart, architecture, API ref, effective score, safety, consolidation, OpenClaw integration)

**Key commits:** `b974b79` (graph), `26cf0ea` (docs)

---

### Phase 5: Memory Intelligence & Self-Awareness ✅ (2026-02-03)

| ID | Task | Status | Notes |
|----|------|--------|-------|
| P5-001 | Memory correction / edit API | ✅ Complete | PATCH endpoint |
| P5-002 | User identity backfill | ✅ Complete | Old `beaux`/`User` → `Beaux` |
| P5-003 | Intelligent layer classification | ✅ Complete | LLM-based type classification (v2) |
| P5-004 | Agent self-memories | ✅ Complete | subjectType: AGENT support |

---

### Memory Intelligence v2 ✅ (2026-02-04)

The biggest feature push — priority-based retrieval with type classification.

| Feature | Status | Notes |
|---------|--------|-------|
| Schema: `memoryType`, `typeConfidence`, `priority`, `userPinned`, `userHidden` | ✅ | Migration applied |
| Schema: `effectiveScore`, `scoreComputedAt`, `safetyCritical` | ✅ | Commit `50a8570` |
| Type-First classification (CONSTRAINT > PREFERENCE > FACT) | ✅ | LLM-based, all 403 memories backfilled |
| ImportanceScorerService | ✅ | Decay, novelty, usage, pinned boosts — 45 tests |
| SafetyDetectorService | ✅ | 16 patterns (allergy, medication, emergency, etc.) |
| effectiveScore backfill | ✅ | 543 memories scored |
| Query: rank by effectiveScore DESC | ✅ | Commit `973e918` |
| Safety-critical: never evicted from context | ✅ | Safety floor 0.6 |
| Sleep Consolidation v2 | ✅ | LLM gist extraction, audit trail in rawJson — Commit `3ae6b95` |

**effectiveScore formula:**
```
max(safetyFloor, (baseScore × decayFactor) + noveltyBoost + usageBoost + pinnedBoost)
```

**Decay half-lives:** IDENTITY=∞, PROJECT=60d, SESSION=14d, TASK=3d  
**Novelty boost:** +0.15 at day 0, tapers to 0 by day 7  
**Safety floor:** 0.6 minimum for safetyCritical memories

---

### Voice & STT ✅ (2026-02-04)

| Feature | Status | Notes |
|---------|--------|-------|
| Local STT (MLX Whisper) | ✅ | Free, private, Apple Silicon |
| TTS (Edge TTS) | ✅ | `en-GB-RyanNeural` (British Ryan — Beaux's preference) |
| Auto-TTS | ✅ | Works on normal replies |

**Known issue:** MEDIA: directive bug — absolute paths blocked for security. Workaround: use `message` tool with `filePath` parameter.

---

## In Progress

### Dashboard Polish

| Task | Status | Notes |
|------|--------|-------|
| Sidebar docs link → internal `/docs` route | 🔄 In Progress | Updating from external `https://docs.engram.dev` |
| Auth implementation | ⏳ Not Started | Dashboard currently open |

### Operations

| Task | Status | Notes |
|------|--------|-------|
| Nightly cron job for sleep consolidation | ⏳ Not Started | Consolidation works but needs scheduling |
| WhaleHawk tickets cleanup | 🔄 In Progress | 17 tickets total |

---

## Remaining Work

### Phase 2 Remaining

| ID | Task | Priority | Effort | Status |
|----|------|----------|--------|--------|
| P1-003 | Improve basicExtraction fallback | P2 | 2h | 🔴 Not Started |
| P2-001 | Verify deduplication is working | P2 | 2h | 🔴 Not Started |
| P2-004 | Add confidence scores to extractions | P2 | 3h | 🔴 Not Started |

### Phase 3 Remaining (OpenClaw Integration)

| ID | Task | Priority | Effort | Status |
|----|------|----------|--------|--------|
| P3-001 | OpenClaw hook docs (formal) | P3 | 2h | 🟡 Partial (integration doc exists) |
| P3-002 | Webhooks for memory events | P3 | 8h | 🔴 Not Started |

### Phase 4 Remaining (Dashboard)

| ID | Task | Priority | Effort | Status |
|----|------|----------|--------|--------|
| P4-002 | Analytics dashboard | P3 | 8h | 🔴 Not Started |
| — | Dashboard auth (API key or login) | P2 | 4h | 🔴 Not Started |

### Documentation Remaining

| Page | Status |
|------|--------|
| Concepts: Memory Layers | 🔴 Not Started |
| Concepts: Memory Types | 🔴 Not Started |
| Concepts: Extraction Pipeline | 🔴 Not Started |
| Operations: Self-Hosting | 🔴 Not Started |
| Operations: Configuration | 🔴 Not Started |
| Operations: Health Monitoring | 🔴 Not Started |
| SDK / Client Libraries | 🔴 Not Started |

---

## Phase 6: Future Research — Alternative Memory Architectures

These are research-stage ideas for next-generation memory beyond vector similarity search.

### P6-001: Video Codec Memory Encoding
**Status:** 🔬 Research  
**Concept:** Encode embedding sequences as video frames — leverage hardware-accelerated codec compression for efficient storage/retrieval.

### P6-002: Multimodal Memory (CLIP-style)
**Status:** 🔬 Research  
**Concept:** Joint image-text embeddings (CLIP/SigLIP) so agents can remember screenshots, diagrams, UI states. "Remember what that error looked like."

### P6-003: Graph Memory (Associative Networks)
**Status:** 🔬 Research  
**Concept:** Neo4j or similar graph DB for associative retrieval — link memories by causation, temporal proximity, emotional resonance. Spreading activation for related memory surfacing.

### P6-004: Emotional Weighting System
**Status:** 🔬 Research  
**Concept:** Sentiment analysis + explicit importance signals + usage-based reinforcement. Emotionally significant moments weighted higher in recall.

### P6-005: Hierarchical Compression (Sleep Consolidation)
**Status:** 🟢 v1 Shipped  
**Concept:** Periodic consolidation jobs that cluster similar memories, extract gist, promote patterns.  
**What shipped:** LLM-based gist extraction in ConsolidationService. Audit trail stored in `rawJson`.  
**Next:** Schedule as nightly cron, add multi-resolution storage (gist vs detail).

### P6-006: Temporal Memory Context
**Status:** 🔬 Research  
**Concept:** Temporal-aware recall — parse relative time in queries, annotate memories with human-readable time context, detect "rotted" relative times.

### P6-007: Sparse Distributed Memory (SDM)
**Status:** 🔬 Research  
**Concept:** Mathematical model of human long-term memory. Stores patterns across many locations, retrieves by pattern completion. Biological plausibility.

---

## Architecture & Infrastructure

### Key Endpoints
| Endpoint | Auth | Description |
|----------|------|-------------|
| `POST /v1/observe` | API Key | Auto-capture from conversation turns |
| `POST /v1/memory` | API Key | Store a memory |
| `POST /v1/memory/context` | API Key | Load context (ranked by effectiveScore) |
| `GET /v1/memory/recall` | API Key | Semantic recall |
| `PATCH /v1/memory/:id` | API Key | Edit a memory |
| `GET /v1/health` | None | System health + metrics |
| `POST /v1/consolidate` | API Key | Trigger sleep consolidation |

### Tech Stack
- **Backend:** NestJS, Prisma, PostgreSQL, TypeScript
- **Vector:** pgvector (default) + Pinecone (optional)
- **LLM:** Multi-provider (OpenAI, Anthropic, Ollama, LM Studio)
- **Dashboard:** Next.js, D3.js, Tailwind CSS
- **Repos:**
  - Backend: `~/projects/agent-memory/engram` ([github.com/heybeaux/engram](https://github.com/heybeaux/engram))
  - Dashboard: `~/projects/agent-memory/engram-dashboard` ([github.com/heybeaux/engram-dashboard](https://github.com/heybeaux/engram-dashboard))

### Environment
- **API:** `http://localhost:3001`
- **Dashboard:** `http://localhost:3000` (LAN: `http://10.0.0.108:3000`)
- **API Key:** Header `X-AM-API-Key`
- **Agent ID:** `agent_rook`

---

## Implementation Priority (What's Next)

Ranked by impact and effort:

1. **Schedule consolidation cron** — Low effort, high value (memories accumulate without compression)
2. **Dashboard auth** — Medium effort, important for security before any public exposure
3. **Verify deduplication (P2-001)** — Low effort, validates existing feature
4. **Remaining doc pages** — Medium effort, needed for external users
5. **Analytics dashboard (P4-002)** — Medium effort, nice-to-have
6. **Confidence scores (P2-004)** — Medium effort, improves extraction quality
7. **Webhooks (P3-002)** — High effort, enables reactive integrations
8. **Research items (P6)** — Long-term, exploratory

---

## Why This Matters

Every agent on the planet wakes up blank. Engram gives them persistent, semantic, layered memory with intelligent scoring and safety awareness.

This isn't just a product. It's infrastructure for agents that can actually *be* someone across sessions.

---

*Last Updated: 2026-02-04 21:45 PST*
