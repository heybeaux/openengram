# Memory Intelligence: Final Design

*Version: 1.0 FINAL*
*Date: 2026-02-03*
*Status: Approved for Implementation*

---

## Changes from Previous Versions

### What Changed and Why

| Issue | Previous Design | Final Design | Reason |
|-------|-----------------|--------------|--------|
| **Classification** | Regex keyword matching | LLM-based in extraction | Red Team: "Keyword matching is embarrassingly naive" |
| **Budget Overflow** | "Newest first" (undefined) | Priority-based eviction | Red Team: "Peanut allergy pushed out by sushi preference is a safety issue" |
| **Schema** | Layer budgets vs Type slots (conflicting) | Layer budgets + Type priority within | Red Team: "There is no single source of truth" |
| **Memory Types** | 6 types (PREFERENCE, CONSTRAINT, FACT, CONTEXT, EVENT, TASK) | 5 types (merged CONTEXT into PROJECT) | Simplification |
| **Priority Field** | None | Explicit 1-5 priority | Enables deterministic eviction |

### Key Insight

The Red Team correctly identified: **Classification is the critical path.** We already run LLM extraction on every message. Adding `memoryType` to that output costs zero additional API calls and is dramatically more accurate than regex.

---

## The Final Architecture

### Core Principle

**Layer determines WHERE. Type determines PRIORITY.**

```
┌─────────────────────────────────────────────────────────────┐
│                    CONTEXT ASSEMBLY                          │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  IDENTITY LAYER (800 tokens)                                │
│  ├─ CONSTRAINT (priority 1) — NEVER evicted by lower        │
│  ├─ PREFERENCE (priority 2) — evicted only by CONSTRAINT    │
│  └─ FACT (priority 3) — evicted by PREFERENCE or CONSTRAINT │
│                                                              │
│  PROJECT LAYER (600 tokens)                                 │
│  ├─ TASK (priority 2) — active tasks for current project    │
│  └─ FACT (priority 3) — project-specific knowledge          │
│                                                              │
│  SESSION LAYER (400 tokens)                                 │
│  └─ EVENT (priority 4) — last 7 days, pure recency          │
│                                                              │
└─────────────────────────────────────────────────────────────┘
Total Budget: 1800 tokens
```

### Single Source of Truth

**This is the ONLY valid budget specification:**

| Layer | Budget | Types Allowed | Purpose |
|-------|--------|---------------|---------|
| IDENTITY | 800 tokens | CONSTRAINT, PREFERENCE, FACT | Who the user IS |
| PROJECT | 600 tokens | TASK, FACT | Current work context |
| SESSION | 400 tokens | EVENT | Recent conversation history |

**Type Priority (applies within each layer):**

| Priority | Type | Eviction Rule | Examples |
|----------|------|---------------|----------|
| 1 | CONSTRAINT | NEVER evicted except by newer CONSTRAINT | Allergies, medications, hard rules |
| 2 | PREFERENCE | Evicted only by CONSTRAINT | Coffee order, dark mode, work hours |
| 2 | TASK | Evicted only by CONSTRAINT (in PROJECT) | Active tasks, reminders |
| 3 | FACT | Evicted by PREFERENCE or CONSTRAINT | Location, job title, relationships |
| 4 | EVENT | Evicted by any higher priority | "Yesterday we discussed X" |

---

## Classification System

### LLM-Based Classification (NOT Regex)

Classification happens during memory extraction. The existing LLM call is extended:

**Current Extraction Output:**
```json
{
  "who": "user_beaux",
  "what": "prefers large oat milk latte every morning",
  "where": null,
  "when": "daily",
  "confidence": 0.92,
  "topics": ["coffee", "preferences", "routine"]
}
```

**New Extraction Output:**
```json
{
  "who": "user_beaux",
  "what": "prefers large oat milk latte every morning",
  "where": null,
  "when": "daily",
  "confidence": 0.92,
  "topics": ["coffee", "preferences", "routine"],
  "memoryType": "PREFERENCE",
  "typeConfidence": 0.95
}
```

### Classification Prompt Addition

Add to existing extraction prompt:

```
Additionally, classify this memory into exactly ONE type:

- CONSTRAINT: Safety-critical rules that must NEVER be violated. Allergies, 
  medications, legal requirements, hard boundaries. Keywords often include 
  "allergic", "can't have", "must not", "medical", "never", "always" when 
  referring to safety. Ask: "Could violating this harm the user?"

- PREFERENCE: Personal preferences about how things should be done. Coffee 
  orders, UI preferences, communication styles, work habits. Ask: "Is this 
  about what the user likes or how they want things?"

- FACT: Stable information about the user or their world. Location, job, 
  relationships, skills, history. Ask: "Is this something that describes 
  who they are or their situation?"

- TASK: Actionable items with implicit or explicit deadlines. Reminders, 
  todos, commitments. Ask: "Is this something to be done?"

- EVENT: Conversational moments, things that happened. Ask: "Is this 
  about something that occurred?"

Important distinctions:
- "I'm allergic to peanuts" → CONSTRAINT (safety-critical)
- "I don't like peanuts" → PREFERENCE (not safety-critical)
- "I can't eat peanuts" → CONSTRAINT (assume safety unless clearly preference)
- "I prefer not to eat peanuts" → PREFERENCE (explicit preference language)
- "I ate peanuts yesterday" → EVENT (past occurrence)

Output memoryType as one of: CONSTRAINT, PREFERENCE, FACT, TASK, EVENT
Output typeConfidence as a number 0.0-1.0
```

### Classification Examples

| Input | memoryType | typeConfidence | Reasoning |
|-------|------------|----------------|-----------|
| "I'm deathly allergic to shellfish" | CONSTRAINT | 0.98 | Safety-critical, could cause harm |
| "I take metformin twice daily" | CONSTRAINT | 0.95 | Medication = safety-critical |
| "Never schedule meetings before 10am" | CONSTRAINT | 0.85 | "Never" + strong boundary language |
| "I prefer oat milk in my coffee" | PREFERENCE | 0.95 | "Prefer" + personal choice |
| "Dark mode is the only way" | PREFERENCE | 0.88 | Strong preference, not safety |
| "I work from home on Fridays" | FACT | 0.90 | Stable schedule information |
| "I live in Vancouver" | FACT | 0.95 | Location = fact |
| "We need to review PR #123" | TASK | 0.92 | Actionable item |
| "Yesterday we talked about the roadmap" | EVENT | 0.90 | Past conversation reference |

### Low-Confidence Handling

If `typeConfidence < 0.7`:
1. Default to FACT (safe middle ground)
2. Flag for potential human review in dashboard
3. Log for classification improvement analysis

---

## Budget Allocation & Overflow

### Retrieval Algorithm

```typescript
async loadContext(userId: string, options: LoadContextOptions): Promise<ContextResult> {
  const layers = {
    identity: await this.loadLayer(userId, 'IDENTITY', 800, options),
    project: await this.loadLayer(userId, 'PROJECT', 600, options),
    session: await this.loadLayer(userId, 'SESSION', 400, options),
  };
  
  return {
    memories: [...layers.identity, ...layers.project, ...layers.session],
    totalTokens: this.countTokens(layers),
    evictions: this.getEvictions(layers), // For debugging
  };
}

async loadLayer(
  userId: string, 
  layer: MemoryLayer, 
  budget: number,
  options: LoadContextOptions
): Promise<Memory[]> {
  // Get all candidate memories for this layer
  const candidates = await this.getCandidates(userId, layer, options);
  
  // Sort by priority (ascending = higher priority first), then recency
  candidates.sort((a, b) => {
    // Priority first (1 = CONSTRAINT is highest)
    if (a.priority !== b.priority) return a.priority - b.priority;
    // Pinned second
    if (a.userPinned !== b.userPinned) return a.userPinned ? -1 : 1;
    // Recency third
    return b.createdAt.getTime() - a.createdAt.getTime();
  });
  
  // Fill to budget
  return this.fillToBudget(candidates, budget);
}
```

### Overflow Strategy: Priority-Based Eviction

When a layer exceeds budget, eviction follows strict rules:

**Rule 1: Higher priority NEVER evicted by lower priority**
- A PREFERENCE cannot push out a CONSTRAINT
- A FACT cannot push out a PREFERENCE
- An EVENT cannot push out a FACT

**Rule 2: Within same priority, recency wins**
- Newer PREFERENCE can push out older PREFERENCE
- User-pinned memories get recency boost (treated as "now")

**Rule 3: CONSTRAINTS have protected minimum**
- IDENTITY layer reserves 200 tokens for CONSTRAINTS
- Even if IDENTITY has 50 preferences, all CONSTRAINTS fit in their reserved space
- Only if CONSTRAINTS exceed 200 tokens do they compete with each other (newest wins)

```typescript
function fillToBudget(candidates: Memory[], budget: number): Memory[] {
  const result: Memory[] = [];
  let usedTokens = 0;
  
  // Phase 1: All CONSTRAINTS (priority 1) up to reserved minimum
  const constraints = candidates.filter(m => m.priority === 1);
  const constraintReserve = Math.min(budget * 0.25, 200); // 25% or 200 tokens
  
  for (const memory of constraints) {
    const tokens = estimateTokens(memory);
    if (usedTokens + tokens <= constraintReserve) {
      result.push(memory);
      usedTokens += tokens;
    }
  }
  
  // Phase 2: Fill remaining budget by priority order
  for (const memory of candidates) {
    if (result.includes(memory)) continue; // Skip already added
    
    const tokens = estimateTokens(memory);
    if (usedTokens + tokens <= budget) {
      result.push(memory);
      usedTokens += tokens;
    }
  }
  
  return result;
}
```

### Concrete Example: Overflow Scenario

User has accumulated:
- 3 CONSTRAINTS (150 tokens): peanut allergy, shellfish allergy, medication schedule
- 25 PREFERENCES (900 tokens): coffee order, dark mode, meeting times, etc.
- 10 FACTS (400 tokens): location, job, relationships, etc.

IDENTITY budget: 800 tokens

**Eviction process:**
1. Reserve 200 tokens for CONSTRAINTS → All 3 fit (150 tokens used)
2. Remaining budget: 650 tokens
3. Fill with PREFERENCES by recency → ~18 fit (650 tokens)
4. 7 PREFERENCES evicted
5. 0 FACTS fit (PREFERENCES have higher priority)
6. FACTS pushed to overflow log

**Result:**
- All CONSTRAINTS: ✅ Always present
- Most recent 18 PREFERENCES: ✅ Present
- 7 older PREFERENCES: ❌ Evicted (logged)
- 10 FACTS: ❌ Evicted (lower priority)

**The peanut allergy is NEVER forgotten.**

---

## Schema Changes

### Prisma Model Additions

```prisma
// Add to schema.prisma

enum MemoryType {
  CONSTRAINT  // Priority 1: Safety-critical
  PREFERENCE  // Priority 2: User preferences  
  FACT        // Priority 3: Stable information
  TASK        // Priority 2: Actionable items (PROJECT layer)
  EVENT       // Priority 4: Conversational moments
}

model Memory {
  // ... existing fields ...
  
  // NEW: Memory classification
  memoryType      MemoryType?  @map("memory_type")
  typeConfidence  Float?       @map("type_confidence")  // 0.0-1.0
  priority        Int          @default(3)              // 1=highest, 4=lowest
  
  // NEW: User controls
  userPinned      Boolean      @default(false) @map("user_pinned")
  userHidden      Boolean      @default(false) @map("user_hidden")
  
  // EXISTING: Keep layer for storage organization
  layer           MemoryLayer  // IDENTITY, PROJECT, SESSION
  
  @@index([userId, layer, priority, createdAt(sort: Desc)])
  @@index([userId, memoryType, userHidden])
}

model MemoryExtraction {
  // ... existing fields ...
  
  // NEW: Classification from LLM
  memoryType      MemoryType?  @map("memory_type")
  typeConfidence  Float?       @map("type_confidence")
}
```

### Migration SQL

```sql
-- Migration: add_memory_classification

-- Step 1: Add columns
ALTER TABLE memories ADD COLUMN memory_type TEXT;
ALTER TABLE memories ADD COLUMN type_confidence FLOAT;
ALTER TABLE memories ADD COLUMN priority INTEGER DEFAULT 3;
ALTER TABLE memories ADD COLUMN user_pinned BOOLEAN DEFAULT FALSE;
ALTER TABLE memories ADD COLUMN user_hidden BOOLEAN DEFAULT FALSE;

-- Step 2: Add extraction columns
ALTER TABLE memory_extractions ADD COLUMN memory_type TEXT;
ALTER TABLE memory_extractions ADD COLUMN type_confidence FLOAT;

-- Step 3: Create indexes
CREATE INDEX idx_memories_layer_priority ON memories(user_id, layer, priority, created_at DESC);
CREATE INDEX idx_memories_type_hidden ON memories(user_id, memory_type, user_hidden);

-- Step 4: Backfill priority from existing layer (temporary, will be replaced by LLM)
UPDATE memories SET priority = CASE
  WHEN layer = 'IDENTITY' THEN 3  -- Default to FACT priority
  WHEN layer = 'PROJECT' THEN 3
  WHEN layer = 'SESSION' THEN 4   -- EVENT priority
  ELSE 3
END WHERE priority IS NULL;
```

### Priority Mapping

```typescript
const TYPE_TO_PRIORITY: Record<MemoryType, number> = {
  CONSTRAINT: 1,
  PREFERENCE: 2,
  TASK: 2,
  FACT: 3,
  EVENT: 4,
};

function setMemoryPriority(memory: Memory, type: MemoryType): number {
  return TYPE_TO_PRIORITY[type] ?? 3;
}
```

---

## Implementation Plan

### Week 1: Classification (Days 1-5)

**Day 1-2: Schema Migration**
- [ ] Add Prisma schema changes
- [ ] Run migration on dev database
- [ ] Verify indexes created

**Day 3-4: LLM Classification**
- [ ] Update extraction prompt with classification instructions
- [ ] Add `memoryType` and `typeConfidence` to extraction output parsing
- [ ] Add `priority` assignment from type
- [ ] Unit tests for classification edge cases

**Day 5: Backfill**
- [ ] Write backfill script using LLM classification
- [ ] Run on existing memories (batch of 100 at a time)
- [ ] Manual review of 50 random classifications
- [ ] Fix prompt if accuracy < 90%

### Week 2: Retrieval (Days 6-10)

**Day 6-7: Layer-Based Retrieval**
- [ ] Implement `loadLayer()` with priority sorting
- [ ] Implement `fillToBudget()` with CONSTRAINT reservation
- [ ] Replace existing `loadContext()` with new implementation

**Day 8-9: Overflow Handling**
- [ ] Add eviction logging (which memories were dropped and why)
- [ ] Add overflow metrics to dashboard
- [ ] Integration test: 50 CONSTRAINTS still works (all surface)
- [ ] Integration test: CONSTRAINT never evicted by PREFERENCE

**Day 10: Testing**
- [ ] End-to-end test: Coffee problem solved
- [ ] End-to-end test: Peanut allergy never forgotten
- [ ] Load test: 10,000 memories, <200ms retrieval

### Week 3: Polish (Days 11-15)

**Day 11-12: User Controls**
- [ ] Add `POST /memories/:id/pin` endpoint
- [ ] Add `POST /memories/:id/hide` endpoint
- [ ] Add pin/hide UI to dashboard

**Day 13-14: Monitoring**
- [ ] Add classification confidence histogram to dashboard
- [ ] Add "low confidence" queue for review
- [ ] Add layer utilization metrics

**Day 15: Documentation**
- [ ] Update API documentation
- [ ] Update ARCHITECTURE_DECISION.md with final design
- [ ] Write runbook for common issues

---

## Success Criteria

### Must Pass (Blocking)

| Test | Description | Verification |
|------|-------------|--------------|
| Coffee Test | "I need a large oat milk latte every morning" surfaces at bootstrap | Create memory, new session, check context |
| Allergy Test | "I'm deathly allergic to peanuts" ALWAYS surfaces | Create memory, add 100 preferences, verify allergy still present |
| Priority Test | CONSTRAINT never evicted by PREFERENCE | Fill IDENTITY to 150%, verify all CONSTRAINTS present |
| Classification Test | 90%+ accuracy on test set of 100 examples | Manual review of classifications |
| Latency Test | loadContext < 200ms for 10,000 memories | Load test with production-like data |

### Should Pass (Important)

| Test | Description | Verification |
|------|-------------|--------------|
| Pin Override | Pinned FACT surfaces even when PREFERENCE budget is full | Pin a fact, verify it surfaces |
| Hide Works | Hidden memory never surfaces | Hide memory, verify absent from all contexts |
| Low Confidence Flag | typeConfidence < 0.7 flagged for review | Check dashboard queue |
| Backfill Complete | All existing memories have type and priority | `SELECT COUNT(*) WHERE memory_type IS NULL` = 0 |

### Monitoring (Ongoing)

| Metric | Target | Alert Threshold |
|--------|--------|-----------------|
| Avg typeConfidence | > 0.85 | < 0.75 |
| CONSTRAINT eviction rate | 0% | > 0% |
| loadContext p95 latency | < 200ms | > 500ms |
| Low confidence queue size | < 50/day | > 200/day |

---

## FAQ

### Why not keep the type-based slots from v3?

The v3 design had type-based slots (PREFERENCES: 300, FACTS: 400, etc.). This creates artificial boundaries. A user with 10 constraints and 2 preferences shouldn't have 290 tokens wasted in the "preferences slot."

Layer-based budgets with type priority within each layer is more flexible and matches how memories are actually stored.

### Why reserve 200 tokens for CONSTRAINTS?

Safety. If a user has one peanut allergy and 50 coffee preferences, the allergy must surface. The 200-token reserve ensures CONSTRAINTS have dedicated space before preferences start competing.

### What if classification is wrong?

Three defenses:
1. **User pin**: Override classification entirely
2. **Low confidence flag**: Queue for human review
3. **Reclassification**: Can re-run LLM on flagged memories

### How does this handle contradictions?

It doesn't—yet. If user says "I prefer tea" then "I prefer coffee", both surface. The agent sees both and must reason about recency.

**Future enhancement**: Add topic overlap detection and surface only most recent preference per topic.

### What about non-English users?

LLM classification handles multiple languages naturally. The prompt examples are English, but the LLM understands "J'aime le café" as a preference.

### Isn't calling the LLM for classification expensive?

No. Classification happens during extraction, which already makes an LLM call. We're adding ~50 tokens to an existing prompt, not making a new call. Cost increase: ~$0.0001 per memory.

---

## Summary

**The architecture is now unambiguous:**

1. **Layer determines budget**: IDENTITY (800), PROJECT (600), SESSION (400)
2. **Type determines priority**: CONSTRAINT (1) > PREFERENCE/TASK (2) > FACT (3) > EVENT (4)
3. **LLM classifies at write time**: No regex, no keywords, actual understanding
4. **Priority-based eviction**: CONSTRAINTS never evicted by lower priority
5. **CONSTRAINT reserve**: 200 tokens guaranteed for safety-critical memories

**The coffee problem is solved**: Preference detected by LLM → priority 2 → surfaces in IDENTITY layer.

**The peanut allergy is protected**: Constraint detected by LLM → priority 1 → reserved space → NEVER evicted.

**Implementation in 3 weeks**: Schema (2 days) → Classification (3 days) → Retrieval (5 days) → Polish (5 days).

---

*"Simple but robust. Classification is the foundation. Priority is the guarantee."*

— Blue Team Final
