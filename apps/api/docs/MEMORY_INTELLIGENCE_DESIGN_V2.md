# Memory Intelligence System Design V2

*Design Document v2.0*
*Author: Blue Team (Revised)*
*Date: 2026-02-03*

---

## Changes from V1

This revision addresses all critical issues identified by Red Team while preserving what worked well.

### Summary of Changes

| Issue | V1 Problem | V2 Solution |
|-------|-----------|-------------|
| **Cold Start** | New memories can't prove themselves; peanut allergy forgotten | Novelty boost + Safety floor + Guaranteed rotation |
| **Consolidation Destroys Info** | Non-canonical archived = lost details | Consolidation creates summaries, preserves originals |
| **O(n²) Clustering** | Pairwise comparisons don't scale | LSH-based approximate clustering, incremental batches |
| **Cache Race Conditions** | "Every N minutes" undefined | Explicit TTL tiers + write-through on boosts |
| **Emotional Detection Fragile** | LLM fails silently | Keyword fallback + extraction health tracking |
| **No Query at Bootstrap** | Semantic boost useless at startup | Recency-weighted profile query + topic affinity |
| **No Rollback** | Consolidation can't be undone | Append-only changelog + rollback by job ID |

### What We Kept
- Unified `effectiveScore` (single ranking metric)
- 5-tier system (CORE → ARCHIVED)
- Layer-based decay rates
- Budget allocation with redistribution
- Incremental migration approach

### What We Simplified
- Removed separate `MemoryScoreCache` table — use indexed column + TTL logic instead
- Consolidation no longer archives non-canonical memories — they stay accessible
- Reduced number of boost parameters (fewer knobs = fewer bugs)

---

## Red Team Response Summary

### 🔴 C1: Cold Start — FIXED
**Problem:** Peanut allergy mentioned once → decays → forgotten → user dies.

**Solution:** Three-pronged approach:
1. **Novelty Boost:** Memories < 7 days get +0.15 boost, tapering to 0 over the week
2. **Safety Floor:** Content matching safety patterns (allergy, medication, emergency) gets `minScore = 0.6` that never decays below
3. **Exploration Slots:** 10% of context budget reserved for "unseen" high-importance memories (round-robin)

### 🔴 C2: No Query at Bootstrap — FIXED
**Problem:** Semantic boost needs a query; bootstrap has none.

**Solution:** 
1. **Profile-based pseudo-query:** Generate query from user's top 5 topics (extracted from IDENTITY layer)
2. **Recency affinity:** Boost memories related to topics from last 3 sessions
3. **Fallback:** If no profile exists (brand new user), use pure score ranking (acceptable for new users)

### 🔴 C3: Clustering Doesn't Scale — FIXED
**Problem:** O(n²) pairwise comparisons = cost disaster.

**Solution:**
1. **Pre-cached embeddings:** Embeddings already exist from creation — reuse them
2. **LSH clustering:** Use Locality-Sensitive Hashing for approximate O(n) grouping
3. **Incremental batches:** Process max 500 memories per night, prioritize by age
4. **Circuit breaker:** If backlog > 5000, alert and pause until resolved

### 🔴 C4: No Rollback — FIXED
**Problem:** Bad consolidation = data loss.

**Solution:**
1. **Append-only changelog:** Every consolidation action logged with job ID
2. **Soft transitions:** Tier changes and cluster assignments are reversible
3. **Rollback endpoint:** `POST /consolidation/:jobId/rollback` undoes a job
4. **Mandatory dry-run:** First 10 consolidation runs per user require `dryRun: true`

### 🔴 C5: Cache Staleness — FIXED
**Problem:** "Refresh every N minutes" is undefined.

**Solution:** Explicit TTL by activity:
- **Active user (touched < 1h):** Recompute on access if stale > 5 min
- **Warm user (touched < 24h):** Stale threshold = 30 min
- **Cold user (touched > 24h):** Stale threshold = 6 hours
- **Write-through:** Pinned, starred, or used → immediate recompute

### 🟡 W2: Emotional Detection Fragile — FIXED
**Problem:** LLM extraction fails silently.

**Solution:**
1. **Keyword fallback:** If LLM returns null, scan for signal words ("hate", "love", "always", "never", "allergic", "important")
2. **Extraction health tracking:** Monitor success rate per field, alert if < 80%
3. **Graceful degradation:** Missing emotional data = neutral (0.5), not zero boost

---

## 1. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                     Memory Intelligence Layer V2                            │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌──────────────┐    ┌───────────────────┐    ┌────────────────────────┐   │
│  │  Importance  │    │   Consolidation   │    │   Context Allocator    │   │
│  │   Scorer     │───▶│     Engine        │───▶│                        │   │
│  │              │    │                   │    │  • Tier-based budgets  │   │
│  │ • Base score │    │ • LSH clustering  │    │  • Exploration slots   │   │
│  │ • Decay      │    │ • Summary creation│    │  • Profile pseudo-query│   │
│  │ • Novelty    │    │ • Tier transitions│    │  • Recency affinity    │   │
│  │ • Safety     │    │ • Rollback support│    │                        │   │
│  │ • Emotional  │    │                   │    │                        │   │
│  └──────────────┘    └───────────────────┘    └────────────────────────┘   │
│           │                    │                         │                  │
│           ▼                    ▼                         ▼                  │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                    Changelog (Append-Only)                           │   │
│  │              (All mutations logged for rollback/audit)               │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Key Differences from V1
1. **No separate score cache table** — indexed column with TTL logic instead
2. **Changelog for rollback** — every mutation tracked
3. **Exploration slots** — guaranteed surfacing for new memories
4. **Profile query** — bootstrap context gets semantic boost too

---

## 2. Data Model Changes

### 2.1 Memory Table Additions

```prisma
model Memory {
  // ... existing fields ...

  // === Importance & Scoring ===
  effectiveScore    Float     @default(0.5) @map("effective_score")
  scoreComputedAt   DateTime? @map("score_computed_at")
  emotionalWeight   Float     @default(0.5) @map("emotional_weight")
  
  // User signals
  userPinned        Boolean   @default(false) @map("user_pinned")
  userStarred       Boolean   @default(false) @map("user_starred")
  
  // === V2: Safety & Novelty ===
  
  // Safety-critical flag (allergies, medications, emergencies)
  // These memories have a minimum score floor
  safetyCritical    Boolean   @default(false) @map("safety_critical")
  
  // First surfaced timestamp (for exploration tracking)
  firstSurfacedAt   DateTime? @map("first_surfaced_at")
  
  // How many times this was included in context (different from retrieval)
  surfaceCount      Int       @default(0) @map("surface_count")
  
  // === Tiering ===
  tier              MemoryTier @default(ACTIVE)
  archivedAt        DateTime?  @map("archived_at")
  archiveReason     String?    @map("archive_reason")
  
  // === Consolidation (V2: Simplified) ===
  
  // Cluster ID (for grouping similar memories)
  clusterId         String?    @map("cluster_id")
  
  // V2: Instead of archiving non-canonical, we link to summary
  // The original memory stays accessible; summary is for context
  summaryId         String?    @map("summary_id")
  
  // Reference to summary memory (if this was consolidated)
  summary           Memory?    @relation("MemorySummary", fields: [summaryId], references: [id])
  summarizedFrom    Memory[]   @relation("MemorySummary")

  @@index([userId, tier, effectiveScore(sort: Desc)])
  @@index([userId, layer, effectiveScore(sort: Desc)])
  @@index([userId, safetyCritical, effectiveScore(sort: Desc)])
  @@index([userId, firstSurfacedAt])
  @@index([clusterId])
}

enum MemoryTier {
  CORE       // Always included (pinned, critical identity)
  ACTIVE     // High-value, frequently used
  WARM       // Moderate value, occasionally used  
  COLD       // Low value, rarely used
  ARCHIVED   // Soft-deleted but preserved
}
```

### 2.2 Changelog Table (NEW)

```prisma
/// Append-only log of all consolidation/scoring mutations
/// Enables rollback and auditing
model MemoryChangelog {
  id              String    @id @default(cuid())
  
  // What changed
  memoryId        String    @map("memory_id")
  memory          Memory    @relation(fields: [memoryId], references: [id])
  
  // The job that caused this change (for rollback)
  jobId           String    @map("job_id")
  
  // Type of change
  changeType      ChangeType @map("change_type")
  
  // Before/after values (JSON for flexibility)
  beforeValue     Json?     @map("before_value")
  afterValue      Json?     @map("after_value")
  
  // Metadata
  createdAt       DateTime  @default(now()) @map("created_at")
  rolledBackAt    DateTime? @map("rolled_back_at")
  rolledBackBy    String?   @map("rolled_back_by")
  
  @@index([jobId])
  @@index([memoryId, createdAt(sort: Desc)])
  @@map("memory_changelog")
}

enum ChangeType {
  TIER_CHANGE
  SCORE_UPDATE
  CLUSTER_ASSIGN
  SUMMARY_CREATE
  ARCHIVE
  SAFETY_FLAG
}
```

### 2.3 Extraction Table Additions

```prisma
model MemoryExtraction {
  // ... existing fields ...
  
  // Emotional signals
  sentiment         Float?    // -1.0 to +1.0
  emotionalIntensity Float?   // 0.0 to 1.0
  emotions          String[]  @default([])
  isPreference      Boolean   @default(false) @map("is_preference")
  explicitlyMarked  Boolean   @default(false) @map("explicitly_marked")
  
  // V2: Track extraction health
  extractionMethod  ExtractionMethod @default(LLM) @map("extraction_method")
  
  // V2: Safety detection
  safetyIndicators  String[]  @default([]) @map("safety_indicators")
}

enum ExtractionMethod {
  LLM           // Full LLM extraction succeeded
  LLM_PARTIAL   // LLM succeeded but some fields missing
  KEYWORD       // Fallback keyword extraction
  FAILED        // Extraction failed entirely
}
```

---

## 3. Importance Scoring Algorithm V2

### 3.1 The Effective Score Formula (Revised)

```typescript
effectiveScore = clamp(0, 1, max(
  safetyFloor,
  (baseScore × decayFactor) + noveltyBoost + usageBoost + emotionalBoost + pinnedBoost
))
```

**New components:**

| Component | Range | Description |
|-----------|-------|-------------|
| `safetyFloor` | 0.0 or 0.6 | Minimum score for safety-critical memories |
| `noveltyBoost` | 0.0-0.15 | Temporary boost for memories < 7 days old |

### 3.2 Implementation

```typescript
// src/memory/intelligence/importance-scorer.service.ts

export interface ScoringConfigV2 {
  // Decay settings (unchanged from V1)
  decayHalfLifeDays: Record<MemoryLayer, number>;
  minDecayFactor: number;
  
  // Boost settings
  maxUsageBoost: number;
  usageBoostPerUse: number;
  usageBoostDecay: number;
  maxEmotionalBoost: number;
  pinnedBoost: number;
  
  // V2: New settings
  noveltyBoostMax: number;       // Max boost for brand new memories
  noveltyBoostDays: number;      // Days over which novelty tapers to 0
  safetyFloor: number;           // Minimum score for safety-critical
  
  // V2: Cache TTL settings
  staleTTL: {
    active: number;   // User active in last hour
    warm: number;     // User active in last 24h
    cold: number;     // User inactive > 24h
  };
}

const DEFAULT_CONFIG_V2: ScoringConfigV2 = {
  decayHalfLifeDays: {
    [MemoryLayer.IDENTITY]: Infinity,
    [MemoryLayer.PROJECT]: 60,
    [MemoryLayer.SESSION]: 14,
    [MemoryLayer.TASK]: 3,
  },
  minDecayFactor: 0.1,
  
  maxUsageBoost: 0.3,
  usageBoostPerUse: 0.02,
  usageBoostDecay: 0.95,
  maxEmotionalBoost: 0.2,
  pinnedBoost: 0.5,
  
  // V2 additions
  noveltyBoostMax: 0.15,
  noveltyBoostDays: 7,
  safetyFloor: 0.6,
  
  staleTTL: {
    active: 5 * 60 * 1000,      // 5 minutes
    warm: 30 * 60 * 1000,       // 30 minutes
    cold: 6 * 60 * 60 * 1000,   // 6 hours
  },
};

@Injectable()
export class ImportanceScorerServiceV2 {
  constructor(
    private prisma: PrismaService,
    private configService: ConfigService,
  ) {}

  /**
   * Compute effective score with V2 additions
   */
  computeScore(memory: MemoryWithExtraction): ScoreComponentsV2 {
    const now = new Date();
    const config = this.getConfig();
    
    // 1. Base score (unchanged)
    const baseScore = this.computeBaseScore(memory);
    
    // 2. Decay factor (unchanged)
    const decayFactor = this.computeDecayFactor(memory, now);
    
    // 3. V2: Novelty boost (new memories get temporary boost)
    const noveltyBoost = this.computeNoveltyBoost(memory, now);
    
    // 4. Usage boost (unchanged)
    const usageBoost = this.computeUsageBoost(memory, now);
    
    // 5. Emotional boost (with fallback - see below)
    const emotionalBoost = this.computeEmotionalBoost(memory);
    
    // 6. Pinned boost (unchanged)
    const pinnedBoost = memory.userPinned ? config.pinnedBoost : 0;
    
    // 7. V2: Safety floor (critical memories have minimum score)
    const safetyFloor = memory.safetyCritical ? config.safetyFloor : 0;
    
    // Final score: max of safety floor and computed score
    const computedScore = (baseScore * decayFactor) + noveltyBoost + usageBoost + emotionalBoost + pinnedBoost;
    const effectiveScore = Math.min(1.0, Math.max(safetyFloor, computedScore));
    
    return {
      baseScore,
      decayFactor,
      noveltyBoost,
      usageBoost,
      emotionalBoost,
      pinnedBoost,
      safetyFloor,
      effectiveScore,
    };
  }

  /**
   * V2: Novelty boost for memories < 7 days old
   * Tapers linearly from max to 0 over the novelty period
   * 
   * RED TEAM RESPONSE [C1]: This ensures new memories get a chance
   * to prove themselves before decay kicks in.
   */
  private computeNoveltyBoost(memory: Memory, now: Date): number {
    const config = this.getConfig();
    const ageMs = now.getTime() - memory.createdAt.getTime();
    const ageDays = ageMs / (1000 * 60 * 60 * 24);
    
    if (ageDays >= config.noveltyBoostDays) return 0;
    
    // Linear taper: full boost at day 0, zero at day 7
    const taper = 1 - (ageDays / config.noveltyBoostDays);
    return config.noveltyBoostMax * taper;
  }

  /**
   * V2: Emotional boost with keyword fallback
   * 
   * RED TEAM RESPONSE [W2]: If LLM extraction fails, we use
   * keyword matching as fallback instead of returning 0.
   */
  private computeEmotionalBoost(memory: MemoryWithExtraction): number {
    const config = this.getConfig();
    let boost = 0;
    const ext = memory.extraction;
    
    // Try LLM-extracted values first
    if (ext?.emotionalIntensity != null) {
      boost += ext.emotionalIntensity * 0.1;
    } else {
      // Fallback: keyword-based emotional detection
      boost += this.keywordEmotionalBoost(memory.raw);
    }
    
    if (ext?.sentiment != null) {
      boost += Math.abs(ext.sentiment) * 0.05;
    }
    
    if (ext?.explicitlyMarked) {
      boost += 0.1;
    }
    
    if (memory.userStarred) {
      boost += 0.1;
    }
    
    return Math.min(config.maxEmotionalBoost, boost);
  }

  /**
   * Keyword-based emotional detection fallback
   * Used when LLM extraction fails or returns null
   */
  private keywordEmotionalBoost(text: string): number {
    const lower = text.toLowerCase();
    let boost = 0;
    
    // Strong emotion words
    const strongWords = ['love', 'hate', 'always', 'never', 'must', 'critical', 'essential'];
    const emphasisPatterns = [/!{2,}/, /\b(very|really|extremely|absolutely)\b/i];
    const capsRatio = (text.match(/[A-Z]/g)?.length ?? 0) / text.length;
    
    for (const word of strongWords) {
      if (lower.includes(word)) {
        boost += 0.03;
      }
    }
    
    for (const pattern of emphasisPatterns) {
      if (pattern.test(text)) {
        boost += 0.02;
      }
    }
    
    // Significant caps usage (shouting)
    if (capsRatio > 0.3 && text.length > 10) {
      boost += 0.03;
    }
    
    return Math.min(0.1, boost); // Cap fallback at 0.1
  }

  /**
   * V2: Detect safety-critical content
   * 
   * RED TEAM RESPONSE [C1]: Safety-critical memories get a floor score
   * so they never decay below retrieval threshold.
   */
  detectSafetyCritical(text: string): { isSafety: boolean; indicators: string[] } {
    const lower = text.toLowerCase();
    const indicators: string[] = [];
    
    const patterns: Array<{ pattern: RegExp; indicator: string }> = [
      { pattern: /\ballerg(y|ic|ies)\b/, indicator: 'allergy' },
      { pattern: /\bmedication|medicine|prescription|drug\b/, indicator: 'medication' },
      { pattern: /\bdiabet(es|ic)\b/, indicator: 'diabetes' },
      { pattern: /\bepilepsy|seizure\b/, indicator: 'seizure' },
      { pattern: /\basthma|inhaler\b/, indicator: 'asthma' },
      { pattern: /\bemergency contact\b/, indicator: 'emergency' },
      { pattern: /\bblood type\b/, indicator: 'medical' },
      { pattern: /\bdo not resuscitate|dnr\b/, indicator: 'medical_directive' },
      { pattern: /\blife[- ]threatening\b/, indicator: 'critical' },
      { pattern: /\bdeathly|fatal|deadly\b/, indicator: 'critical' },
    ];
    
    for (const { pattern, indicator } of patterns) {
      if (pattern.test(lower)) {
        indicators.push(indicator);
      }
    }
    
    return {
      isSafety: indicators.length > 0,
      indicators,
    };
  }

  /**
   * V2: Check if score is stale and needs recomputation
   * 
   * RED TEAM RESPONSE [C5]: Explicit TTL tiers based on user activity
   */
  isScoreStale(memory: Memory, userLastActive: Date): boolean {
    if (!memory.scoreComputedAt) return true;
    
    const config = this.getConfig();
    const now = Date.now();
    const userInactiveMs = now - userLastActive.getTime();
    const scoreAgeMs = now - memory.scoreComputedAt.getTime();
    
    // Determine TTL based on user activity
    let ttl: number;
    if (userInactiveMs < 60 * 60 * 1000) {
      ttl = config.staleTTL.active;  // 5 min
    } else if (userInactiveMs < 24 * 60 * 60 * 1000) {
      ttl = config.staleTTL.warm;    // 30 min
    } else {
      ttl = config.staleTTL.cold;    // 6 hours
    }
    
    return scoreAgeMs > ttl;
  }

  /**
   * V2: Write-through update on significant events
   * Called when memory is pinned, starred, or used
   */
  async onSignificantEvent(memoryId: string, event: 'pinned' | 'starred' | 'used'): Promise<void> {
    const memory = await this.prisma.memory.findUnique({
      where: { id: memoryId },
      include: { extraction: true },
    });
    
    if (!memory) return;
    
    const scores = this.computeScore(memory);
    await this.prisma.memory.update({
      where: { id: memoryId },
      data: {
        effectiveScore: scores.effectiveScore,
        scoreComputedAt: new Date(),
      },
    });
  }
}
```

---

## 4. Context Allocation V2

### 4.1 Budget with Exploration Slots

```
Total Budget: 2000 tokens (example)
┌─────────────────────────────────────────────────────────────────────────────┐
│ CORE (Pinned + Safety-Critical)                         │ 15% │ 300 │       │
├─────────────────────────────────────────────────────────┼─────┼─────┤       │
│ IDENTITY (User facts, preferences)                      │ 30% │ 600 │       │
├─────────────────────────────────────────────────────────┼─────┼─────┤       │
│ PROJECT (Current work context)                          │ 20% │ 400 │       │
├─────────────────────────────────────────────────────────┼─────┼─────┤       │
│ SESSION + RECENT (Conversation continuity)              │ 15% │ 300 │       │
├─────────────────────────────────────────────────────────┼─────┼─────┼───────┤
│ EXPLORATION (Unsurfaced high-importance memories)       │ 10% │ 200 │ NEW   │
├─────────────────────────────────────────────────────────┼─────┼─────┼───────┤
│ RESERVE (Overflow buffer)                               │ 10% │ 200 │       │
└─────────────────────────────────────────────────────────┴─────┴─────┴───────┘
```

### 4.2 Profile-Based Pseudo-Query

```typescript
// src/memory/intelligence/context-allocator.service.ts

@Injectable()
export class ContextAllocatorServiceV2 {
  /**
   * V2: Generate pseudo-query for bootstrap context
   * 
   * RED TEAM RESPONSE [C2]: When no explicit query is provided,
   * we synthesize one from user profile and recent topics.
   */
  async generateProfileQuery(userId: string): Promise<string | null> {
    // 1. Get user's top topics from IDENTITY layer
    const identityMemories = await this.prisma.memory.findMany({
      where: {
        userId,
        layer: MemoryLayer.IDENTITY,
        tier: { in: [MemoryTier.CORE, MemoryTier.ACTIVE] },
        deletedAt: null,
      },
      orderBy: { effectiveScore: 'desc' },
      take: 10,
      include: { extraction: true },
    });
    
    // 2. Get recent session topics (last 3 sessions)
    const recentMemories = await this.prisma.memory.findMany({
      where: {
        userId,
        layer: MemoryLayer.SESSION,
        deletedAt: null,
        createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
      include: { extraction: true },
    });
    
    if (identityMemories.length === 0 && recentMemories.length === 0) {
      return null; // Brand new user, no profile yet
    }
    
    // 3. Extract key topics/themes
    const topics: string[] = [];
    
    // From identity: what matters to this user?
    for (const m of identityMemories) {
      if (m.extraction?.what) {
        topics.push(m.extraction.what);
      }
    }
    
    // From recent: what have they been discussing?
    for (const m of recentMemories.slice(0, 5)) {
      if (m.extraction?.what) {
        topics.push(m.extraction.what);
      }
    }
    
    if (topics.length === 0) return null;
    
    // 4. Combine into pseudo-query
    return topics.slice(0, 5).join('; ');
  }

  /**
   * V2: Allocate context with exploration slots
   * 
   * RED TEAM RESPONSE [C1]: Exploration slots ensure new memories
   * get surfaced even if they haven't built up usage history.
   */
  async allocate(
    userId: string,
    options: AllocationOptionsV2,
  ): Promise<ContextAllocationV2> {
    const { maxTokens, projectId, sessionId, agentId } = options;
    
    // 1. Get or generate query
    let query = options.query;
    if (!query) {
      query = await this.generateProfileQuery(userId);
    }
    
    // 2. Calculate budgets (with exploration slot)
    const budgets = this.calculateBudgetsV2(maxTokens);
    
    // 3. Fetch candidates for each tier
    const candidates = await this.fetchCandidates(userId, projectId, agentId);
    
    // 4. Apply semantic boost if we have a query
    if (query) {
      await this.applySemanticBoost(candidates, query, userId);
    }
    
    // 5. Fill standard tiers
    const filled = this.fillTiers(candidates, budgets);
    
    // 6. V2: Fill exploration slots with unsurfaced memories
    await this.fillExplorationSlots(filled, userId, budgets.exploration);
    
    // 7. Redistribute underflow
    const redistributed = this.redistributeUnderflow(filled, budgets, maxTokens);
    
    // 8. Mark surfaced memories
    await this.markSurfaced(redistributed);
    
    // 9. Format context
    return this.formatContext(redistributed);
  }

  /**
   * V2: Fill exploration slots with memories that haven't been surfaced yet
   * Uses round-robin to ensure all high-importance memories get a chance
   */
  private async fillExplorationSlots(
    filled: FilledTiers,
    userId: string,
    budget: number,
  ): Promise<void> {
    // Find high-importance memories that haven't been surfaced much
    const unsurfaced = await this.prisma.memory.findMany({
      where: {
        userId,
        deletedAt: null,
        tier: { in: [MemoryTier.ACTIVE, MemoryTier.WARM] },
        // Either never surfaced, or surfaced < 3 times
        OR: [
          { firstSurfacedAt: null },
          { surfaceCount: { lt: 3 } },
        ],
        // But still reasonably important
        effectiveScore: { gte: 0.4 },
      },
      orderBy: [
        { surfaceCount: 'asc' },     // Prioritize least surfaced
        { effectiveScore: 'desc' },   // Then by importance
      ],
      take: 20,
    });
    
    // Already included in other tiers
    const alreadyIncluded = new Set<string>();
    for (const tier of Object.values(filled)) {
      for (const m of tier.memories) {
        alreadyIncluded.add(m.id);
      }
    }
    
    // Fill exploration budget
    filled.exploration = { memories: [], tokens: 0, budget };
    
    for (const memory of unsurfaced) {
      if (alreadyIncluded.has(memory.id)) continue;
      
      const tokens = this.tokenizer.count(memory.raw);
      if (filled.exploration.tokens + tokens <= budget) {
        filled.exploration.memories.push(memory);
        filled.exploration.tokens += tokens;
      }
    }
  }

  /**
   * V2: Mark memories as surfaced (for exploration tracking)
   */
  private async markSurfaced(filled: FilledTiers): Promise<void> {
    const allMemories = Object.values(filled).flatMap(t => t.memories);
    const now = new Date();
    
    await this.prisma.memory.updateMany({
      where: {
        id: { in: allMemories.map(m => m.id) },
        firstSurfacedAt: null,
      },
      data: { firstSurfacedAt: now },
    });
    
    await this.prisma.memory.updateMany({
      where: { id: { in: allMemories.map(m => m.id) } },
      data: { surfaceCount: { increment: 1 } },
    });
  }
}
```

---

## 5. Consolidation Engine V2

### 5.1 Summary-Based Consolidation (Not Archival)

**Key Change:** Instead of archiving non-canonical memories, we create a summary memory and link originals to it. The originals remain accessible but aren't included in context by default.

```typescript
// src/memory/intelligence/consolidation-engine.service.ts

@Injectable()
export class ConsolidationEngineServiceV2 {
  /**
   * V2: Main consolidation job with rollback support
   * 
   * RED TEAM RESPONSE [C4]: Every mutation is logged to changelog
   * with job ID for potential rollback.
   */
  async runConsolidation(
    userId: string,
    options: { dryRun?: boolean; jobId?: string } = {},
  ): Promise<ConsolidationReportV2> {
    const jobId = options.jobId ?? `job_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    
    const report: ConsolidationReportV2 = {
      jobId,
      dryRun: options.dryRun ?? false,
      tierTransitions: { toWarm: 0, toCold: 0, toArchived: 0, promoted: 0 },
      summariesCreated: 0,
      memoriesConsolidated: 0,
      scoresRefreshed: 0,
      changelog: [],
    };
    
    // 1. Refresh scores
    report.scoresRefreshed = await this.scorer.batchComputeScores(userId);
    
    // 2. Apply tier transitions
    await this.applyTierTransitions(userId, jobId, report, options.dryRun);
    
    // 3. Cluster and create summaries (V2: doesn't archive originals)
    await this.clusterAndSummarize(userId, jobId, report, options.dryRun);
    
    // 4. Archive only explicitly marked memories (>90 days cold + never used)
    await this.archiveStale(userId, jobId, report, options.dryRun);
    
    // 5. Log job completion
    if (!options.dryRun) {
      await this.logConsolidationJob(userId, report);
    }
    
    return report;
  }

  /**
   * V2: Cluster similar memories and create summary, but keep originals
   * 
   * RED TEAM RESPONSE [C3]: Uses LSH for O(n) approximate clustering
   * RED TEAM RESPONSE [Consolidation destroys info]: Originals preserved
   */
  private async clusterAndSummarize(
    userId: string,
    jobId: string,
    report: ConsolidationReportV2,
    dryRun?: boolean,
  ): Promise<void> {
    // Get session memories that haven't been clustered yet
    const candidates = await this.prisma.memory.findMany({
      where: {
        userId,
        layer: MemoryLayer.SESSION,
        tier: { in: [MemoryTier.ACTIVE, MemoryTier.WARM] },
        deletedAt: null,
        clusterId: null,
        summaryId: null,
      },
      include: { extraction: true },
      take: 500, // V2: Process in batches to bound runtime
    });
    
    if (candidates.length < 3) return; // Not enough to cluster
    
    // V2: Use LSH-based clustering instead of pairwise comparison
    const clusters = await this.lshCluster(candidates, userId);
    
    for (const cluster of clusters) {
      if (cluster.members.length < 3) continue;
      
      // Generate cluster ID
      const clusterId = `cluster_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      
      // V2: Create a summary memory instead of archiving
      const summary = await this.createSummaryMemory(cluster.members, userId, dryRun);
      
      if (!dryRun && summary) {
        // Link all cluster members to summary
        const beforeValues = cluster.members.map(m => ({
          id: m.id,
          clusterId: m.clusterId,
          summaryId: m.summaryId,
        }));
        
        await this.prisma.memory.updateMany({
          where: { id: { in: cluster.members.map(m => m.id) } },
          data: { clusterId, summaryId: summary.id },
        });
        
        // Log to changelog
        for (let i = 0; i < cluster.members.length; i++) {
          await this.logChange(jobId, cluster.members[i].id, ChangeType.CLUSTER_ASSIGN, {
            before: beforeValues[i],
            after: { clusterId, summaryId: summary.id },
          });
        }
        
        report.summariesCreated++;
        report.memoriesConsolidated += cluster.members.length;
      }
      
      report.changelog.push({
        type: 'cluster',
        summaryId: summary?.id,
        memberIds: cluster.members.map(m => m.id),
      });
    }
  }

  /**
   * V2: LSH-based clustering for O(n) approximate similarity grouping
   * 
   * RED TEAM RESPONSE [C3]: Replaces O(n²) pairwise comparison
   */
  private async lshCluster(
    memories: MemoryWithExtraction[],
    userId: string,
  ): Promise<Array<{ members: MemoryWithExtraction[] }>> {
    // Get pre-computed embeddings (they exist from memory creation)
    const embeddings = await this.prisma.memoryEmbedding.findMany({
      where: { memoryId: { in: memories.map(m => m.id) } },
    });
    
    const embeddingMap = new Map(embeddings.map(e => [e.memoryId, e.embedding]));
    
    // LSH: Use random hyperplanes to hash similar vectors to same buckets
    const numHashFunctions = 10;
    const hyperplanes = this.generateHyperplanes(numHashFunctions, 1536); // OpenAI embedding dim
    
    const buckets = new Map<string, MemoryWithExtraction[]>();
    
    for (const memory of memories) {
      const embedding = embeddingMap.get(memory.id);
      if (!embedding) continue;
      
      // Compute hash: sign of dot product with each hyperplane
      const hash = hyperplanes.map(hp => 
        this.dotProduct(embedding, hp) >= 0 ? '1' : '0'
      ).join('');
      
      if (!buckets.has(hash)) {
        buckets.set(hash, []);
      }
      buckets.get(hash)!.push(memory);
    }
    
    // Convert buckets to clusters, filtering small ones
    const clusters: Array<{ members: MemoryWithExtraction[] }> = [];
    for (const [, members] of buckets) {
      if (members.length >= 3) {
        // Verify similarity with one vector search to avoid false positives
        const isRealCluster = await this.verifyClusterSimilarity(members, embeddingMap);
        if (isRealCluster) {
          clusters.push({ members });
        }
      }
    }
    
    return clusters;
  }

  /**
   * Verify that memories in a bucket are actually similar (>0.85 cosine)
   */
  private async verifyClusterSimilarity(
    members: MemoryWithExtraction[],
    embeddingMap: Map<string, number[]>,
  ): Promise<boolean> {
    if (members.length < 2) return false;
    
    // Check similarity of first member with others
    const firstEmbedding = embeddingMap.get(members[0].id);
    if (!firstEmbedding) return false;
    
    let similarCount = 0;
    for (let i = 1; i < Math.min(members.length, 5); i++) {
      const otherEmbedding = embeddingMap.get(members[i].id);
      if (!otherEmbedding) continue;
      
      const similarity = this.cosineSimilarity(firstEmbedding, otherEmbedding);
      if (similarity >= 0.85) {
        similarCount++;
      }
    }
    
    // At least 60% must be similar
    return similarCount / Math.min(members.length - 1, 4) >= 0.6;
  }

  /**
   * V2: Create summary memory that links to originals
   * Originals stay accessible, summary is used for context
   */
  private async createSummaryMemory(
    members: MemoryWithExtraction[],
    userId: string,
    dryRun?: boolean,
  ): Promise<Memory | null> {
    if (dryRun) return null;
    
    // Sort by score to get best representation
    members.sort((a, b) => b.effectiveScore - a.effectiveScore);
    
    // Generate summary text
    const summaryText = this.generateSummaryText(members);
    
    // Create summary memory at IDENTITY layer (promoted pattern)
    const summary = await this.prisma.memory.create({
      data: {
        userId,
        raw: summaryText,
        layer: MemoryLayer.IDENTITY,
        tier: MemoryTier.ACTIVE,
        source: MemorySource.CONSOLIDATION,
        effectiveScore: Math.min(1.0, members[0].effectiveScore + 0.15),
        scoreComputedAt: new Date(),
        // Inherit highest emotional weight
        emotionalWeight: Math.max(...members.map(m => m.emotionalWeight)),
        // Inherit safety flag if any member has it
        safetyCritical: members.some(m => m.safetyCritical),
      },
    });
    
    return summary;
  }

  /**
   * Generate summary text from cluster members
   */
  private generateSummaryText(members: MemoryWithExtraction[]): string {
    // Use the best extraction's "what" field
    const bestExtraction = members
      .filter(m => m.extraction?.what)
      .sort((a, b) => b.effectiveScore - a.effectiveScore)[0]?.extraction;
    
    if (bestExtraction?.what) {
      return bestExtraction.what;
    }
    
    // Fallback: use shortest non-trivial raw text
    const shortest = members
      .filter(m => m.raw.length > 10)
      .sort((a, b) => a.raw.length - b.raw.length)[0];
    
    return shortest?.raw ?? members[0].raw;
  }

  /**
   * V2: Rollback a consolidation job
   * 
   * RED TEAM RESPONSE [C4]: Restores all changes made by a job
   */
  async rollbackJob(jobId: string): Promise<RollbackResult> {
    const changes = await this.prisma.memoryChangelog.findMany({
      where: { jobId, rolledBackAt: null },
      orderBy: { createdAt: 'desc' }, // Reverse order
    });
    
    const result: RollbackResult = {
      jobId,
      changesReverted: 0,
      errors: [],
    };
    
    for (const change of changes) {
      try {
        if (change.beforeValue) {
          await this.prisma.memory.update({
            where: { id: change.memoryId },
            data: change.beforeValue as Prisma.MemoryUpdateInput,
          });
        }
        
        await this.prisma.memoryChangelog.update({
          where: { id: change.id },
          data: { rolledBackAt: new Date() },
        });
        
        result.changesReverted++;
      } catch (err) {
        result.errors.push({ changeId: change.id, error: String(err) });
      }
    }
    
    return result;
  }

  /**
   * Log a change to the changelog
   */
  private async logChange(
    jobId: string,
    memoryId: string,
    changeType: ChangeType,
    values: { before: unknown; after: unknown },
  ): Promise<void> {
    await this.prisma.memoryChangelog.create({
      data: {
        memoryId,
        jobId,
        changeType,
        beforeValue: values.before as Prisma.JsonValue,
        afterValue: values.after as Prisma.JsonValue,
      },
    });
  }
}
```

---

## 6. Observability (NEW)

### 6.1 Extraction Health Tracking

```typescript
// src/memory/intelligence/extraction-health.service.ts

@Injectable()
export class ExtractionHealthService {
  private readonly alertThreshold = 0.8; // Alert if success < 80%
  
  /**
   * Track extraction method used and success rate
   */
  async trackExtraction(
    memoryId: string,
    method: ExtractionMethod,
    fieldsExtracted: string[],
    fieldsFailed: string[],
  ): Promise<void> {
    // Update extraction with method
    await this.prisma.memoryExtraction.update({
      where: { memoryId },
      data: { extractionMethod: method },
    });
    
    // Log for monitoring
    this.logger.debug('Extraction completed', {
      memoryId,
      method,
      fieldsExtracted,
      fieldsFailed,
    });
    
    // Check health periodically
    if (Math.random() < 0.1) { // 10% sample
      await this.checkHealth();
    }
  }
  
  /**
   * Check overall extraction health and alert if degraded
   */
  async checkHealth(): Promise<ExtractionHealthReport> {
    const last24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
    
    const stats = await this.prisma.memoryExtraction.groupBy({
      by: ['extractionMethod'],
      where: { createdAt: { gte: last24h } },
      _count: true,
    });
    
    const total = stats.reduce((sum, s) => sum + s._count, 0);
    const llmSuccess = stats.find(s => s.extractionMethod === 'LLM')?._count ?? 0;
    const llmPartial = stats.find(s => s.extractionMethod === 'LLM_PARTIAL')?._count ?? 0;
    const keywordFallback = stats.find(s => s.extractionMethod === 'KEYWORD')?._count ?? 0;
    const failed = stats.find(s => s.extractionMethod === 'FAILED')?._count ?? 0;
    
    const successRate = total > 0 ? (llmSuccess + llmPartial) / total : 1;
    
    const report: ExtractionHealthReport = {
      period: '24h',
      total,
      llmSuccess,
      llmPartial,
      keywordFallback,
      failed,
      successRate,
      healthy: successRate >= this.alertThreshold,
    };
    
    if (!report.healthy) {
      this.logger.warn('Extraction health degraded', report);
      // Could trigger alert here
    }
    
    return report;
  }
}
```

### 6.2 Score History (Sampling)

```typescript
// For debugging, we sample score history instead of storing every computation

@Injectable()
export class ScoreHistoryService {
  private readonly sampleRate = 0.05; // 5% of computations
  
  async maybeSampleScore(
    memoryId: string,
    scores: ScoreComponentsV2,
    trigger: string,
  ): Promise<void> {
    if (Math.random() > this.sampleRate) return;
    
    await this.prisma.memoryScoreHistory.create({
      data: {
        memoryId,
        effectiveScore: scores.effectiveScore,
        baseScore: scores.baseScore,
        decayFactor: scores.decayFactor,
        noveltyBoost: scores.noveltyBoost,
        usageBoost: scores.usageBoost,
        emotionalBoost: scores.emotionalBoost,
        pinnedBoost: scores.pinnedBoost,
        safetyFloor: scores.safetyFloor,
        trigger,
      },
    });
  }
}
```

### 6.3 Debug Endpoint

```typescript
// GET /v1/debug/allocation/:userId

interface AllocationDebugInfo {
  userId: string;
  generatedAt: string;
  
  // What query was used?
  query: string | null;
  querySource: 'explicit' | 'profile' | 'none';
  
  // Budget breakdown
  budgets: Record<string, { allocated: number; used: number; memories: number }>;
  
  // Top 10 memories by score (even if not included)
  topScores: Array<{
    id: string;
    raw: string;
    effectiveScore: number;
    tier: string;
    layer: string;
    included: boolean;
    reason: string;  // Why included/excluded
  }>;
  
  // Exploration slots
  explorationSlots: Array<{
    id: string;
    raw: string;
    surfaceCount: number;
    reason: string;
  }>;
  
  // Why specific memories weren't included
  exclusions: Array<{
    id: string;
    raw: string;
    reason: 'budget' | 'tier' | 'score' | 'already_summarized';
  }>;
}
```

---

## 7. Implementation Timeline (Revised)

### Phase 1: Scoring Foundation V2 (Week 1)
*Effort: ~24 hours*

**Tasks:**
1. [ ] Add V2 schema fields (safetyCritical, surfaceCount, firstSurfacedAt)
2. [ ] Add changelog table
3. [ ] Implement `ImportanceScorerServiceV2` with novelty + safety + fallback
4. [ ] Implement safety detection
5. [ ] Implement cache staleness logic (explicit TTL)
6. [ ] Backfill existing memories

**Deliverables:**
- Memories get novelty boost, safety floor
- Score staleness is well-defined
- Changelog infrastructure in place

### Phase 2: Context Allocator V2 (Week 2)
*Effort: ~28 hours*

**Tasks:**
1. [ ] Implement profile-based pseudo-query
2. [ ] Implement exploration slots
3. [ ] Add surface tracking (firstSurfacedAt, surfaceCount)
4. [ ] Update loadContext() to use V2 allocator
5. [ ] Add debug endpoint

**Deliverables:**
- Bootstrap context uses profile query
- New memories get exploration slots
- Debugging info available

### Phase 3: Consolidation V2 (Week 3-4)
*Effort: ~40 hours*

**Tasks:**
1. [ ] Implement LSH clustering
2. [ ] Implement summary creation (preserves originals)
3. [ ] Implement changelog logging
4. [ ] Implement rollback endpoint
5. [ ] Add mandatory dry-run for first N runs
6. [ ] Set up nightly job

**Deliverables:**
- O(n) clustering
- Originals preserved, summaries created
- Full rollback support

### Phase 4: Observability & Polish (Week 5)
*Effort: ~20 hours*

**Tasks:**
1. [ ] Implement extraction health tracking
2. [ ] Implement score history sampling
3. [ ] Add alerting for health degradation
4. [ ] Performance testing
5. [ ] Documentation

**Deliverables:**
- Visibility into extraction health
- Score debugging possible
- Production-ready

### Total: 5 weeks (~112 hours)

---

## 8. Migration Path

### 8.1 Non-Breaking Changes (Deploy Immediately)

```sql
-- New columns with defaults
ALTER TABLE memories ADD COLUMN safety_critical BOOLEAN DEFAULT FALSE;
ALTER TABLE memories ADD COLUMN first_surfaced_at TIMESTAMP;
ALTER TABLE memories ADD COLUMN surface_count INTEGER DEFAULT 0;
ALTER TABLE memories ADD COLUMN summary_id TEXT REFERENCES memories(id);

-- New indexes
CREATE INDEX idx_memories_safety ON memories(user_id, safety_critical, effective_score DESC);
CREATE INDEX idx_memories_surfaced ON memories(user_id, first_surfaced_at NULLS FIRST);
```

### 8.2 Changelog Table

```sql
CREATE TABLE memory_changelog (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
  memory_id TEXT NOT NULL REFERENCES memories(id),
  job_id TEXT NOT NULL,
  change_type TEXT NOT NULL,
  before_value JSONB,
  after_value JSONB,
  created_at TIMESTAMP DEFAULT NOW(),
  rolled_back_at TIMESTAMP,
  rolled_back_by TEXT
);

CREATE INDEX idx_changelog_job ON memory_changelog(job_id);
CREATE INDEX idx_changelog_memory ON memory_changelog(memory_id, created_at DESC);
```

### 8.3 Backfill Script

```typescript
// scripts/backfill-v2.ts

async function backfillV2() {
  const scorer = new ImportanceScorerServiceV2(prisma, config);
  
  let processed = 0;
  let cursor: string | undefined;
  
  while (true) {
    const memories = await prisma.memory.findMany({
      where: { deletedAt: null },
      take: 500,
      skip: cursor ? 1 : 0,
      cursor: cursor ? { id: cursor } : undefined,
      orderBy: { id: 'asc' },
    });
    
    if (memories.length === 0) break;
    
    for (const memory of memories) {
      // Detect safety-critical
      const safety = scorer.detectSafetyCritical(memory.raw);
      
      // Recompute score with V2 logic
      const scores = scorer.computeScore(memory);
      
      await prisma.memory.update({
        where: { id: memory.id },
        data: {
          safetyCritical: safety.isSafety,
          effectiveScore: scores.effectiveScore,
          scoreComputedAt: new Date(),
        },
      });
    }
    
    processed += memories.length;
    cursor = memories[memories.length - 1].id;
    console.log(`Processed ${processed} memories`);
  }
  
  console.log(`Backfill complete: ${processed} memories`);
}
```

---

## 9. Constraints & Guardrails

### 9.1 Pinned Memory Limit

```typescript
// Prevent users from pinning infinite memories
const MAX_PINNED_PER_USER = 50;

async function pinMemory(memoryId: string, userId: string): Promise<void> {
  const pinnedCount = await prisma.memory.count({
    where: { userId, userPinned: true, deletedAt: null },
  });
  
  if (pinnedCount >= MAX_PINNED_PER_USER) {
    throw new Error(`Maximum ${MAX_PINNED_PER_USER} pinned memories allowed`);
  }
  
  await prisma.memory.update({
    where: { id: memoryId },
    data: { userPinned: true, tier: MemoryTier.CORE },
  });
}
```

### 9.2 Consolidation Circuit Breaker

```typescript
// Don't run clustering if backlog is too large
const MAX_CLUSTERING_CANDIDATES = 5000;

async function shouldRunClustering(userId: string): Promise<boolean> {
  const candidateCount = await prisma.memory.count({
    where: {
      userId,
      layer: MemoryLayer.SESSION,
      clusterId: null,
      summaryId: null,
      deletedAt: null,
    },
  });
  
  if (candidateCount > MAX_CLUSTERING_CANDIDATES) {
    logger.warn('Clustering backlog too large', { userId, candidateCount });
    // Alert ops team
    return false;
  }
  
  return true;
}
```

### 9.3 Token Budget Safety Margin

```typescript
// Use conservative token estimates
const TOKEN_SAFETY_MARGIN = 1.1; // 10% buffer

function estimateTokens(text: string): number {
  const rawEstimate = tokenizer.count(text);
  return Math.ceil(rawEstimate * TOKEN_SAFETY_MARGIN);
}
```

---

## 10. Success Criteria

### Must Have (for V2 to ship)
- [ ] Peanut allergy test passes: critical health info stays above threshold after 30 days
- [ ] Coffee preference test passes: preference surfaces in bootstrap context
- [ ] Consolidation rollback works: can undo a bad job
- [ ] Clustering completes in < 5 minutes for 10k memories
- [ ] No silent emotional detection failures (fallback kicks in)

### Should Have
- [ ] Exploration slots surface new memories within 3 sessions
- [ ] Extraction health stays > 80% over 7 days
- [ ] Score debug endpoint works for troubleshooting

### Nice to Have
- [ ] Score history shows decay working correctly
- [ ] Tier transitions match expected patterns

---

## Appendix A: Test Cases

### A.1 Cold Start / Safety Test

```typescript
describe('Cold Start - Safety Critical', () => {
  it('should preserve allergy memory after decay period', async () => {
    // Create memory
    const memory = await memoryService.create({
      userId: 'test-user',
      raw: "I'm deathly allergic to peanuts",
      layer: MemoryLayer.SESSION,
    });
    
    // Verify safety detection
    expect(memory.safetyCritical).toBe(true);
    
    // Simulate 30 days passing
    await prisma.memory.update({
      where: { id: memory.id },
      data: { createdAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
    });
    
    // Recompute score
    const scores = scorer.computeScore(memory);
    
    // Should be above safety floor
    expect(scores.effectiveScore).toBeGreaterThanOrEqual(0.6);
    
    // Should appear in context
    const context = await allocator.allocate('test-user', { maxTokens: 500 });
    expect(context.context).toContain('peanut');
  });
});
```

### A.2 Bootstrap Context Test

```typescript
describe('Bootstrap Context - Profile Query', () => {
  it('should surface coffee preference without explicit query', async () => {
    // Create user profile
    await memoryService.create({
      userId: 'test-user',
      raw: 'Beaux loves coffee, especially lattes',
      layer: MemoryLayer.IDENTITY,
    });
    
    // Bootstrap context (no query)
    const context = await allocator.allocate('test-user', { maxTokens: 1000 });
    
    // Should include coffee preference
    expect(context.context).toContain('coffee');
  });
});
```

### A.3 Rollback Test

```typescript
describe('Consolidation Rollback', () => {
  it('should undo tier transitions from a job', async () => {
    // Create memory and note initial tier
    const memory = await memoryService.create({
      userId: 'test-user',
      raw: 'Test memory',
      layer: MemoryLayer.SESSION,
    });
    expect(memory.tier).toBe(MemoryTier.ACTIVE);
    
    // Run consolidation that demotes it
    await prisma.memory.update({
      where: { id: memory.id },
      data: { effectiveScore: 0.1 },
    });
    
    const report = await consolidation.runConsolidation('test-user');
    
    // Verify it was demoted
    const demoted = await prisma.memory.findUnique({ where: { id: memory.id } });
    expect(demoted?.tier).toBe(MemoryTier.COLD);
    
    // Rollback
    await consolidation.rollbackJob(report.jobId);
    
    // Verify restored
    const restored = await prisma.memory.findUnique({ where: { id: memory.id } });
    expect(restored?.tier).toBe(MemoryTier.ACTIVE);
  });
});
```

---

*This design addresses all critical issues raised by Red Team while maintaining the solid foundation of V1. Ship it.*
