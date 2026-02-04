# Memory Intelligence System Design

*Design Document v1.0*
*Author: Blue Team*
*Date: 2026-02-03*

---

## Executive Summary

The Memory Intelligence system unifies three approaches—**importance scoring**, **hierarchical compression**, and **context optimization**—into a single coherent system. The goal: ensure that what matters most surfaces first, within token budgets, while maintaining long-term memory health.

**The Problem:**
> "Beaux's coffee preference exists in the database but didn't make it into the agent's context."

This happens because:
1. **Naive retrieval** — `loadContext()` grabs memories by layer, not relevance
2. **No decay** — Old unused memories compete equally with reinforced ones
3. **Flat budgets** — Each layer gets fixed slots regardless of content quality
4. **No semantic boost** — Bootstrap context doesn't consider what's relevant *now*

**The Solution:**
A unified `MemoryIntelligenceService` that:
1. Computes a single **Effective Score** combining importance, recency, usage, and emotional weight
2. Manages **memory tiers** with automatic promotion, consolidation, and archival
3. Allocates **context budgets dynamically** based on available high-value memories

---

## 1. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          Memory Intelligence Layer                          │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌──────────────┐    ┌───────────────────┐    ┌────────────────────────┐   │
│  │  Importance  │    │   Consolidation   │    │   Context Allocator    │   │
│  │   Scorer     │───▶│     Engine        │───▶│                        │   │
│  │              │    │                   │    │  • Tier-based budgets  │   │
│  │ • Base score │    │ • Cluster similar │    │  • Dynamic rebalance   │   │
│  │ • Decay      │    │ • Promote patterns│    │  • Overflow/underflow  │   │
│  │ • Boost      │    │ • Archive stale   │    │  • Semantic boosting   │   │
│  │ • Emotional  │    │ • Merge conflicts │    │                        │   │
│  └──────────────┘    └───────────────────┘    └────────────────────────┘   │
│           │                    │                         │                  │
│           ▼                    ▼                         ▼                  │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                       Unified Score Cache                            │   │
│  │         (materialized view of effective scores, refreshed async)     │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
              ┌───────────────────────────────────────────┐
              │             Existing Services             │
              ├───────────────────────────────────────────┤
              │  MemoryService  │  EmbeddingService       │
              │  ExtractionService  │  PrismaService      │
              └───────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility | Trigger |
|-----------|----------------|---------|
| **ImportanceScorer** | Compute effective score from signals | On memory create/update/retrieve |
| **ConsolidationEngine** | Cluster, promote, archive, merge | Scheduled job (nightly) + on-demand |
| **ContextAllocator** | Build optimal context within budget | On `loadContext()` call |
| **ScoreCache** | Materialized effective scores for fast queries | Async refresh every N minutes |

### Data Flow

```
1. Memory Created
   └──▶ ImportanceScorer.computeInitial() 
        └──▶ Store importanceScore + emotionalWeight

2. Memory Retrieved/Used
   └──▶ ImportanceScorer.boost()
        └──▶ Update lastUsedAt, usedCount, importanceScore

3. loadContext() Called
   └──▶ ContextAllocator.allocate()
        ├──▶ Fetch from ScoreCache (fast path)
        ├──▶ Apply semantic boost for query context
        └──▶ Return tiered, budgeted context

4. Nightly Consolidation
   └──▶ ConsolidationEngine.run()
        ├──▶ Cluster similar memories
        ├──▶ Promote recurring patterns
        ├──▶ Archive decayed memories
        └──▶ Refresh ScoreCache
```

---

## 2. Data Model Changes

### 2.1 Memory Table Additions

```prisma
model Memory {
  // ... existing fields ...

  // === NEW: Importance & Emotional Signals ===
  
  // Effective score (0.0-1.0) - computed from all signals
  // This is the single number used for ranking
  effectiveScore    Float     @default(0.5) @map("effective_score")
  
  // When effectiveScore was last computed
  scoreComputedAt   DateTime? @map("score_computed_at")
  
  // Emotional weight (0.0-1.0) - how emotionally significant
  // Higher = more likely to be remembered (like human memory)
  emotionalWeight   Float     @default(0.5) @map("emotional_weight")
  
  // Explicit user signals
  userPinned        Boolean   @default(false) @map("user_pinned")
  userStarred       Boolean   @default(false) @map("user_starred")
  
  // === NEW: Tiering & Archival ===
  
  // Memory tier for context allocation
  tier              MemoryTier @default(ACTIVE) @map("tier")
  
  // When memory was archived (moved to ARCHIVED tier)
  archivedAt        DateTime?  @map("archived_at")
  
  // Reason for archival (for debugging/auditing)
  archiveReason     String?    @map("archive_reason")
  
  // === NEW: Consolidation Tracking ===
  
  // Cluster ID if this memory is part of a semantic cluster
  clusterId         String?    @map("cluster_id")
  
  // Is this the canonical (representative) memory for its cluster?
  isCanonical       Boolean    @default(false) @map("is_canonical")

  // ... existing indexes ...
  
  @@index([userId, tier, effectiveScore(sort: Desc)])
  @@index([userId, layer, effectiveScore(sort: Desc)])
  @@index([clusterId])
}

/// Memory tier for context allocation budgets
enum MemoryTier {
  CORE       // Always included (pinned, critical identity)
  ACTIVE     // High-value, frequently used
  WARM       // Moderate value, occasionally used
  COLD       // Low value, rarely used
  ARCHIVED   // Effectively deleted but preserved
}
```

### 2.2 Extraction Table Additions

```prisma
model MemoryExtraction {
  // ... existing fields ...
  
  // === NEW: Emotional & Importance Signals ===
  
  // Sentiment: -1.0 (negative) to +1.0 (positive)
  sentiment         Float?    @map("sentiment")
  
  // Emotional intensity: 0.0 (neutral) to 1.0 (intense)
  emotionalIntensity Float?   @map("emotional_intensity")
  
  // Detected emotion categories
  emotions          String[]  @default([])
  
  // Whether this appears to be a preference/trait vs event
  isPreference      Boolean   @default(false) @map("is_preference")
  
  // Whether user explicitly emphasized this ("remember this!", "important:")
  explicitlyMarked  Boolean   @default(false) @map("explicitly_marked")
}
```

### 2.3 Score Cache (Materialized View)

For performance at scale, we materialize effective scores:

```prisma
model MemoryScoreCache {
  id              String    @id @default(cuid())
  memoryId        String    @unique @map("memory_id")
  userId          String    @map("user_id")
  
  // Cached scores (denormalized for fast queries)
  effectiveScore  Float     @map("effective_score")
  layer           MemoryLayer
  tier            MemoryTier
  
  // Score components (for debugging/transparency)
  baseScore       Float     @map("base_score")
  decayFactor     Float     @map("decay_factor")
  usageBoost      Float     @map("usage_boost")
  emotionalBoost  Float     @map("emotional_boost")
  
  // Freshness
  computedAt      DateTime  @map("computed_at")
  staleAfter      DateTime  @map("stale_after")
  
  @@index([userId, layer, effectiveScore(sort: Desc)])
  @@index([userId, tier, effectiveScore(sort: Desc)])
  @@index([staleAfter])
  @@map("memory_score_cache")
}
```

### 2.4 Migration Strategy

```sql
-- Step 1: Add new columns (non-breaking)
ALTER TABLE memories 
  ADD COLUMN effective_score FLOAT DEFAULT 0.5,
  ADD COLUMN score_computed_at TIMESTAMP,
  ADD COLUMN emotional_weight FLOAT DEFAULT 0.5,
  ADD COLUMN user_pinned BOOLEAN DEFAULT FALSE,
  ADD COLUMN user_starred BOOLEAN DEFAULT FALSE,
  ADD COLUMN tier VARCHAR(20) DEFAULT 'ACTIVE',
  ADD COLUMN archived_at TIMESTAMP,
  ADD COLUMN archive_reason TEXT,
  ADD COLUMN cluster_id TEXT,
  ADD COLUMN is_canonical BOOLEAN DEFAULT FALSE;

-- Step 2: Create indexes
CREATE INDEX idx_memories_user_tier_score 
  ON memories(user_id, tier, effective_score DESC);
  
CREATE INDEX idx_memories_user_layer_score 
  ON memories(user_id, layer, effective_score DESC);

-- Step 3: Backfill effective scores (run as batch job)
-- See BackfillService.backfillEffectiveScores()
```

---

## 3. Importance Scoring Algorithm

### 3.1 The Effective Score Formula

```typescript
effectiveScore = clamp(0, 1, 
  (baseScore × decayFactor) + usageBoost + emotionalBoost + pinnedBoost
)
```

Where:

| Component | Range | Description |
|-----------|-------|-------------|
| `baseScore` | 0.0-1.0 | Initial importance from hints, layer, source |
| `decayFactor` | 0.0-1.0 | Time decay based on layer and last access |
| `usageBoost` | 0.0-0.3 | Reinforcement from retrieval/usage |
| `emotionalBoost` | 0.0-0.2 | Boost for emotionally significant memories |
| `pinnedBoost` | 0.0 or 0.5 | User explicitly pinned this memory |

### 3.2 Implementation

```typescript
// src/memory/intelligence/importance-scorer.service.ts

export interface ScoreComponents {
  baseScore: number;
  decayFactor: number;
  usageBoost: number;
  emotionalBoost: number;
  pinnedBoost: number;
  effectiveScore: number;
}

export interface ScoringConfig {
  // Decay settings
  decayHalfLifeDays: Record<MemoryLayer, number>;
  minDecayFactor: number;
  
  // Boost settings
  maxUsageBoost: number;
  usageBoostPerUse: number;
  usageBoostDecay: number;  // Usage boost also decays
  
  maxEmotionalBoost: number;
  pinnedBoost: number;
}

const DEFAULT_CONFIG: ScoringConfig = {
  decayHalfLifeDays: {
    [MemoryLayer.IDENTITY]: Infinity,  // Identity never decays
    [MemoryLayer.PROJECT]: 60,         // Projects decay slowly
    [MemoryLayer.SESSION]: 14,         // Sessions decay faster
    [MemoryLayer.TASK]: 3,             // Tasks decay quickly
  },
  minDecayFactor: 0.1,
  
  maxUsageBoost: 0.3,
  usageBoostPerUse: 0.02,
  usageBoostDecay: 0.95,  // 5% decay per day
  
  maxEmotionalBoost: 0.2,
  pinnedBoost: 0.5,
};

@Injectable()
export class ImportanceScorerService {
  private config: ScoringConfig;
  
  constructor(
    private prisma: PrismaService,
    private configService: ConfigService,
  ) {
    this.config = this.configService.get('scoring') ?? DEFAULT_CONFIG;
  }

  /**
   * Compute effective score for a memory
   */
  computeScore(memory: MemoryWithExtraction): ScoreComponents {
    const now = new Date();
    
    // 1. Base score (from hints, layer, source)
    const baseScore = this.computeBaseScore(memory);
    
    // 2. Decay factor (time since last access)
    const decayFactor = this.computeDecayFactor(memory, now);
    
    // 3. Usage boost (reinforcement from retrieval/usage)
    const usageBoost = this.computeUsageBoost(memory, now);
    
    // 4. Emotional boost (sentiment, intensity, preferences)
    const emotionalBoost = this.computeEmotionalBoost(memory);
    
    // 5. Pinned boost
    const pinnedBoost = memory.userPinned ? this.config.pinnedBoost : 0;
    
    // Final effective score
    const effectiveScore = Math.min(1.0, Math.max(0,
      (baseScore * decayFactor) + usageBoost + emotionalBoost + pinnedBoost
    ));
    
    return {
      baseScore,
      decayFactor,
      usageBoost,
      emotionalBoost,
      pinnedBoost,
      effectiveScore,
    };
  }

  /**
   * Base score from static signals
   */
  private computeBaseScore(memory: MemoryWithExtraction): number {
    let score = memory.importanceScore ?? 0.5;
    
    // Layer boost
    const layerBoosts: Record<MemoryLayer, number> = {
      [MemoryLayer.IDENTITY]: 0.2,
      [MemoryLayer.PROJECT]: 0.1,
      [MemoryLayer.SESSION]: 0,
      [MemoryLayer.TASK]: -0.1,
    };
    score += layerBoosts[memory.layer] ?? 0;
    
    // Source boost (corrections are important)
    if (memory.source === MemorySource.CORRECTION) {
      score += 0.15;
    }
    
    // Preference boost (stable facts should score higher)
    if (memory.extraction?.isPreference) {
      score += 0.1;
    }
    
    return Math.min(1.0, Math.max(0, score));
  }

  /**
   * Time decay based on layer and last access
   * Uses exponential decay: factor = 0.5 ^ (days / halfLife)
   */
  private computeDecayFactor(memory: Memory, now: Date): number {
    const halfLife = this.config.decayHalfLifeDays[memory.layer];
    
    // Identity memories don't decay
    if (halfLife === Infinity) return 1.0;
    
    // Use most recent access time
    const referenceDate = memory.lastUsedAt ?? memory.lastRetrievedAt ?? memory.createdAt;
    const daysSinceAccess = (now.getTime() - referenceDate.getTime()) / (1000 * 60 * 60 * 24);
    
    // Exponential decay
    const decayFactor = Math.pow(0.5, daysSinceAccess / halfLife);
    
    return Math.max(this.config.minDecayFactor, decayFactor);
  }

  /**
   * Usage boost from retrieval and explicit use
   * More usage = more important, but boost itself decays
   */
  private computeUsageBoost(memory: Memory, now: Date): number {
    const retrievalCount = memory.retrievalCount ?? 0;
    const usedCount = memory.usedCount ?? 0;
    
    // Each use contributes a small boost
    let boost = (retrievalCount * 0.5 + usedCount * 1.0) * this.config.usageBoostPerUse;
    
    // But the boost decays over time since last use
    if (memory.lastUsedAt) {
      const daysSinceUse = (now.getTime() - memory.lastUsedAt.getTime()) / (1000 * 60 * 60 * 24);
      boost *= Math.pow(this.config.usageBoostDecay, daysSinceUse);
    }
    
    return Math.min(this.config.maxUsageBoost, boost);
  }

  /**
   * Emotional boost from sentiment, intensity, explicit marking
   */
  private computeEmotionalBoost(memory: MemoryWithExtraction): number {
    if (!memory.extraction) return 0;
    
    let boost = 0;
    const ext = memory.extraction;
    
    // Emotional intensity contributes directly
    if (ext.emotionalIntensity != null) {
      boost += ext.emotionalIntensity * 0.1;
    }
    
    // Strong sentiment (positive or negative) is memorable
    if (ext.sentiment != null) {
      boost += Math.abs(ext.sentiment) * 0.05;
    }
    
    // Explicitly marked as important
    if (ext.explicitlyMarked) {
      boost += 0.1;
    }
    
    // Starred by user
    if (memory.userStarred) {
      boost += 0.1;
    }
    
    return Math.min(this.config.maxEmotionalBoost, boost);
  }

  /**
   * Batch compute scores for a user's memories
   * Used for cache refresh and backfill
   */
  async batchComputeScores(userId: string, batchSize = 500): Promise<number> {
    let processed = 0;
    let cursor: string | undefined;
    
    while (true) {
      const memories = await this.prisma.memory.findMany({
        where: { userId, deletedAt: null },
        include: { extraction: true },
        take: batchSize,
        skip: cursor ? 1 : 0,
        cursor: cursor ? { id: cursor } : undefined,
        orderBy: { id: 'asc' },
      });
      
      if (memories.length === 0) break;
      
      const updates = memories.map(memory => {
        const scores = this.computeScore(memory);
        return this.prisma.memory.update({
          where: { id: memory.id },
          data: {
            effectiveScore: scores.effectiveScore,
            scoreComputedAt: new Date(),
          },
        });
      });
      
      await this.prisma.$transaction(updates);
      
      processed += memories.length;
      cursor = memories[memories.length - 1].id;
      
      if (memories.length < batchSize) break;
    }
    
    return processed;
  }
}
```

### 3.3 Emotional Weight Detection

Add to extraction prompt:

```typescript
// In extraction.service.ts - enhanced prompt

const EXTRACTION_PROMPT_TEMPLATE = (userName?: string) => `...existing prompt...

Additionally, assess emotional significance:
- "sentiment": Number from -1.0 (very negative) to +1.0 (very positive). 0 = neutral.
- "emotionalIntensity": Number from 0.0 (matter-of-fact) to 1.0 (highly emotional/emphasized)
- "emotions": Array of detected emotions (e.g., ["joy", "frustration", "surprise"])
- "isPreference": Boolean - true if this is a stable preference/trait vs a one-time event
- "explicitlyMarked": Boolean - true if user emphasized importance ("remember this!", "important:", "never forget")

Examples:
- "I hate mushrooms" → sentiment: -0.7, intensity: 0.6, isPreference: true
- "Met with the team at 3pm" → sentiment: 0, intensity: 0.1, isPreference: false
- "NEVER deploy on Fridays - learned this the hard way" → sentiment: -0.3, intensity: 0.9, explicitlyMarked: true
`;
```

---

## 4. Consolidation Rules

### 4.1 Tier Transitions

```
ACTIVE ──┬─── [high score, recent use] ───▶ stays ACTIVE
         │
         ├─── [decayed below 0.3] ─────────▶ WARM
         │
         └─── [user pinned] ───────────────▶ CORE

WARM ────┬─── [accessed/used] ─────────────▶ ACTIVE (promotion)
         │
         ├─── [decayed below 0.15] ────────▶ COLD
         │
         └─── [consolidated into cluster] ─▶ ARCHIVED (non-canonical)

COLD ────┬─── [accessed] ──────────────────▶ WARM (resurrection)
         │
         └─── [>90 days, never accessed] ──▶ ARCHIVED

CORE ────── [user unpins] ─────────────────▶ ACTIVE
```

### 4.2 Consolidation Engine

```typescript
// src/memory/intelligence/consolidation-engine.service.ts

export interface ConsolidationConfig {
  // Tier thresholds
  warmThreshold: number;      // Drop below this → WARM
  coldThreshold: number;      // Drop below this → COLD
  archiveDaysThreshold: number; // Days in COLD before archive
  
  // Clustering
  clusterSimilarityThreshold: number;
  minClusterSize: number;
  
  // Frequency
  nightlyRunHour: number;     // Hour of day to run (0-23)
}

const DEFAULT_CONFIG: ConsolidationConfig = {
  warmThreshold: 0.3,
  coldThreshold: 0.15,
  archiveDaysThreshold: 90,
  
  clusterSimilarityThreshold: 0.85,
  minClusterSize: 3,
  
  nightlyRunHour: 3,  // 3 AM local time
};

@Injectable()
export class ConsolidationEngineService {
  constructor(
    private prisma: PrismaService,
    private embedding: EmbeddingService,
    private scorer: ImportanceScorerService,
    private config: ConsolidationConfig = DEFAULT_CONFIG,
  ) {}

  /**
   * Main consolidation job - run nightly
   */
  async runConsolidation(userId: string): Promise<ConsolidationReport> {
    const report: ConsolidationReport = {
      tierTransitions: { toWarm: 0, toCold: 0, toArchived: 0, promoted: 0 },
      clustersCreated: 0,
      memoriesMerged: 0,
      scoresRefreshed: 0,
    };
    
    // 1. Refresh all effective scores
    report.scoresRefreshed = await this.scorer.batchComputeScores(userId);
    
    // 2. Apply tier transitions based on new scores
    await this.applyTierTransitions(userId, report);
    
    // 3. Cluster similar SESSION memories
    await this.clusterAndPromote(userId, report);
    
    // 4. Archive old COLD memories
    await this.archiveStale(userId, report);
    
    // 5. Log job completion
    await this.logConsolidationJob(userId, report);
    
    return report;
  }

  /**
   * Transition memories between tiers based on effective score
   */
  private async applyTierTransitions(userId: string, report: ConsolidationReport): Promise<void> {
    // ACTIVE → WARM (score dropped)
    const toWarm = await this.prisma.memory.updateMany({
      where: {
        userId,
        deletedAt: null,
        tier: MemoryTier.ACTIVE,
        effectiveScore: { lt: this.config.warmThreshold },
        userPinned: false,  // Don't demote pinned memories
      },
      data: { tier: MemoryTier.WARM },
    });
    report.tierTransitions.toWarm = toWarm.count;
    
    // WARM → COLD (score dropped further)
    const toCold = await this.prisma.memory.updateMany({
      where: {
        userId,
        deletedAt: null,
        tier: MemoryTier.WARM,
        effectiveScore: { lt: this.config.coldThreshold },
      },
      data: { tier: MemoryTier.COLD },
    });
    report.tierTransitions.toCold = toCold.count;
    
    // WARM/COLD → ACTIVE (score increased via usage)
    const promoted = await this.prisma.memory.updateMany({
      where: {
        userId,
        deletedAt: null,
        tier: { in: [MemoryTier.WARM, MemoryTier.COLD] },
        effectiveScore: { gte: this.config.warmThreshold + 0.1 },  // Hysteresis
      },
      data: { tier: MemoryTier.ACTIVE },
    });
    report.tierTransitions.promoted = promoted.count;
  }

  /**
   * Cluster similar SESSION memories and promote patterns to IDENTITY
   */
  private async clusterAndPromote(userId: string, report: ConsolidationReport): Promise<void> {
    // Delegate to existing ConsolidationService
    // This extends it with cluster tracking
    const sessionMemories = await this.prisma.memory.findMany({
      where: {
        userId,
        layer: MemoryLayer.SESSION,
        tier: { in: [MemoryTier.ACTIVE, MemoryTier.WARM] },
        deletedAt: null,
        clusterId: null,  // Not already clustered
      },
      include: { extraction: true },
    });
    
    // Group by semantic similarity
    const clusters = await this.clusterBySimilarity(sessionMemories, userId);
    
    for (const cluster of clusters) {
      if (cluster.members.length >= this.config.minClusterSize) {
        report.clustersCreated++;
        
        // Generate cluster ID
        const clusterId = `cluster_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        
        // Select canonical (most complete, highest score)
        const canonical = this.selectCanonical(cluster.members);
        
        // Update all members with cluster info
        await this.prisma.memory.updateMany({
          where: { id: { in: cluster.members.map(m => m.id) } },
          data: { clusterId },
        });
        
        // Mark canonical and promote to IDENTITY
        await this.prisma.memory.update({
          where: { id: canonical.id },
          data: {
            isCanonical: true,
            layer: MemoryLayer.IDENTITY,
            tier: MemoryTier.ACTIVE,
            effectiveScore: Math.min(1.0, canonical.effectiveScore + 0.2),
          },
        });
        
        // Archive non-canonical members
        const nonCanonical = cluster.members.filter(m => m.id !== canonical.id);
        await this.prisma.memory.updateMany({
          where: { id: { in: nonCanonical.map(m => m.id) } },
          data: {
            tier: MemoryTier.ARCHIVED,
            archivedAt: new Date(),
            archiveReason: `consolidated into ${canonical.id}`,
            consolidatedInto: canonical.id,
          },
        });
        
        report.memoriesMerged += nonCanonical.length;
      }
    }
  }

  /**
   * Archive memories that have been COLD for too long
   */
  private async archiveStale(userId: string, report: ConsolidationReport): Promise<void> {
    const cutoff = new Date(Date.now() - this.config.archiveDaysThreshold * 24 * 60 * 60 * 1000);
    
    const archived = await this.prisma.memory.updateMany({
      where: {
        userId,
        deletedAt: null,
        tier: MemoryTier.COLD,
        // Never accessed or accessed before cutoff
        OR: [
          { lastUsedAt: null, createdAt: { lt: cutoff } },
          { lastUsedAt: { lt: cutoff } },
        ],
      },
      data: {
        tier: MemoryTier.ARCHIVED,
        archivedAt: new Date(),
        archiveReason: 'stale: no access in 90+ days',
      },
    });
    
    report.tierTransitions.toArchived = archived.count;
  }

  /**
   * Cluster memories by semantic similarity
   */
  private async clusterBySimilarity(
    memories: MemoryWithExtraction[],
    userId: string,
  ): Promise<Array<{ members: MemoryWithExtraction[]; centroid: string }>> {
    // Implementation similar to existing ConsolidationService.clusterBySimilarity
    // Returns groups of semantically similar memories
    
    const clusters: Array<{ members: MemoryWithExtraction[]; centroid: string }> = [];
    const assigned = new Set<string>();
    
    for (const memory of memories) {
      if (assigned.has(memory.id)) continue;
      
      const embedding = await this.embedding.generate(memory.raw);
      const similar = await this.embedding.search(userId, embedding, 20);
      
      const clusterMembers = similar
        .filter(s => 
          !assigned.has(s.id) && 
          s.score >= this.config.clusterSimilarityThreshold
        )
        .map(s => memories.find(m => m.id === s.id))
        .filter((m): m is MemoryWithExtraction => m != null);
      
      if (clusterMembers.length > 0) {
        // Include seed memory
        const allMembers = [memory, ...clusterMembers.filter(m => m.id !== memory.id)];
        
        for (const m of allMembers) {
          assigned.add(m.id);
        }
        
        clusters.push({
          members: allMembers,
          centroid: memory.id,
        });
      }
    }
    
    return clusters;
  }

  /**
   * Select the canonical memory from a cluster
   */
  private selectCanonical(memories: MemoryWithExtraction[]): MemoryWithExtraction {
    return memories.sort((a, b) => {
      // 1. Prefer higher effective score
      if (a.effectiveScore !== b.effectiveScore) {
        return b.effectiveScore - a.effectiveScore;
      }
      
      // 2. Prefer longer extraction.what (more complete)
      const whatLenA = a.extraction?.what?.length ?? 0;
      const whatLenB = b.extraction?.what?.length ?? 0;
      if (whatLenA !== whatLenB) return whatLenB - whatLenA;
      
      // 3. Prefer more recent
      return b.createdAt.getTime() - a.createdAt.getTime();
    })[0];
  }
}
```

---

## 5. Context Budget Allocation

### 5.1 Budget Tiers

The context allocator divides the token budget across tiers:

```
Total Budget: 2000 tokens (example)
┌─────────────────────────────────────────────────────────┐
│ CORE (Pinned + Critical)                    │ 20% │ 400 │
├─────────────────────────────────────────────┼─────┼─────┤
│ IDENTITY (User facts, preferences)          │ 35% │ 700 │
├─────────────────────────────────────────────┼─────┼─────┤
│ PROJECT (Current work context)              │ 25% │ 500 │
├─────────────────────────────────────────────┼─────┼─────┤
│ SESSION + RECENT (Conversation continuity)  │ 15% │ 300 │
├─────────────────────────────────────────────┼─────┼─────┤
│ RESERVE (Overflow buffer)                   │  5% │ 100 │
└─────────────────────────────────────────────┴─────┴─────┘
```

### 5.2 Dynamic Rebalancing

If a tier underflows (not enough high-quality memories), redistribute:

```typescript
// Example: IDENTITY has only 400 tokens of content
// Redistribute remaining 300 tokens:
// - 50% → PROJECT (helps current context)
// - 30% → SESSION (more conversation continuity)
// - 20% → CORE (if available)
```

### 5.3 Context Allocator Implementation

```typescript
// src/memory/intelligence/context-allocator.service.ts

export interface AllocationConfig {
  budgets: {
    core: number;       // Percentage for pinned/critical
    identity: number;   // Percentage for identity layer
    project: number;    // Percentage for project layer
    session: number;    // Percentage for session/recent
    reserve: number;    // Overflow buffer
  };
  
  // Minimum memories to include per tier (even if over budget)
  minPerTier: {
    core: number;
    identity: number;
    project: number;
    session: number;
  };
  
  // Redistribution priorities (higher = gets more overflow)
  redistributionPriority: {
    core: number;
    identity: number;
    project: number;
    session: number;
  };
}

const DEFAULT_CONFIG: AllocationConfig = {
  budgets: {
    core: 0.20,
    identity: 0.35,
    project: 0.25,
    session: 0.15,
    reserve: 0.05,
  },
  
  minPerTier: {
    core: 5,      // Always include top 5 pinned
    identity: 10, // Always include top 10 identity facts
    project: 5,   // Always include top 5 project memories
    session: 3,   // Always include last 3 session memories
  },
  
  redistributionPriority: {
    core: 4,
    identity: 3,
    project: 2,
    session: 1,
  },
};

export interface ContextAllocation {
  context: string;
  tokenCount: number;
  memoriesIncluded: number;
  tiers: {
    core: { count: number; tokens: number };
    identity: { count: number; tokens: number };
    project: { count: number; tokens: number };
    session: { count: number; tokens: number };
    agent?: { count: number; tokens: number };
  };
  underflowRedistributed: number;
  memoriesSkipped: number;
}

@Injectable()
export class ContextAllocatorService {
  private config: AllocationConfig;
  
  constructor(
    private prisma: PrismaService,
    private scorer: ImportanceScorerService,
    @Inject('TOKENIZER') private tokenizer: TokenizerInterface,
  ) {
    this.config = DEFAULT_CONFIG;
  }

  /**
   * Allocate context within budget
   */
  async allocate(
    userId: string,
    options: {
      maxTokens: number;
      projectId?: string;
      sessionId?: string;
      agentId?: string;
      query?: string;  // Optional: boost memories relevant to this query
    },
  ): Promise<ContextAllocation> {
    const { maxTokens, projectId, sessionId, agentId, query } = options;
    
    // 1. Calculate tier budgets
    const budgets = this.calculateBudgets(maxTokens);
    
    // 2. Fetch candidate memories for each tier
    const candidates = await this.fetchCandidates(userId, projectId, agentId);
    
    // 3. Apply semantic boost if query provided
    if (query) {
      await this.applySemanticBoost(candidates, query, userId);
    }
    
    // 4. Fill each tier within budget
    const filled = this.fillTiers(candidates, budgets);
    
    // 5. Redistribute underflow
    const redistributed = this.redistributeUnderflow(filled, budgets, maxTokens);
    
    // 6. Format context string
    const context = this.formatContext(redistributed);
    
    return context;
  }

  /**
   * Calculate token budgets for each tier
   */
  private calculateBudgets(maxTokens: number): Record<string, number> {
    return {
      core: Math.floor(maxTokens * this.config.budgets.core),
      identity: Math.floor(maxTokens * this.config.budgets.identity),
      project: Math.floor(maxTokens * this.config.budgets.project),
      session: Math.floor(maxTokens * this.config.budgets.session),
      reserve: Math.floor(maxTokens * this.config.budgets.reserve),
    };
  }

  /**
   * Fetch candidate memories for each tier, ordered by effective score
   */
  private async fetchCandidates(
    userId: string,
    projectId?: string,
    agentId?: string,
  ): Promise<TierCandidates> {
    const [core, identity, project, session, agent] = await Promise.all([
      // CORE: Pinned memories
      this.prisma.memory.findMany({
        where: {
          userId,
          deletedAt: null,
          tier: MemoryTier.CORE,
        },
        orderBy: { effectiveScore: 'desc' },
        take: 50,
      }),
      
      // IDENTITY: User facts
      this.prisma.memory.findMany({
        where: {
          userId,
          deletedAt: null,
          layer: MemoryLayer.IDENTITY,
          tier: { in: [MemoryTier.CORE, MemoryTier.ACTIVE] },
          subjectType: SubjectType.USER,
        },
        orderBy: { effectiveScore: 'desc' },
        take: 100,
      }),
      
      // PROJECT: Current project context
      projectId ? this.prisma.memory.findMany({
        where: {
          userId,
          projectId,
          deletedAt: null,
          tier: { in: [MemoryTier.CORE, MemoryTier.ACTIVE, MemoryTier.WARM] },
        },
        orderBy: { effectiveScore: 'desc' },
        take: 50,
      }) : Promise.resolve([]),
      
      // SESSION: Recent context
      this.prisma.memory.findMany({
        where: {
          userId,
          deletedAt: null,
          layer: MemoryLayer.SESSION,
          tier: { in: [MemoryTier.ACTIVE, MemoryTier.WARM] },
          createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
        },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
      
      // AGENT: Agent self-memories
      agentId ? this.prisma.memory.findMany({
        where: {
          agentId,
          subjectType: SubjectType.AGENT,
          deletedAt: null,
        },
        orderBy: { effectiveScore: 'desc' },
        take: 30,
      }) : Promise.resolve([]),
    ]);
    
    return { core, identity, project, session, agent };
  }

  /**
   * Apply semantic boost to memories relevant to the current query
   */
  private async applySemanticBoost(
    candidates: TierCandidates,
    query: string,
    userId: string,
  ): Promise<void> {
    // Generate query embedding
    const queryEmbedding = await this.embedding.generate(query);
    
    // Search for relevant memories
    const relevant = await this.embedding.search(userId, queryEmbedding, 50);
    const relevanceMap = new Map(relevant.map(r => [r.id, r.score]));
    
    // Boost scores for relevant memories
    for (const tier of Object.values(candidates)) {
      for (const memory of tier) {
        const relevance = relevanceMap.get(memory.id);
        if (relevance && relevance > 0.5) {
          // Boost effective score by relevance (up to 30%)
          (memory as any).boostedScore = memory.effectiveScore + (relevance * 0.3);
        } else {
          (memory as any).boostedScore = memory.effectiveScore;
        }
      }
      
      // Re-sort by boosted score
      tier.sort((a, b) => ((b as any).boostedScore ?? b.effectiveScore) - 
                         ((a as any).boostedScore ?? a.effectiveScore));
    }
  }

  /**
   * Fill each tier with memories up to its budget
   */
  private fillTiers(
    candidates: TierCandidates,
    budgets: Record<string, number>,
  ): FilledTiers {
    const filled: FilledTiers = {
      core: { memories: [], tokens: 0, budget: budgets.core },
      identity: { memories: [], tokens: 0, budget: budgets.identity },
      project: { memories: [], tokens: 0, budget: budgets.project },
      session: { memories: [], tokens: 0, budget: budgets.session },
      agent: { memories: [], tokens: 0, budget: 0 },  // Uses reserve
    };
    
    for (const [tierName, tierCandidates] of Object.entries(candidates)) {
      const tier = filled[tierName as keyof FilledTiers];
      const budget = tier.budget;
      const minCount = this.config.minPerTier[tierName as keyof typeof this.config.minPerTier] ?? 0;
      
      for (let i = 0; i < tierCandidates.length; i++) {
        const memory = tierCandidates[i];
        const tokens = this.tokenizer.count(memory.raw);
        
        // Always include minimum count, even if over budget
        const mustInclude = i < minCount;
        
        if (mustInclude || tier.tokens + tokens <= budget) {
          tier.memories.push(memory);
          tier.tokens += tokens;
        }
        
        // Stop if over budget and past minimum
        if (!mustInclude && tier.tokens >= budget) break;
      }
    }
    
    return filled;
  }

  /**
   * Redistribute unused budget from underflowing tiers
   */
  private redistributeUnderflow(
    filled: FilledTiers,
    budgets: Record<string, number>,
    maxTokens: number,
  ): FilledTiers {
    // Calculate underflow (unused budget)
    let underflow = 0;
    for (const [tierName, tier] of Object.entries(filled)) {
      const budget = budgets[tierName] ?? 0;
      if (tier.tokens < budget) {
        underflow += budget - tier.tokens;
      }
    }
    
    // Add reserve to underflow
    underflow += budgets.reserve;
    
    if (underflow === 0) return filled;
    
    // Redistribute by priority
    const priorities = Object.entries(this.config.redistributionPriority)
      .sort(([, a], [, b]) => b - a);
    
    for (const [tierName] of priorities) {
      const tier = filled[tierName as keyof FilledTiers];
      if (!tier || underflow === 0) continue;
      
      // Try to add more memories to this tier
      const candidates = (filled[tierName as keyof FilledTiers] as any).candidates ?? [];
      const alreadyIncluded = new Set(tier.memories.map(m => m.id));
      
      for (const memory of candidates) {
        if (alreadyIncluded.has(memory.id)) continue;
        
        const tokens = this.tokenizer.count(memory.raw);
        if (tokens <= underflow) {
          tier.memories.push(memory);
          tier.tokens += tokens;
          underflow -= tokens;
        }
        
        if (underflow === 0) break;
      }
    }
    
    return filled;
  }

  /**
   * Format filled tiers into context string
   */
  private formatContext(filled: FilledTiers): ContextAllocation {
    const lines: string[] = [];
    let totalTokens = 0;
    let totalMemories = 0;
    
    const tiers: ContextAllocation['tiers'] = {
      core: { count: 0, tokens: 0 },
      identity: { count: 0, tokens: 0 },
      project: { count: 0, tokens: 0 },
      session: { count: 0, tokens: 0 },
    };
    
    // CORE + IDENTITY → "User Identity" section
    const identityMemories = [
      ...filled.core.memories,
      ...filled.identity.memories,
    ];
    
    if (identityMemories.length > 0) {
      lines.push('## User Identity');
      for (const m of identityMemories) {
        lines.push(`- ${m.raw}`);
      }
      lines.push('');
      
      tiers.core.count = filled.core.memories.length;
      tiers.core.tokens = filled.core.tokens;
      tiers.identity.count = filled.identity.memories.length;
      tiers.identity.tokens = filled.identity.tokens;
    }
    
    // PROJECT → "Current Project" section
    if (filled.project.memories.length > 0) {
      lines.push('## Current Project');
      for (const m of filled.project.memories) {
        lines.push(`- ${m.raw}`);
      }
      lines.push('');
      
      tiers.project.count = filled.project.memories.length;
      tiers.project.tokens = filled.project.tokens;
    }
    
    // SESSION → "Recent Context" section
    if (filled.session.memories.length > 0) {
      lines.push('## Recent Context');
      for (const m of filled.session.memories) {
        lines.push(`- ${m.raw}`);
      }
      lines.push('');
      
      tiers.session.count = filled.session.memories.length;
      tiers.session.tokens = filled.session.tokens;
    }
    
    // AGENT → "Agent Self" section (if present)
    if (filled.agent && filled.agent.memories.length > 0) {
      lines.push('## Agent Self');
      for (const m of filled.agent.memories) {
        lines.push(`- ${m.raw}`);
      }
      
      tiers.agent = {
        count: filled.agent.memories.length,
        tokens: filled.agent.tokens,
      };
    }
    
    const context = lines.join('\n');
    totalTokens = Object.values(tiers).reduce((sum, t) => sum + t.tokens, 0);
    totalMemories = Object.values(tiers).reduce((sum, t) => sum + t.count, 0);
    
    return {
      context,
      tokenCount: totalTokens,
      memoriesIncluded: totalMemories,
      tiers,
      underflowRedistributed: 0,  // TODO: track this
      memoriesSkipped: 0,         // TODO: track this
    };
  }
}
```

---

## 6. APIs

### 6.1 Updated Endpoints

#### `POST /v1/memory/context` (Enhanced)

```typescript
// LoadContextDto - enhanced
interface LoadContextDto {
  projectId?: string;
  sessionId?: string;
  agentId?: string;
  maxTokens?: number;       // Default: 4000
  
  // NEW: Query for semantic boosting
  query?: string;           // Boost memories relevant to this
  
  // NEW: Allocation overrides
  budgetOverrides?: {
    core?: number;          // 0.0-1.0
    identity?: number;
    project?: number;
    session?: number;
  };
  
  // NEW: Include debugging info
  debug?: boolean;          // Include score breakdowns
}

// Response - enhanced
interface ContextResult {
  context: string;
  tokenCount: number;
  memoriesIncluded: number;
  
  // NEW: Tier breakdown
  tiers: {
    core: { count: number; tokens: number };
    identity: { count: number; tokens: number };
    project: { count: number; tokens: number };
    session: { count: number; tokens: number };
    agent?: { count: number; tokens: number };
  };
  
  // NEW: Debugging info (if debug=true)
  debug?: {
    memoriesConsidered: number;
    memoriesSkipped: number;
    underflowRedistributed: number;
    topScores: Array<{ id: string; raw: string; score: number }>;
  };
}
```

#### `POST /v1/memory` (Enhanced)

```typescript
// CreateMemoryDto - enhanced
interface CreateMemoryDto {
  raw: string;
  layer?: MemoryLayer;
  importanceHint?: ImportanceHint;
  
  // NEW: Emotional signals
  emotionalWeight?: number;   // Override auto-detection
  isPreference?: boolean;     // Mark as stable preference
  
  // NEW: User emphasis
  pinned?: boolean;           // Pin to CORE tier
  starred?: boolean;          // Boost importance
  
  // Existing fields...
  context?: MemoryContextDto;
  agentId?: string;
  subjectType?: SubjectType;
  subjectId?: string;
}
```

#### `PATCH /v1/memory/:id/importance` (New)

```typescript
// Manually adjust importance signals
interface AdjustImportanceDto {
  pinned?: boolean;
  starred?: boolean;
  emotionalWeight?: number;
  tier?: MemoryTier;
  
  // Force recalculation
  recalculate?: boolean;
}

// Response
interface AdjustImportanceResult {
  memoryId: string;
  oldScore: number;
  newScore: number;
  tier: MemoryTier;
  components: ScoreComponents;
}
```

#### `POST /v1/consolidation/run` (New)

```typescript
// Trigger consolidation job
interface RunConsolidationDto {
  userId: string;
  dryRun?: boolean;
  
  // Scope
  tierTransitions?: boolean;  // Apply tier transitions
  clustering?: boolean;       // Cluster and promote
  archival?: boolean;         // Archive stale memories
}

// Response
interface ConsolidationReport {
  tierTransitions: {
    toWarm: number;
    toCold: number;
    toArchived: number;
    promoted: number;
  };
  clustersCreated: number;
  memoriesMerged: number;
  scoresRefreshed: number;
  
  // If dryRun=true, includes what would have changed
  preview?: {
    wouldDemote: string[];
    wouldPromote: string[];
    wouldArchive: string[];
    wouldCluster: Array<{
      canonical: string;
      members: string[];
    }>;
  };
}
```

#### `GET /v1/memory/:id/score` (New)

```typescript
// Get detailed score breakdown for a memory
interface ScoreBreakdown {
  memoryId: string;
  effectiveScore: number;
  tier: MemoryTier;
  
  components: {
    baseScore: number;
    decayFactor: number;
    usageBoost: number;
    emotionalBoost: number;
    pinnedBoost: number;
  };
  
  signals: {
    importanceHint: ImportanceHint | null;
    layer: MemoryLayer;
    source: MemorySource;
    
    createdAt: string;
    lastUsedAt: string | null;
    usedCount: number;
    retrievalCount: number;
    
    emotionalWeight: number;
    sentiment: number | null;
    emotionalIntensity: number | null;
    
    pinned: boolean;
    starred: boolean;
  };
  
  computedAt: string;
}
```

### 6.2 Internal Services

```typescript
// New services to create

// src/memory/intelligence/importance-scorer.service.ts
@Injectable()
export class ImportanceScorerService {
  computeScore(memory: MemoryWithExtraction): ScoreComponents;
  batchComputeScores(userId: string, batchSize?: number): Promise<number>;
  recalculateAfterEvent(memoryId: string, event: ScoreEvent): Promise<void>;
}

// src/memory/intelligence/consolidation-engine.service.ts
@Injectable()
export class ConsolidationEngineService {
  runConsolidation(userId: string): Promise<ConsolidationReport>;
  applyTierTransitions(userId: string): Promise<TierTransitionResult>;
  clusterAndPromote(userId: string): Promise<ClusterResult>;
  archiveStale(userId: string): Promise<ArchivalResult>;
}

// src/memory/intelligence/context-allocator.service.ts
@Injectable()
export class ContextAllocatorService {
  allocate(userId: string, options: AllocationOptions): Promise<ContextAllocation>;
  estimateTokens(memories: Memory[]): number;
  formatContext(allocation: FilledTiers): ContextAllocation;
}

// src/memory/intelligence/memory-intelligence.module.ts
@Module({
  imports: [MemoryModule, EmbeddingModule],
  providers: [
    ImportanceScorerService,
    ConsolidationEngineService,
    ContextAllocatorService,
  ],
  exports: [
    ImportanceScorerService,
    ConsolidationEngineService,
    ContextAllocatorService,
  ],
})
export class MemoryIntelligenceModule {}
```

---

## 7. Implementation Phases

### Phase 1: Scoring Foundation (Week 1)
*Effort: ~20 hours*

**Goals:**
- Add new schema fields (non-breaking)
- Implement `ImportanceScorerService`
- Backfill `effectiveScore` for existing memories
- Add `/memory/:id/score` endpoint

**Tasks:**
1. [ ] Add Prisma schema changes (migration)
2. [ ] Create `ImportanceScorerService`
3. [ ] Add score computation on memory create
4. [ ] Create backfill script for existing memories
5. [ ] Add `/memory/:id/score` endpoint
6. [ ] Update existing `ImportanceService` to delegate to new scorer

**Verification:**
```bash
# Check that new memories get effective scores
curl -X POST .../v1/memory -d '{"raw": "Test memory"}'
curl -X GET .../v1/memory/{id}/score

# Verify backfill
npx ts-node scripts/backfill-scores.ts
```

### Phase 2: Context Allocator (Week 2)
*Effort: ~25 hours*

**Goals:**
- Implement `ContextAllocatorService`
- Replace naive `loadContext()` with tiered allocation
- Add semantic boosting
- Support budget overrides

**Tasks:**
1. [ ] Create `ContextAllocatorService`
2. [ ] Implement tier-based budget calculation
3. [ ] Implement tier filling with min guarantees
4. [ ] Implement underflow redistribution
5. [ ] Add semantic boost (query-based relevance)
6. [ ] Update `loadContext()` to use new allocator
7. [ ] Add debug mode for visibility

**Verification:**
```bash
# Test context allocation
curl -X POST .../v1/memory/context -d '{"maxTokens": 2000, "debug": true}'

# Verify coffee preference surfaces
# (create test data first)
curl -X POST .../v1/memory -d '{"raw": "Beaux loves coffee, especially lattes"}'
curl -X POST .../v1/memory/context -d '{"maxTokens": 500}'
# Should include coffee memory in response
```

### Phase 3: Emotional Detection (Week 3)
*Effort: ~15 hours*

**Goals:**
- Enhance extraction to detect emotional signals
- Update scoring to use emotional weight
- Add user emphasis signals (pinned, starred)

**Tasks:**
1. [ ] Update extraction prompt for emotional detection
2. [ ] Add sentiment, intensity, isPreference to extraction storage
3. [ ] Integrate emotional signals into `ImportanceScorerService`
4. [ ] Add pinned/starred support to API
5. [ ] Add `PATCH /memory/:id/importance` endpoint

**Verification:**
```bash
# Test emotional detection
curl -X POST .../v1/memory -d '{"raw": "I HATE mushrooms, never put them on my pizza"}'
curl -X GET .../v1/memory/{id}/score
# Should show high emotionalBoost

# Test pinning
curl -X PATCH .../v1/memory/{id}/importance -d '{"pinned": true}'
```

### Phase 4: Consolidation Engine (Week 4)
*Effort: ~30 hours*

**Goals:**
- Implement tier transitions
- Implement semantic clustering
- Implement pattern promotion
- Implement stale archival
- Set up nightly job

**Tasks:**
1. [ ] Create `ConsolidationEngineService`
2. [ ] Implement `applyTierTransitions()`
3. [ ] Implement `clusterAndPromote()` (extend existing `ConsolidationService`)
4. [ ] Implement `archiveStale()`
5. [ ] Add `POST /consolidation/run` endpoint
6. [ ] Set up cron job for nightly consolidation
7. [ ] Add consolidation job tracking (extend `ConsolidationJob` model)

**Verification:**
```bash
# Test consolidation
curl -X POST .../v1/consolidation/run -d '{"userId": "...", "dryRun": true}'
# Review preview

curl -X POST .../v1/consolidation/run -d '{"userId": "..."}'
# Verify tier transitions, clusters, archival
```

### Phase 5: Performance & Polish (Week 5)
*Effort: ~15 hours*

**Goals:**
- Add score caching for fast queries
- Optimize batch operations
- Add monitoring/metrics
- Documentation

**Tasks:**
1. [ ] Create `MemoryScoreCache` table
2. [ ] Implement async cache refresh
3. [ ] Add cache fallback in `loadContext()`
4. [ ] Add performance metrics (latency, cache hit rate)
5. [ ] Write API documentation
6. [ ] Write operator runbook

**Verification:**
```bash
# Test cache performance
time curl -X POST .../v1/memory/context -d '{"maxTokens": 2000}'
# Should be <100ms with warm cache

# Check metrics
curl .../metrics | grep memory_intelligence
```

---

## 8. Performance Considerations

### 8.1 At Scale (10k+ memories per user)

| Operation | Current | With Intelligence | Target |
|-----------|---------|-------------------|--------|
| `loadContext()` | O(n) scan | O(log n) index | <50ms |
| Score recompute | N/A | O(1) per memory | <5ms |
| Consolidation | N/A | O(n log n) | <60s for 10k |

### 8.2 Optimizations

1. **Score caching** — Materialize `effectiveScore` with `staleAfter`, refresh async
2. **Partial index** — `WHERE tier IN ('CORE', 'ACTIVE') AND deleted_at IS NULL`
3. **Batch scoring** — Process 500 memories per batch during consolidation
4. **Embedding cache** — Reuse embeddings for clustering (already stored)

### 8.3 Indexes

```sql
-- Fast context loading (most common query)
CREATE INDEX idx_memories_context_load 
  ON memories(user_id, layer, tier, effective_score DESC)
  WHERE deleted_at IS NULL AND tier IN ('CORE', 'ACTIVE');

-- Consolidation queries
CREATE INDEX idx_memories_consolidation
  ON memories(user_id, layer, tier, created_at)
  WHERE deleted_at IS NULL AND consolidated_into IS NULL;

-- Stale memory archival
CREATE INDEX idx_memories_stale
  ON memories(user_id, tier, last_used_at)
  WHERE deleted_at IS NULL AND tier = 'COLD';
```

---

## 9. Open Questions

1. **Token counting accuracy** — Should we use tiktoken or a simpler heuristic?
   - *Recommendation:* Use tiktoken for accuracy, cache token counts per memory

2. **Decay reset on consolidation** — Should consolidating memories reset decay?
   - *Recommendation:* Yes, canonical memory gets fresh decay clock

3. **Cross-user patterns** — Should we detect patterns across users?
   - *Recommendation:* Not in v1 (privacy concerns), consider for v2

4. **Real-time vs batch scoring** — Score on write or compute on read?
   - *Recommendation:* Compute on write, cache, refresh in background

5. **Agent vs user memory budgets** — Same allocation rules?
   - *Recommendation:* Agent memories use reserve budget, cap at 10%

---

## 10. Success Metrics

| Metric | Current | Target | Measurement |
|--------|---------|--------|-------------|
| Identity memory recall rate | ~60% | >90% | % of identity facts that surface in context |
| Context relevance score | N/A | >0.7 | User feedback on context quality |
| Time to surface preference | Unknown | <3 sessions | Sessions until preference reliably appears |
| Context load latency (p50) | ~200ms | <50ms | Monitoring |
| Score freshness | N/A | <24h | Time since last score recompute |

---

## Appendix A: Example Scenarios

### Scenario 1: Coffee Preference

```
1. User says: "I need my morning coffee, large latte with dairy"

2. Memory created:
   - raw: "Beaux needs morning coffee, large latte with dairy"
   - layer: IDENTITY (detected via "need", stable preference)
   - emotionalWeight: 0.7 (sentiment: positive, intensity: 0.6)
   - effectiveScore: 0.65

3. Memory used 5 times over 2 weeks:
   - usageBoost: 0.1
   - effectiveScore: 0.75

4. loadContext() called with 2000 token budget:
   - IDENTITY tier budget: 700 tokens
   - Coffee memory scores 0.75
   - Included in top 10 identity memories ✓
```

### Scenario 2: Pattern Promotion

```
1. User says "dark mode" preference 4 times over 1 month:
   - "I prefer dark mode"
   - "Can you make that dark mode?"
   - "Light mode hurts my eyes"
   - "Dark mode please"

2. Nightly consolidation:
   - Cluster detected (similarity > 0.85)
   - 4 members ≥ minClusterSize (3)
   - Canonical selected: "I prefer dark mode" (clearest)
   
3. Actions:
   - Canonical promoted to IDENTITY layer
   - Canonical boosted: effectiveScore += 0.2
   - Non-canonical archived with consolidatedInto reference

4. Result:
   - Single clean memory: "Beaux prefers dark mode"
   - No duplicates cluttering context
```

---

## Appendix B: Configuration Reference

```typescript
// config/memory-intelligence.config.ts

export interface MemoryIntelligenceConfig {
  scoring: {
    decayHalfLifeDays: Record<MemoryLayer, number>;
    minDecayFactor: number;
    maxUsageBoost: number;
    usageBoostPerUse: number;
    usageBoostDecay: number;
    maxEmotionalBoost: number;
    pinnedBoost: number;
  };
  
  consolidation: {
    warmThreshold: number;
    coldThreshold: number;
    archiveDaysThreshold: number;
    clusterSimilarityThreshold: number;
    minClusterSize: number;
    nightlyRunHour: number;
  };
  
  allocation: {
    budgets: Record<string, number>;
    minPerTier: Record<string, number>;
    redistributionPriority: Record<string, number>;
  };
}

// Default configuration
export const DEFAULT_CONFIG: MemoryIntelligenceConfig = {
  scoring: {
    decayHalfLifeDays: {
      IDENTITY: Infinity,
      PROJECT: 60,
      SESSION: 14,
      TASK: 3,
    },
    minDecayFactor: 0.1,
    maxUsageBoost: 0.3,
    usageBoostPerUse: 0.02,
    usageBoostDecay: 0.95,
    maxEmotionalBoost: 0.2,
    pinnedBoost: 0.5,
  },
  
  consolidation: {
    warmThreshold: 0.3,
    coldThreshold: 0.15,
    archiveDaysThreshold: 90,
    clusterSimilarityThreshold: 0.85,
    minClusterSize: 3,
    nightlyRunHour: 3,
  },
  
  allocation: {
    budgets: {
      core: 0.20,
      identity: 0.35,
      project: 0.25,
      session: 0.15,
      reserve: 0.05,
    },
    minPerTier: {
      core: 5,
      identity: 10,
      project: 5,
      session: 3,
    },
    redistributionPriority: {
      core: 4,
      identity: 3,
      project: 2,
      session: 1,
    },
  },
};
```

---

*End of Design Document*
