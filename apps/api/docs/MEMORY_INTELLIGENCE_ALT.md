# Memory Intelligence v2: Type-First Retrieval

*Alternative Architecture Design*
*Author: Blue Team v3 (Rook)*
*Date: 2026-02-03*

---

## Philosophy: Different Memories Are Different

v1 tried to score all memories on a single scale. That's the fundamental mistake.

**"I prefer oat milk in my coffee"** and **"We discussed the Q4 roadmap yesterday"** are not the same kind of information. Trying to rank them on the same scale is like asking "What's heavier, a kilogram of love or a meter of happiness?"

### The Core Insight

Memories have **types** that determine how they should behave:

| Type | Retrieval Strategy | Decay | Example |
|------|-------------------|-------|---------|
| PREFERENCE | Always surface | Never | "I take my coffee with oat milk" |
| CONSTRAINT | Always surface | Never | "I'm allergic to peanuts" |
| FACT | Surface when relevant | Slow | "Beaux lives in Vancouver" |
| CONTEXT | Surface for project | Medium | "Q4 goal is launch memory system" |
| EVENT | Surface if recent | Fast | "We talked about this yesterday" |
| TASK | Surface until done | Completion | "Need to review PR #123" |

### The Philosophy Difference

| v1 | v2 |
|----|-----|
| Score everything, rank by score | Type everything, retrieve by type |
| Complex scoring formula | Simple per-type rules |
| Precompute and cache | Compute fresh at retrieval |
| Semantic similarity is king | Type membership is king |
| User is passive | User can promote/demote |

---

## Architecture: Slot-Based Context Assembly

Instead of "fill budget with highest-scoring memories", we use **slots**:

```
Context Budget: 2000 tokens
┌──────────────────────────────────────────────────┐
│ PREFERENCES SLOT (300 tokens, required)          │
│ • All PREFERENCE + CONSTRAINT memories           │
│ • Always included, no scoring needed             │
├──────────────────────────────────────────────────┤
│ FACTS SLOT (400 tokens, semantic match)          │
│ • FACT memories, ranked by relevance to query    │
│ • No query? Use recent topics from last session  │
├──────────────────────────────────────────────────┤
│ PROJECT SLOT (500 tokens, project-filtered)      │
│ • CONTEXT memories for active project            │
│ • All recent tasks for project                   │
├──────────────────────────────────────────────────┤
│ RECENT SLOT (600 tokens, recency-based)          │
│ • EVENT memories from last 7 days                │
│ • Pure recency ordering, no scoring              │
├──────────────────────────────────────────────────┤
│ AGENT SLOT (200 tokens, reserved)                │
│ • Agent's self-memories (IDENTITY, lessons)      │
└──────────────────────────────────────────────────┘
```

### Key Properties

1. **PREFERENCES always surface** — No scoring needed. Coffee preference is a PREFERENCE. It goes in the slot. Done.

2. **No precomputed scores** — We don't cache scores that go stale. Each slot has its own retrieval strategy executed fresh.

3. **Overflow handling** — If PREFERENCES slot has room, it stays empty (not filled with junk). If it overflows, newest preferences first + pagination in response.

4. **No nightly consolidation** — EVENT memories decay naturally via the 7-day window. We don't cluster or merge—we just stop retrieving old events.

---

## Data Model Changes

Minimal schema additions to existing Engram:

```prisma
enum MemoryType {
  PREFERENCE    // User preferences (coffee, dark mode)
  CONSTRAINT    // Hard requirements (allergies, availability)
  FACT          // Stable facts (lives in Vancouver, job title)
  CONTEXT       // Project-specific knowledge
  EVENT         // Conversational events ("we discussed X")
  TASK          // Actionable items
}

model Memory {
  // ... existing fields ...
  
  // NEW: Explicit type (replaces layer for intelligence purposes)
  memoryType    MemoryType?   @map("memory_type")
  
  // NEW: User feedback (replaces complex importance scoring)
  userPinned    Boolean       @default(false) @map("user_pinned")
  userHidden    Boolean       @default(false) @map("user_hidden")
  feedbackScore Int           @default(0) @map("feedback_score")  // -N to +N from 👍/👎
  
  // KEEP: Existing layer for compatibility
  layer         MemoryLayer   // Still used for storage/organization
  
  // REMOVE (or deprecate): Complex scoring
  // importanceScore  -- no longer used for retrieval
  // retrievalCount   -- still track for analytics, not retrieval
}
```

### Type Assignment

Type is assigned at memory creation, either:
1. **Explicit** — API caller specifies `memoryType`
2. **Inferred** — LLM extraction suggests type (already happening, just add field)
3. **Default** — Based on `layer` (IDENTITY→FACT, SESSION→EVENT, etc.)

```typescript
function inferMemoryType(memory: Memory, extraction?: MemoryExtraction): MemoryType {
  // Explicit wins
  if (memory.memoryType) return memory.memoryType;
  
  // Check extraction for signals
  if (extraction) {
    // Preferences have specific patterns
    if (/prefer|like|always|never|love|hate/i.test(extraction.what)) {
      return 'PREFERENCE';
    }
    // Constraints are safety-critical
    if (/allerg|can't|must not|require/i.test(extraction.what)) {
      return 'CONSTRAINT';
    }
    // Tasks have action words
    if (/need to|should|todo|reminder/i.test(extraction.what)) {
      return 'TASK';
    }
  }
  
  // Fall back to layer-based defaults
  switch (memory.layer) {
    case 'IDENTITY': return 'FACT';
    case 'PROJECT': return 'CONTEXT';
    case 'SESSION': return 'EVENT';
    case 'TASK': return 'TASK';
    default: return 'EVENT';
  }
}
```

---

## How It Solves Coffee

The original problem:
> "Beaux's coffee preference exists in the database but didn't make it into the agent's context."

### Step by Step

**1. Memory Creation**
```
User says: "I can't start my day without a large oat milk latte"
↓
Memory created:
  raw: "I can't start my day without a large oat milk latte"
  layer: IDENTITY
  memoryType: PREFERENCE (inferred from "can't...without", beverage context)
```

**2. Context Loading (Bootstrap, no query)**
```typescript
async loadContext(userId: string, options: LoadContextOptions) {
  const slots = {
    preferences: await this.getPreferencesSlot(userId, 300),
    facts: await this.getFactsSlot(userId, 400, options.recentTopics),
    project: await this.getProjectSlot(userId, options.projectId, 500),
    recent: await this.getRecentSlot(userId, 600),
    agent: await this.getAgentSlot(options.agentId, 200),
  };
  
  return this.assembleContext(slots);
}
```

**3. Preferences Slot Retrieval**
```typescript
async getPreferencesSlot(userId: string, tokenBudget: number) {
  // Get ALL preferences and constraints - no scoring, no filtering
  const memories = await this.prisma.memory.findMany({
    where: {
      userId,
      memoryType: { in: ['PREFERENCE', 'CONSTRAINT'] },
      userHidden: false,
      deletedAt: null,
    },
    orderBy: [
      { userPinned: 'desc' },      // Pinned first
      { feedbackScore: 'desc' },   // Thumbs-up'd second
      { createdAt: 'desc' },       // Newest third
    ],
  });
  
  // Fill up to budget
  return this.fillToTokenBudget(memories, tokenBudget);
}
```

**4. Result**
```
Context assembled:
───────────────────────────────
PREFERENCES:
• Beaux can't start his day without a large oat milk latte
• Beaux prefers dark mode for all applications
• [other preferences...]

FACTS:
• Beaux lives in Vancouver
• [relevant facts...]

RECENT:
• Yesterday we discussed the Q4 roadmap
• [recent events...]
───────────────────────────────
```

**Coffee preference is in the context. Done.**

No scoring formula. No semantic boost. No cache. Just: PREFERENCE type → PREFERENCES slot → always included.

---

## Trade-offs vs v1

### What We Gain

| Benefit | Why |
|---------|-----|
| **Simplicity** | No 5-component scoring formula. No cache invalidation. No nightly clustering. |
| **Predictability** | "Why didn't X surface?" → "Because it's type Y and that slot was full" |
| **Cold start solved** | New preferences surface immediately (they're preferences, so they go in the slot) |
| **Bootstrap solved** | No query needed—preferences always surface regardless |
| **No staleness** | No precomputed scores to go stale |
| **Rollback trivial** | No consolidation = nothing to rollback |
| **Scaling** | No O(n²) clustering. Each slot query is O(n) max. |

### What We Lose

| Loss | Mitigation |
|------|------------|
| **Nuanced scoring** | User feedback (👍/👎) captures what matters; complex inference doesn't |
| **Semantic similarity for preferences** | Preferences are few; just show them all |
| **Pattern detection** | Can add later as separate system (doesn't need to affect retrieval) |
| **Emotional intensity** | Constraints + user pins capture "this is important" better |
| **Consolidation/merging** | Trade-off accepted: keep duplicate preferences, let user curate |

### Honest Assessment

v2 is **less sophisticated** than v1. It won't detect subtle patterns or automatically promote emotionally significant memories.

But v2 is **more reliable**. The coffee preference *will* surface. The peanut allergy *won't* be forgotten. And when something goes wrong, you can explain why in one sentence.

---

## Implementation

### Phase 1: Type Assignment (Week 1)

**Schema migration:**
```sql
-- Add memory_type column
ALTER TABLE memories ADD COLUMN memory_type TEXT;

-- Add user curation columns
ALTER TABLE memories ADD COLUMN user_pinned BOOLEAN DEFAULT FALSE;
ALTER TABLE memories ADD COLUMN user_hidden BOOLEAN DEFAULT FALSE;
ALTER TABLE memories ADD COLUMN feedback_score INTEGER DEFAULT 0;

-- Create index for type-based retrieval
CREATE INDEX idx_memories_type ON memories(user_id, memory_type, user_hidden);
```

**Backfill existing memories:**
```typescript
async backfillMemoryTypes() {
  const memories = await this.prisma.memory.findMany({
    where: { memoryType: null },
    include: { extraction: true },
  });
  
  for (const memory of memories) {
    const memoryType = inferMemoryType(memory, memory.extraction);
    await this.prisma.memory.update({
      where: { id: memory.id },
      data: { memoryType },
    });
  }
}
```

### Phase 2: Slot-Based Retrieval (Week 2)

**Context Allocator Service:**
```typescript
@Injectable()
export class SlotAllocatorService {
  private readonly SLOT_CONFIG = {
    preferences: { budget: 0.15, types: ['PREFERENCE', 'CONSTRAINT'] },
    facts: { budget: 0.20, types: ['FACT'] },
    project: { budget: 0.25, types: ['CONTEXT'] },
    recent: { budget: 0.30, types: ['EVENT'] },
    agent: { budget: 0.10, types: ['FACT', 'PREFERENCE'] },  // Agent self-memories
  };

  async loadContext(userId: string, options: LoadContextOptions): Promise<string> {
    const totalBudget = options.maxTokens || 2000;
    const slots: Record<string, Memory[]> = {};
    
    for (const [name, config] of Object.entries(this.SLOT_CONFIG)) {
      const slotBudget = Math.floor(totalBudget * config.budget);
      slots[name] = await this.fillSlot(userId, config.types, slotBudget, options);
    }
    
    return this.formatContext(slots);
  }

  private async fillSlot(
    userId: string,
    types: MemoryType[],
    budget: number,
    options: LoadContextOptions
  ): Promise<Memory[]> {
    let query: Prisma.MemoryFindManyArgs = {
      where: {
        userId,
        memoryType: { in: types },
        userHidden: false,
        deletedAt: null,
      },
      orderBy: [
        { userPinned: 'desc' },
        { feedbackScore: 'desc' },
        { createdAt: 'desc' },
      ],
    };

    // Type-specific filtering
    if (types.includes('EVENT')) {
      query.where.createdAt = { gte: subDays(new Date(), 7) };
    }
    if (types.includes('CONTEXT') && options.projectId) {
      query.where.projectId = options.projectId;
    }

    const memories = await this.prisma.memory.findMany(query);
    return this.trimToTokenBudget(memories, budget);
  }

  private trimToTokenBudget(memories: Memory[], budget: number): Memory[] {
    const result: Memory[] = [];
    let used = 0;
    
    for (const memory of memories) {
      const tokens = this.estimateTokens(memory.raw);
      if (used + tokens > budget) break;
      result.push(memory);
      used += tokens;
    }
    
    return result;
  }
}
```

### Phase 3: User Feedback (Week 3)

**Feedback endpoint:**
```typescript
@Post('/memories/:id/feedback')
async submitFeedback(
  @Param('id') id: string,
  @Body() dto: FeedbackDto
) {
  const delta = dto.helpful ? 1 : -1;
  
  await this.prisma.memory.update({
    where: { id },
    data: {
      feedbackScore: { increment: delta },
      // Auto-pin if 3+ positive feedback
      userPinned: dto.helpful && (await this.getFeedbackScore(id)) >= 2,
    },
  });
}

@Post('/memories/:id/pin')
async togglePin(@Param('id') id: string) {
  const memory = await this.prisma.memory.findUnique({ where: { id } });
  await this.prisma.memory.update({
    where: { id },
    data: { userPinned: !memory.userPinned },
  });
}

@Post('/memories/:id/hide')
async hideMemory(@Param('id') id: string) {
  await this.prisma.memory.update({
    where: { id },
    data: { userHidden: true },
  });
}
```

### Phase 4: Recent Topics (Week 4)

For the FACTS slot, we need *some* relevance signal when there's no query. Solution: track recent topics.

```typescript
@Injectable()
export class RecentTopicsService {
  // Track topics mentioned in last N sessions
  async getRecentTopics(userId: string, limit = 10): Promise<string[]> {
    const recentSessions = await this.prisma.session.findMany({
      where: { userId },
      orderBy: { startedAt: 'desc' },
      take: 3,
      include: {
        memories: {
          include: { extraction: true },
          where: { deletedAt: null },
        },
      },
    });
    
    // Collect topics from extractions
    const topicCounts = new Map<string, number>();
    for (const session of recentSessions) {
      for (const memory of session.memories) {
        for (const topic of memory.extraction?.topics || []) {
          topicCounts.set(topic, (topicCounts.get(topic) || 0) + 1);
        }
      }
    }
    
    // Return top topics by frequency
    return [...topicCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([topic]) => topic);
  }
}
```

For FACTS retrieval with recent topics:
```typescript
async getFactsSlot(userId: string, budget: number, recentTopics?: string[]) {
  if (recentTopics?.length) {
    // Use embedding similarity to recent topics
    const topicEmbedding = await this.embedding.generate(recentTopics.join(', '));
    return this.embedding.search(userId, topicEmbedding, budget, {
      memoryType: 'FACT',
    });
  }
  
  // No topics? Just return most recently created/accessed facts
  return this.prisma.memory.findMany({
    where: { userId, memoryType: 'FACT', userHidden: false },
    orderBy: { createdAt: 'desc' },
    take: 20,  // Will trim to budget
  });
}
```

---

## Comparison: Why This Might Be Better

| Criteria | v1 | v2 | Winner |
|----------|----|----|--------|
| Solves coffee problem | Eventually (if scored high enough) | Always (it's a PREFERENCE) | **v2** |
| Solves peanut allergy | Risky (might decay) | Always (it's a CONSTRAINT) | **v2** |
| Debuggability | "score was 0.32" | "it's type EVENT" | **v2** |
| Bootstrap context | Needs workaround | Just works | **v2** |
| Cache staleness | Major issue | No cache | **v2** |
| Clustering scale | O(n²) problem | Not needed | **v2** |
| Nuanced ranking | Better | Simpler | v1 |
| Pattern detection | Built-in | Separate system | v1 |
| Emotional awareness | Detected | User-signaled | v1 (slightly) |
| Implementation effort | 5-6 weeks | 3-4 weeks | **v2** |

### When v1 Is Better

v1 shines when:
- You have lots of data and patterns emerge
- Users don't give explicit feedback
- Emotional nuance matters (therapy apps, journaling)
- You need sophisticated consolidation (enterprise knowledge bases)

### When v2 Is Better

v2 shines when:
- Reliability > sophistication
- User safety is critical (allergies, constraints)
- You need to explain "why did/didn't X surface?"
- You're building a personal assistant (not a knowledge base)
- You need to ship in 3-4 weeks, not 6+

---

## Migration Path

v2 doesn't replace v1—it can coexist:

1. **Add type field** — Non-breaking, null allowed
2. **Backfill types** — Run inference on existing memories
3. **Add slot-based retrieval** — New endpoint alongside existing
4. **A/B test** — Compare satisfaction between v1 and v2 retrieval
5. **Deprecate v1** — If v2 wins, stop computing importance scores

The existing `importanceScore` and `layer` fields remain for analytics and backward compatibility. We just stop using them for retrieval.

---

## Summary

**v1 asks:** "How important is this memory?"
**v2 asks:** "What kind of memory is this?"

The shift from *scoring* to *typing* eliminates the core issues Red Team found:
- No cache staleness (no cache)
- No cold start (preferences surface by type)
- No bootstrap problem (type-based retrieval needs no query)
- No O(n²) consolidation (no consolidation)
- Trivial rollback (nothing to rollback)

Trade-off: Less sophisticated, more reliable. For a personal assistant that must remember coffee preferences and peanut allergies, reliability wins.

---

*"Simplicity is the ultimate sophistication." — Leonardo da Vinci (probably)*

*"I just want my coffee order remembered." — Beaux (definitely)*
