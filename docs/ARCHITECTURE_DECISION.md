# Architecture Decision: Memory Intelligence

*Date: 2026-02-03*
*Decision Maker: Beaux Walton*
*Participants: Rook, Blue Team v2, Blue Team v3, Red Teams (x3)*

---

## Decision

**We chose: Simple but Robust (Type-First / Preferences Are Special)**

Rejected the complex v1/v2 scoring approach in favor of explicit type classification.

---

## Context

The problem: Agent memories exist in the database but don't surface correctly at bootstrap. Beaux's coffee preference was stored but didn't appear in context.

We ran a full adversarial design process:
- Blue Team v1: Complex scoring with 5-component formula, tiers, caching, consolidation
- Red Teams (x3): Found 7 critical issues including feedback loops, scaling problems, cache races
- Blue Team v2: Patched v1 with fixes (novelty boost, LSH clustering, rollback)
- Blue Team v3: Alternative "Type-First Retrieval" approach
- Rook: "Preferences Are Special" approach

---

## Options Considered

### Option A: Complex Scoring (v1/v2)
- Unified effectiveScore formula
- 5-tier system + 4-layer system
- Materialized score cache
- Nightly consolidation with clustering
- Semantic boosting

**Pros:** Sophisticated, handles edge cases theoretically
**Cons:** Complex, fragile, 5-6 weeks, many failure modes

### Option B: Type-First / Preferences Are Special (v3/Rook)
- Classify memories by type at write time
- Preferences auto-promoted to IDENTITY
- Layer-based budgets (not tier-based)
- No cache, compute fresh at retrieval
- User pins as escape valve

**Pros:** Simple, robust, 3 weeks, fewer failure modes
**Cons:** Less nuanced, no automatic reinforcement

---

## Decision Rationale

> "When I talk to you, I want you to remember our conversations. Let's not make something overly complex that actually doesn't benefit you."
> — Beaux, 2026-02-03

The purpose of Engram is for the agent to remember. Complex systems fail in complex ways. A simpler system that works 90% of the time with predictable behavior beats a sophisticated system that fails catastrophically 5% of the time.

Critical insight: **The coffee problem isn't a scoring problem — it's a classification problem.** We failed to recognize the memory as a preference, not to score it correctly.

---

## Implementation Plan

### Phase 1: Preference Detection (Week 1)
- Add `memoryType` field: PREFERENCE, FACT, EVENT, TASK
- Implement preference detection at write time (keyword matching)
- Auto-promote detected preferences to IDENTITY layer

### Phase 2: Layer-Based Retrieval (Week 2)  
- Replace scoring-based retrieval with layer budgets:
  - IDENTITY: all, up to 800 tokens
  - PROJECT: top 10 by recency, up to 600 tokens
  - SESSION: last 7 days, up to 400 tokens
- Remove score cache (compute fresh)

### Phase 3: User Controls (Week 3)
- Add pin/unpin functionality
- Add "always remember this" detection
- Add memory type override in API

### Phase 4: Polish & Testing
- Backfill existing memories with types
- Integration testing with OpenClaw
- Documentation

---

## Success Criteria

1. Coffee preference surfaces at bootstrap ✓
2. Peanut allergy (if mentioned) ALWAYS surfaces ✓
3. No feedback loops — new memories get fair chance ✓
4. No cache staleness issues ✓
5. System is debuggable — can explain why any memory did/didn't surface ✓

---

## Artifacts

- `MEMORY_INTELLIGENCE_DESIGN.md` — Original v1 design (archived)
- `MEMORY_INTELLIGENCE_DESIGN_V2.md` — Patched v1 (archived)
- `MEMORY_INTELLIGENCE_ALT.md` — Type-First approach (reference)
- `MEMORY_INTELLIGENCE_CRITIQUE.md` — Red Team critique (reference)

---

## Signatures

- **Beaux Walton** — Decision maker
- **Rook** — Implementer, advocate for simplicity

*"Simple but robust. That's the way."*
