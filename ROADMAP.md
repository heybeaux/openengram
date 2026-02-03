# Engram Roadmap

*Generated: 2026-02-02*
*Last Updated: 2026-02-02*

## Executive Summary

Engram is a memory storage and retrieval system for AI agents. The infrastructure is sound (Prisma schema, NestJS services, vector storage) but the **extraction pipeline is critically broken**. Out of 224 memories, only 1 has actual 5W1H data populated. Entity storage shows 0 entities. Memory linking has only 1 link.

### Root Cause Analysis

**Primary Bug: Case Sensitivity in LLM Response Parsing**

The `ExtractionService.extract()` method expects lowercase keys (`who`, `what`, `when`) but the LLM returns uppercase keys (`WHO`, `WHAT`, `WHEN`). The code falls back to `basicExtraction()` which returns mostly nulls.

```typescript
// extraction.service.ts line ~70
return {
  who: result.who || null,    // ← result.who is undefined
  what: result.what || null,  // ← result.WHO exists but result.what is undefined
  ...
};
```

**Secondary Issues:**
1. Silent failures - errors logged but not propagated
2. `basicExtraction()` fallback returns empty data
3. Entity extraction never gets valid LLM output to process
4. Memory linking depends on embeddings which may fail silently

---

## Current State (2026-02-02)

| Metric | Count | Expected | Status |
|--------|-------|----------|--------|
| Total Memories | 224 | N/A | ✅ Working |
| Memory Extractions | 221 | 224 | ⚠️ 3 missing |
| Extractions with 5W1H data | 1 | 221 | ❌ **BROKEN** |
| Entities stored | 0 | >50 | ❌ **BROKEN** |
| Memory chain links | 1 | >20 | ❌ **BROKEN** |
| Deduplication | Unknown | Working | ⚠️ Untested |

---

## Phase 1: Fix Broken Fundamentals

### P0-001: Fix LLM Response Case Sensitivity
**Priority:** P0 (Critical - Blocking all extraction)  
**Effort:** 30 minutes  
**Dependencies:** None  
**Owner:** TBD

**Problem:** LLM returns uppercase keys (`WHO`, `WHAT`), code expects lowercase.

**Solution:** Normalize LLM response keys to lowercase before processing.

```typescript
// extraction.service.ts - in extract() method
async extract(raw: string, context?: ExtractionContext): Promise<ExtractionResult> {
  try {
    const prompt = EXTRACTION_PROMPT_TEMPLATE(context?.userName);
    
    const rawResult = await this.llm.json<Record<string, any>>(
      [
        { role: 'system', content: prompt },
        { role: 'user', content: `Extract from this memory:\n\n"${raw}"` },
      ],
      undefined,
      { temperature: 0.2 },
    );

    // NORMALIZE KEYS TO LOWERCASE
    const result: ExtractionResponse = {};
    for (const [key, value] of Object.entries(rawResult)) {
      result[key.toLowerCase()] = value;
    }

    return {
      who: result.who || null,
      what: result.what || null,
      when: result.when || null,
      where: result.where || null,
      why: result.why || null,
      how: result.how || null,
      topics: Array.isArray(result.topics) ? result.topics : [],
      entities: this.normalizeEntities(result.entities, context?.userName),
    };
  } catch (error) {
    // ... existing fallback
  }
}
```

**Alternative:** Update the extraction prompt to explicitly request lowercase keys:
```
Respond with JSON using lowercase keys: who, what, when, where, why, how, topics, entities
```

**Verification:**
```bash
# After fix, run:
curl -X POST http://localhost:3001/api/v1/memory \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-key" \
  -d '{"userId": "test", "raw": "Beaux prefers dark mode"}'

# Then check:
SELECT who, what FROM memory_extractions ORDER BY extracted_at DESC LIMIT 1;
# Should return: "Beaux", "prefers dark mode" (not null, null)
```

---

### P0-002: Add Proper Error Logging to Extraction
**Priority:** P0 (Critical - Debugging)  
**Effort:** 1 hour  
**Dependencies:** None

**Problem:** Extraction failures are caught and silently logged. No visibility into what's failing.

**Solution:** Add structured logging with context.

```typescript
// extraction.service.ts
async extract(raw: string, context?: ExtractionContext): Promise<ExtractionResult> {
  try {
    const prompt = EXTRACTION_PROMPT_TEMPLATE(context?.userName);
    
    // Log the attempt
    console.log('[Extraction] Starting extraction for:', raw.substring(0, 50));
    
    const result = await this.llm.json<ExtractionResponse>(...);
    
    // Log raw response for debugging
    console.log('[Extraction] Raw LLM response keys:', Object.keys(result));
    
    // ... rest of method
  } catch (error) {
    // Log the full error, not just a message
    console.error('[Extraction] LLM call failed:', {
      error: error.message,
      stack: error.stack,
      raw: raw.substring(0, 100),
      context,
    });
    return this.basicExtraction(raw, context?.userName);
  }
}
```

---

### P0-003: Verify Entity Storage Pipeline
**Priority:** P0 (Critical)  
**Effort:** 2 hours  
**Dependencies:** P0-001

**Problem:** 0 entities stored despite extraction code existing.

**Root Cause:** If LLM extraction fails and falls back to `basicExtraction()`, entity extraction returns `[]` because:
1. No LLM entities available
2. `basicExtraction()` only extracts entities if it can find capitalized words
3. Most memories may not have obvious entity patterns

**Debugging Steps:**
```typescript
// Add to memory.service.ts extractAndEmbed()
private async extractAndEmbed(...) {
  const extracted = await this.extraction.extract(raw, context);
  
  // DEBUG: Log extracted entities
  console.log('[Memory] Extracted entities:', extracted.entities);
  
  if (extracted.entities && extracted.entities.length > 0) {
    console.log('[Memory] Storing', extracted.entities.length, 'entities');
    await this.storeEntities(userId, memoryId, extracted.entities);
  }
  // ...
}
```

**Verification:**
```sql
SELECT COUNT(*) FROM entities;
SELECT * FROM entities LIMIT 10;
SELECT COUNT(*) FROM memory_entities;
```

---

### P1-001: Backfill Existing Memories
**Priority:** P1 (High)  
**Effort:** 4 hours  
**Dependencies:** P0-001, P0-003

**Problem:** 221 memories have empty 5W1H data. Need to re-extract.

**Solution:** Create a backfill script/endpoint.

```typescript
// src/memory/backfill.service.ts
@Injectable()
export class BackfillService {
  constructor(
    private prisma: PrismaService,
    private extraction: ExtractionService,
    private embedding: EmbeddingService,
  ) {}

  async backfillExtractions(options: { 
    batchSize?: number; 
    dryRun?: boolean;
  } = {}): Promise<{ processed: number; errors: number }> {
    const { batchSize = 50, dryRun = false } = options;
    
    // Find memories with empty extractions
    const memories = await this.prisma.memory.findMany({
      where: {
        deletedAt: null,
        extraction: {
          OR: [
            { who: null },
            { what: null },
          ],
        },
      },
      include: { 
        extraction: true,
        user: { select: { externalId: true } },
      },
      take: batchSize,
    });

    let processed = 0;
    let errors = 0;

    for (const memory of memories) {
      try {
        const context: ExtractionContext = {
          userId: memory.userId,
          userName: memory.user.externalId,
        };

        const extracted = await this.extraction.extract(memory.raw, context);

        if (!dryRun) {
          await this.prisma.memoryExtraction.update({
            where: { memoryId: memory.id },
            data: {
              who: extracted.who,
              what: extracted.what,
              when: extracted.when ? new Date(extracted.when) : null,
              whereCtx: extracted.where,
              why: extracted.why,
              how: extracted.how,
              topics: extracted.topics,
              extractedAt: new Date(),
            },
          });

          // Store entities
          if (extracted.entities.length > 0) {
            await this.storeEntities(memory.userId, memory.id, extracted.entities);
          }
        }

        processed++;
        console.log(`[Backfill] Processed ${memory.id}: ${extracted.who} - ${extracted.what}`);
      } catch (error) {
        errors++;
        console.error(`[Backfill] Failed ${memory.id}:`, error.message);
      }
    }

    return { processed, errors };
  }
}
```

**Endpoint:**
```typescript
// Add to memory.controller.ts
@Post('backfill')
@ApiOperation({ summary: 'Backfill missing extractions' })
async backfill(@Query('dryRun') dryRun?: boolean): Promise<{ processed: number; errors: number }> {
  return this.backfillService.backfillExtractions({ dryRun: dryRun === true });
}
```

---

### P1-002: Fix Auto-Extractor Case Sensitivity
**Priority:** P1 (High)  
**Effort:** 30 minutes  
**Dependencies:** P0-001

**Problem:** Same case sensitivity issue likely exists in `auto-extractor.service.ts`.

**Location:** `src/auto/auto-extractor.service.ts` line ~60

```typescript
const result = await this.llm.json<ExtractionResponse>(...);

// Add key normalization here too
const normalized = {};
for (const [key, value] of Object.entries(result)) {
  normalized[key.toLowerCase()] = value;
}

return this.processExtractions(normalized.facts || [], turns, signals, context?.userName);
```

---

### P1-003: Improve basicExtraction Fallback
**Priority:** P1 (High)  
**Effort:** 2 hours  
**Dependencies:** None

**Problem:** When LLM fails, `basicExtraction()` returns mostly nulls, losing the memory content.

**Solution:** Make fallback more useful:

```typescript
private basicExtraction(raw: string, userName?: string): ExtractionResult {
  let processedRaw = raw;
  if (userName) {
    processedRaw = raw
      .replace(/\bUser\b/g, userName)
      .replace(/\buser\b/g, userName)
      .replace(/\bthe user\b/gi, userName);
  }

  return {
    who: userName || this.extractWho(processedRaw),
    // CHANGE: Always set 'what' to the content
    what: processedRaw, // Not truncated - let caller handle
    when: this.extractWhen(processedRaw), // NEW: Try to extract dates
    where: null,
    why: null,
    how: null,
    topics: this.extractTopics(processedRaw),
    entities: this.extractEntitiesWithTypes(processedRaw, userName),
  };
}

// NEW: Basic date extraction
private extractWhen(raw: string): string | null {
  // Look for date patterns
  const patterns = [
    /\b(\d{4}-\d{2}-\d{2})\b/,  // ISO date
    /\b(today|yesterday|tomorrow)\b/i,
    /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i,
    /\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2}/i,
  ];
  
  for (const pattern of patterns) {
    const match = raw.match(pattern);
    if (match) return match[0];
  }
  return null;
}
```

---

## Phase 2: Enhance Quality

### P2-001: Verify Deduplication is Working
**Priority:** P2 (Medium)  
**Effort:** 2 hours  
**Dependencies:** Phase 1

**Problem:** Dedup threshold is set (0.90) but unclear if working.

**Verification Test:**
```bash
# Store same fact twice
curl -X POST http://localhost:3001/api/v1/memory \
  -d '{"userId": "test", "raw": "I prefer dark mode"}'
  
curl -X POST http://localhost:3001/api/v1/memory \
  -d '{"userId": "test", "raw": "I really prefer dark mode for everything"}'

# Check: second call should NOT create new memory if similarity > 0.90
# Should increment usedCount on first memory instead
```

**Add Integration Test:**
```typescript
// test/dedup.e2e-spec.ts
describe('Deduplication', () => {
  it('should not create duplicate for very similar memory', async () => {
    const first = await memoryService.remember(userId, { raw: 'I prefer dark mode' });
    const second = await memoryService.remember(userId, { raw: 'I really prefer dark mode' });
    
    // Should return same memory ID
    expect(second.id).toBe(first.id);
    
    // usedCount should increment
    const updated = await memoryService.getById(first.id);
    expect(updated.usedCount).toBe(1);
  });
});
```

---

### P2-002: Improve Memory Linking
**Priority:** P2 (Medium)  
**Effort:** 4 hours  
**Dependencies:** P0-001, P2-001

**Problem:** Only 1 memory link exists despite 224 memories.

**Root Cause:** `linkRelatedMemories()` only runs after successful extraction and embedding. If those fail, no links created.

**Solution:** 
1. Ensure linking runs even if extraction partially fails
2. Add batch linking job for existing memories

```typescript
// memory.service.ts - make linking more robust
private async extractAndEmbed(...) {
  let embedding: number[] | null = null;
  
  // 1. Extract (may fail)
  try {
    const extracted = await this.extraction.extract(raw, context);
    // Store extraction...
  } catch (e) {
    console.error('Extraction failed, continuing with embedding');
  }

  // 2. Embed (should succeed independently)
  try {
    embedding = await this.embedding.generate(raw);
    const embeddingId = await this.embedding.store(memoryId, embedding);
    await this.prisma.memory.update({
      where: { id: memoryId },
      data: { embeddingId },
    });
  } catch (e) {
    console.error('Embedding failed');
    return; // Can't link without embedding
  }

  // 3. Link (depends on embedding)
  if (embedding) {
    await this.linkRelatedMemories(memoryId, embedding, userId);
  }
}
```

**Batch Link Job:**
```typescript
async batchLinkMemories(userId: string, batchSize: number = 50): Promise<number> {
  const memories = await this.prisma.memory.findMany({
    where: { 
      userId, 
      deletedAt: null,
      embedding: { not: null },
    },
    take: batchSize,
  });

  let linksCreated = 0;
  
  for (const memory of memories) {
    // Re-run linking logic
    const embedding = await this.vector.getEmbedding(memory.id);
    if (embedding) {
      const newLinks = await this.linkRelatedMemories(memory.id, embedding, userId);
      linksCreated += newLinks;
    }
  }

  return linksCreated;
}
```

---

### P2-003: Implement Memory Decay
**Priority:** P2 (Medium)  
**Effort:** 6 hours  
**Dependencies:** None

**Problem:** Old memories don't fade. No mechanism to deprioritize stale information.

**Solution:** Add decay factor to retrieval scoring.

```typescript
// memory.service.ts
interface DecayConfig {
  halfLifeDays: number;  // Days until importance halves (default: 30)
  minScore: number;      // Floor for decayed score (default: 0.1)
  reinforcementBoost: number; // Boost when memory is used (default: 0.1)
}

private calculateDecayedImportance(
  baseImportance: number,
  createdAt: Date,
  lastUsedAt: Date | null,
  config: DecayConfig = { halfLifeDays: 30, minScore: 0.1, reinforcementBoost: 0.1 }
): number {
  const now = new Date();
  const referenceDate = lastUsedAt || createdAt;
  const daysSinceActive = (now.getTime() - referenceDate.getTime()) / (1000 * 60 * 60 * 24);
  
  // Exponential decay: importance * 0.5^(days/halfLife)
  const decayFactor = Math.pow(0.5, daysSinceActive / config.halfLifeDays);
  const decayed = baseImportance * decayFactor;
  
  return Math.max(decayed, config.minScore);
}
```

**Apply in recall:**
```typescript
// In recall(), after vector search
const orderedMemories = memoryIds.map(id => {
  const memory = memories.find(m => m.id === id);
  if (!memory) return null;
  
  const decayedImportance = this.calculateDecayedImportance(
    memory.importanceScore,
    memory.createdAt,
    memory.lastUsedAt,
  );
  
  return {
    ...memory,
    score: scoreMap.get(id),
    effectiveImportance: decayedImportance,
  };
});
```

---

### P2-004: Add Confidence Scores to Extractions
**Priority:** P2 (Medium)  
**Effort:** 3 hours  
**Dependencies:** P0-001

**Problem:** No way to distinguish between stated facts and uncertain inferences.

**Solution:** Update extraction prompt to include confidence:

```typescript
const EXTRACTION_PROMPT_TEMPLATE = (userName?: string) => `...
For each field, also provide a confidence score (0.0-1.0):
- 1.0: Explicitly stated
- 0.7-0.9: Strongly implied  
- 0.4-0.6: Inferred
- 0.1-0.3: Guessed

Return JSON format:
{
  "who": { "value": "Beaux", "confidence": 1.0 },
  "what": { "value": "prefers dark mode", "confidence": 1.0 },
  ...
}
`;
```

**Schema Change:**
```prisma
model MemoryExtraction {
  // ... existing fields
  whoConfidence    Float?  @map("who_confidence")
  whatConfidence   Float?  @map("what_confidence")
  // etc.
}
```

---

## Phase 3: OpenClaw Integration

### P3-001: Document Memory Capture Hook API
**Priority:** P3 (Low)  
**Effort:** 4 hours  
**Dependencies:** Phase 1, Phase 2

**Goal:** Enable OpenClaw to automatically capture memories from conversations.

**Current Integration Point:** `POST /api/v1/auto/observe`

```typescript
interface ObserveDto {
  turns: MessageTurnDto[];  // Conversation turns
  projectId?: string;
  sessionId?: string;
  minImportance?: number;   // Default 0.4
}

interface MessageTurnDto {
  role: 'user' | 'assistant';
  content: string;
  timestamp?: string;
}
```

**OpenClaw Integration Guide:**
```typescript
// In OpenClaw conversation handler
async function onConversationTurn(turn: Turn) {
  // Batch turns (don't call on every message)
  conversationBuffer.push(turn);
  
  if (conversationBuffer.length >= 5 || turn.isEndOfSession) {
    await engramClient.observe({
      turns: conversationBuffer,
      sessionId: conversation.id,
      projectId: conversation.projectId,
    });
    conversationBuffer = [];
  }
}
```

---

### P3-002: Add Webhook for Memory Events
**Priority:** P3 (Low)  
**Effort:** 8 hours  
**Dependencies:** Phase 2

**Goal:** Let OpenClaw react to memory events (contradictions, patterns).

**Events to Support:**
- `MEMORY_CREATED` - New memory stored
- `DUPLICATE_DETECTED` - Existing memory reinforced
- `CONTRADICTION_DETECTED` - New memory contradicts existing
- `PATTERN_DETECTED` - Repeated behavior identified

**Implementation:**
```typescript
// webhook.service.ts - extend existing
async emitEvent(event: WebhookEvent, payload: any): Promise<void> {
  const webhooks = await this.prisma.webhook.findMany({
    where: {
      isActive: true,
      events: { has: event },
    },
  });

  for (const webhook of webhooks) {
    await this.deliver(webhook, event, payload);
  }
}
```

---

### P3-003: Memory Context in System Prompt
**Priority:** P3 (Low)  
**Effort:** 2 hours  
**Dependencies:** Phase 1

**Goal:** Format memories for injection into OpenClaw system prompts.

**Current Endpoint:** `POST /api/v1/memory/context`

**Optimizations Needed:**
1. Token-aware truncation
2. Priority ordering (identity > project > session)
3. Recency weighting
4. Deduplication in context

```typescript
// Improved formatContext
private formatContext(memories: Memory[], maxTokens: number): { text: string; tokens: number } {
  // Sort by effective importance (base * recency * usage)
  const scored = memories.map(m => ({
    ...m,
    score: this.scoreForContext(m),
  })).sort((a, b) => b.score - a.score);

  // Deduplicate similar memories
  const unique = this.deduplicateForContext(scored);

  // Build context with token budget
  let text = '';
  let tokens = 0;
  
  for (const memory of unique) {
    const line = `- ${memory.raw}\n`;
    const lineTokens = this.estimateTokens(line);
    
    if (tokens + lineTokens > maxTokens) break;
    
    text += line;
    tokens += lineTokens;
  }

  return { text, tokens };
}
```

---

## Phase 4: Dashboard & Analytics

### P4-001: Memory Browser UI
**Priority:** P3 (Low)  
**Effort:** 16 hours  
**Dependencies:** Phase 1

**Goal:** Web UI to browse/edit memories without API calls.

**Tech Stack:** 
- Next.js or simple React SPA
- Served from NestJS static folder
- Uses existing REST API

**Features:**
- List memories with search/filter
- View extraction details (5W1H)
- Edit memory content/layer
- Delete memories
- View memory links graph

---

### P4-002: Analytics Dashboard
**Priority:** P3 (Low)  
**Effort:** 12 hours  
**Dependencies:** Phase 1, P4-001

**Metrics to Display:**
- Total memories by layer
- Memories created over time
- Top entities mentioned
- Extraction quality (% with 5W1H data)
- Memory usage (retrieval counts)
- Dedup rate (duplicates prevented)

---

### P4-003: Memory Health Checks
**Priority:** P2 (Medium)  
**Effort:** 4 hours  
**Dependencies:** Phase 1

**Goal:** API endpoint to assess memory system health.

```typescript
@Get('health')
async getHealth(): Promise<MemoryHealthReport> {
  const [
    totalMemories,
    extractionsWithData,
    totalEntities,
    totalLinks,
    recentCreations,
  ] = await Promise.all([
    this.prisma.memory.count({ where: { deletedAt: null } }),
    this.prisma.memoryExtraction.count({
      where: { OR: [{ who: { not: null } }, { what: { not: null } }] },
    }),
    this.prisma.entity.count(),
    this.prisma.memoryChainLink.count(),
    this.prisma.memory.count({
      where: { createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
    }),
  ]);

  const extractionRate = totalMemories > 0 
    ? extractionsWithData / totalMemories 
    : 0;

  return {
    status: extractionRate > 0.8 ? 'healthy' : extractionRate > 0.5 ? 'degraded' : 'unhealthy',
    metrics: {
      totalMemories,
      extractionRate,
      entitiesPerMemory: totalMemories > 0 ? totalEntities / totalMemories : 0,
      linksPerMemory: totalMemories > 0 ? totalLinks / totalMemories : 0,
      memoriesLast24h: recentCreations,
    },
    issues: this.detectIssues(extractionRate, totalEntities, totalLinks),
  };
}
```

---

## Implementation Priority Matrix

| ID | Task | Priority | Effort | Dependencies | Status |
|----|------|----------|--------|--------------|--------|
| P0-001 | Fix LLM case sensitivity | P0 | 30m | None | 🔴 Not Started |
| P0-002 | Add error logging | P0 | 1h | None | ✅ Complete |
| P0-003 | Verify entity storage | P0 | 2h | P0-001 | 🔴 Not Started |
| P1-001 | Backfill extractions | P1 | 4h | P0-001, P0-003 | 🔴 Not Started |
| P1-002 | Fix auto-extractor | P1 | 30m | P0-001 | 🔴 Not Started |
| P1-003 | Improve fallback | P1 | 2h | None | 🔴 Not Started |
| P2-001 | Verify deduplication | P2 | 2h | Phase 1 | 🔴 Not Started |
| P2-002 | Fix memory linking | P2 | 4h | P0-001, P2-001 | 🔴 Not Started |
| P2-003 | Implement decay | P2 | 6h | None | 🔴 Not Started |
| P2-004 | Confidence scores | P2 | 3h | P0-001 | 🔴 Not Started |
| P3-001 | OpenClaw hook docs | P3 | 4h | Phase 1-2 | 🔴 Not Started |
| P3-002 | Webhooks | P3 | 8h | Phase 2 | 🔴 Not Started |
| P3-003 | Context optimization | P3 | 2h | Phase 1 | 🔴 Not Started |
| P4-001 | Memory browser | P3 | 16h | Phase 1 | 🔴 Not Started |
| P4-002 | Analytics dashboard | P3 | 12h | P4-001 | 🔴 Not Started |
| P4-003 | Health checks | P2 | 4h | Phase 1 | 🔴 Not Started |

---

## Quick Start for Agents

### Fix the Critical Bug (P0-001)

1. Open `src/memory/extraction.service.ts`
2. Find the `extract()` method (~line 62)
3. After `const result = await this.llm.json<ExtractionResponse>(...)`, add:

```typescript
// Normalize keys to lowercase (LLM may return uppercase)
const normalizedResult: ExtractionResponse = {};
for (const [key, value] of Object.entries(result)) {
  normalizedResult[key.toLowerCase() as keyof ExtractionResponse] = value;
}
```

4. Replace all `result.xxx` with `normalizedResult.xxx`
5. Do the same in `src/auto/auto-extractor.service.ts`
6. Run tests: `npm test`
7. Verify fix:
   ```bash
   curl -X POST http://localhost:3001/api/v1/memory \
     -H "Content-Type: application/json" \
     -d '{"userId": "test", "raw": "Test memory after fix"}'
   
   # Check database
   node -e "
   const { PrismaClient } = require('@prisma/client');
   const p = new PrismaClient();
   p.memoryExtraction.findFirst({ orderBy: { extractedAt: 'desc' } })
     .then(e => { console.log(e); p.\$disconnect(); });
   "
   ```

---

## Testing Checklist

After Phase 1 completion, verify:

- [ ] New memory has `who` and `what` populated
- [ ] New memory creates entity records
- [ ] Memory linking creates `MemoryChainLink` records
- [ ] Backfill script processes old memories
- [ ] Error logs show meaningful information
- [ ] Health endpoint returns `healthy` status

---

## Phase 5: Memory Intelligence & Self-Awareness

*Added: 2026-02-03 based on real-world usage observations*

### P5-001: Memory Correction / Edit API
**Priority:** P1 (High)  
**Effort:** 4 hours  
**Dependencies:** Phase 1

**Problem:** Memories can contain errors (wrong dates, incorrect facts). No way to fix them.

**Observations:**
- Memory shows "February 2023" for a LinkedIn article that doesn't exist yet
- Users need a non-intrusive way to correct memories

**Solution Options:**

**Option A: Direct Edit (PATCH endpoint)**
```typescript
// PATCH /v1/memories/:id
@Patch(':id')
async updateMemory(
  @Param('id') id: string,
  @Body() dto: UpdateMemoryDto,
): Promise<Memory> {
  return this.memoryService.update(id, dto);
}

interface UpdateMemoryDto {
  raw?: string;           // Update raw content
  layer?: MemoryLayer;    // Promote/demote layer
  importance?: number;    // Adjust importance
  extraction?: Partial<{  // Fix extracted fields
    who: string;
    what: string;
    when: string;
    where: string;
    why: string;
    how: string;
  }>;
}
```

**Option B: Contradiction/Supersede System**
```typescript
// POST /v1/memories/:id/correct
@Post(':id/correct')
async correctMemory(
  @Param('id') id: string,
  @Body() dto: CorrectionDto,
): Promise<Memory> {
  // 1. Mark old memory as superseded
  await this.prisma.memory.update({
    where: { id },
    data: { 
      supersededBy: newMemory.id,
      supersededAt: new Date(),
    },
  });
  
  // 2. Create correction memory with link
  const correction = await this.memoryService.remember({
    raw: dto.correctedContent,
    source: 'USER_CORRECTION',
  });
  
  // 3. Create CONTRADICTS link
  await this.createLink(correction.id, id, 'CONTRADICTS', 1.0);
  
  return correction;
}
```

**Recommendation:** Implement both. Direct edits for typo fixes, contradiction system for factual corrections that should preserve history.

---

### P5-002: User Identity Backfill
**Priority:** P2 (Medium)  
**Effort:** 2 hours  
**Dependencies:** P0-001 (complete)

**Problem:** Old memories contain `user_beaux` or `User` instead of `Beaux`. The user identity resolution fix only applies to NEW memories.

**Solution:** Backfill script to update old memories.

```typescript
// src/memory/backfill.service.ts
async backfillUserIdentity(
  userId: string, 
  actualName: string,
  options: { dryRun?: boolean } = {}
): Promise<{ updated: number }> {
  const patterns = [
    /\buser_\w+\b/gi,           // user_beaux, user_123
    /\bUser\b/g,                 // User (capitalized)
    /\bthe user\b/gi,            // the user
  ];

  const memories = await this.prisma.memory.findMany({
    where: { userId, deletedAt: null },
    include: { extraction: true },
  });

  let updated = 0;
  
  for (const memory of memories) {
    let rawUpdated = memory.raw;
    let whoUpdated = memory.extraction?.who;
    let whatUpdated = memory.extraction?.what;
    
    for (const pattern of patterns) {
      rawUpdated = rawUpdated.replace(pattern, actualName);
      if (whoUpdated) whoUpdated = whoUpdated.replace(pattern, actualName);
      if (whatUpdated) whatUpdated = whatUpdated.replace(pattern, actualName);
    }
    
    if (rawUpdated !== memory.raw || whoUpdated !== memory.extraction?.who) {
      if (!options.dryRun) {
        await this.prisma.memory.update({
          where: { id: memory.id },
          data: { raw: rawUpdated },
        });
        
        if (memory.extraction) {
          await this.prisma.memoryExtraction.update({
            where: { memoryId: memory.id },
            data: { who: whoUpdated, what: whatUpdated },
          });
        }
      }
      updated++;
    }
  }
  
  return { updated };
}
```

**Endpoint:**
```typescript
@Post('backfill/user-identity')
async backfillUserIdentity(
  @Body() dto: { userId: string; actualName: string; dryRun?: boolean }
): Promise<{ updated: number }> {
  return this.backfillService.backfillUserIdentity(dto.userId, dto.actualName, { dryRun: dto.dryRun });
}
```

---

### P5-003: Intelligent Layer Classification
**Priority:** P2 (Medium)  
**Effort:** 6 hours  
**Dependencies:** P0-001 (complete)

**Problem:** Memories about identity facts are stored as SESSION instead of IDENTITY. Example: "Beaux prefers dark mode" should be IDENTITY, not SESSION.

**Current Logic:** Layer is passed in by caller or defaults to SESSION.

**Solution A: Smart Initial Classification**
```typescript
// extraction.service.ts
private classifyLayer(extracted: ExtractionResult, raw: string): MemoryLayer {
  // Identity signals
  const identityPatterns = [
    /\b(prefer|always|never|favorite|hate|love)\b/i,
    /\b(born|birthday|age|live|from)\b/i,
    /\b(name is|called|known as)\b/i,
    /\b(wife|husband|daughter|son|family)\b/i,
    /\b(work at|job|profession|career)\b/i,
  ];
  
  // Project signals
  const projectPatterns = [
    /\b(project|building|developing|working on)\b/i,
    /\b(repo|codebase|feature|milestone)\b/i,
    /\b(deadline|sprint|release)\b/i,
  ];
  
  // Check for identity patterns
  for (const pattern of identityPatterns) {
    if (pattern.test(raw)) return 'IDENTITY';
  }
  
  // Check for project patterns
  for (const pattern of projectPatterns) {
    if (pattern.test(raw)) return 'PROJECT';
  }
  
  // Check entities - people often indicate identity memories
  const personEntities = extracted.entities.filter(e => e.type === 'person');
  if (personEntities.some(e => e.name.toLowerCase() === extracted.who?.toLowerCase())) {
    return 'IDENTITY';
  }
  
  return 'SESSION'; // Default
}
```

**Solution B: Layer Promotion Job (Consolidation)**
```typescript
// consolidation.service.ts
async promoteRecurringPatterns(userId: string): Promise<{ promoted: number }> {
  // Find SESSION memories that appear multiple times (similar content)
  const sessionMemories = await this.prisma.memory.findMany({
    where: { userId, layer: 'SESSION', deletedAt: null },
  });
  
  // Group by semantic similarity
  const clusters = await this.clusterBySimilarity(sessionMemories, 0.85);
  
  let promoted = 0;
  
  for (const cluster of clusters) {
    if (cluster.length >= 3) { // Repeated 3+ times = promote
      // Pick the most complete memory as the "canonical" one
      const canonical = cluster.sort((a, b) => 
        (b.extraction?.what?.length || 0) - (a.extraction?.what?.length || 0)
      )[0];
      
      // Promote to IDENTITY
      await this.prisma.memory.update({
        where: { id: canonical.id },
        data: { 
          layer: 'IDENTITY',
          importanceScore: Math.min(1.0, canonical.importanceScore + 0.2),
        },
      });
      
      // Mark others as consolidated
      for (const other of cluster.filter(m => m.id !== canonical.id)) {
        await this.prisma.memory.update({
          where: { id: other.id },
          data: { 
            consolidatedInto: canonical.id,
            deletedAt: new Date(), // Soft delete
          },
        });
      }
      
      promoted++;
    }
  }
  
  return { promoted };
}
```

**Recommendation:** Implement both. Smart classification catches obvious cases upfront; consolidation job handles patterns that emerge over time.

---

### P5-004: Agent Self-Memories 🔥
**Priority:** P1 (High)  
**Effort:** 8 hours  
**Dependencies:** Phase 1

**Problem:** Engram only stores memories ABOUT users. Agents need memories about THEMSELVES — identity, capabilities, lessons learned, mistakes made.

**Why This Matters:**
- Agent continuity: "I am Rook, named on 2026-01-26"
- Self-improvement: "I tend to mark tasks COMPLETED without verifying"
- Capability awareness: "I can generate images using the nano-banana-pro skill"
- Relationship memory: "Beaux prefers direct communication"

**Solution: Add Agent Self-Memory Support**

**Schema Changes:**
```prisma
model Memory {
  // ... existing fields
  
  // Who is this memory ABOUT? (not who created it)
  subjectType    SubjectType  @default(USER) @map("subject_type")
  subjectId      String       @map("subject_id")  // userId or agentId
  
  // For agent self-memories, track which agent
  agentId        String?      @map("agent_id")
}

enum SubjectType {
  USER    // Memory about a user
  AGENT   // Memory about an agent (self)
  ENTITY  // Memory about a thing/project
}
```

**API Changes:**
```typescript
// POST /v1/memories (updated)
interface CreateMemoryDto {
  raw: string;
  
  // Existing
  userId?: string;
  
  // New: who is this memory ABOUT?
  subjectType?: 'USER' | 'AGENT' | 'ENTITY';
  subjectId?: string;  // Required if subjectType specified
  
  // For agent self-memories
  agentId?: string;
}

// Example: Agent creating a self-memory
POST /v1/memories
{
  "raw": "I am Rook, an AI assistant. I was named on 2026-01-26 by Beaux.",
  "agentId": "rook",
  "subjectType": "AGENT",
  "subjectId": "rook",
  "layer": "IDENTITY",
  "source": "AGENT_REFLECTION"
}

// Example: Agent remembering a lesson
POST /v1/memories
{
  "raw": "I learned to always verify data exists before marking tasks COMPLETED",
  "agentId": "rook",
  "subjectType": "AGENT", 
  "subjectId": "rook",
  "layer": "IDENTITY",
  "source": "LESSON_LEARNED"
}
```

**Recall Changes:**
```typescript
// GET /v1/memories/recall (updated)
interface RecallDto {
  query: string;
  
  // New: what kind of memories to include?
  includeUserMemories?: boolean;   // Default true
  includeAgentMemories?: boolean;  // Default true
  agentId?: string;                // Filter to specific agent
}
```

**Agent Reflection Endpoint:**
```typescript
// POST /v1/agents/:agentId/reflect
// Trigger agent self-reflection to create self-memories
@Post('agents/:agentId/reflect')
async agentReflect(
  @Param('agentId') agentId: string,
  @Body() dto: ReflectionDto,
): Promise<Memory[]> {
  // Use LLM to extract self-knowledge from recent interactions
  const prompt = `Based on these recent interactions, what should the agent remember about ITSELF?
  
  Focus on:
  - Identity (name, role, capabilities)
  - Lessons learned (mistakes, corrections)
  - User preferences discovered
  - Working style insights
  
  Interactions:
  ${dto.recentTurns.map(t => `${t.role}: ${t.content}`).join('\n')}
  `;
  
  const reflections = await this.llm.json<{ memories: string[] }>(prompt);
  
  const created: Memory[] = [];
  for (const memory of reflections.memories) {
    const mem = await this.memoryService.remember({
      raw: memory,
      agentId,
      subjectType: 'AGENT',
      subjectId: agentId,
      layer: 'IDENTITY',
      source: 'AGENT_REFLECTION',
    });
    created.push(mem);
  }
  
  return created;
}
```

**OpenClaw Integration:**
```typescript
// In OpenClaw, periodically trigger self-reflection
async function onSessionEnd(session: Session) {
  if (session.turns.length > 10) {
    await engramClient.post(`/agents/${AGENT_ID}/reflect`, {
      recentTurns: session.turns.slice(-20),
    });
  }
}
```

---

## Updated Implementation Priority Matrix

| ID | Task | Priority | Effort | Dependencies | Status |
|----|------|----------|--------|--------------|--------|
| P0-001 | Fix LLM case sensitivity | P0 | 30m | None | ✅ **Complete (2026-02-03)** |
| P0-002 | Add error logging | P0 | 1h | None | ✅ **Complete (2026-02-03)** |
| P0-003 | Verify entity storage | P0 | 2h | P0-001 | ✅ **Complete (2026-02-03)** |
| P1-001 | Backfill extractions | P1 | 4h | P0-001, P0-003 | ✅ **Complete (2026-02-03)** |
| P1-002 | Fix auto-extractor | P1 | 30m | P0-001 | ✅ **Complete (2026-02-03)** |
| P1-003 | Improve fallback | P1 | 2h | None | 🔴 Not Started |
| P2-001 | Verify deduplication | P2 | 2h | Phase 1 | 🔴 Not Started |
| P2-002 | Fix memory linking | P2 | 4h | P0-001, P2-001 | ✅ **Complete (2026-02-03)** |
| P2-003 | Implement decay | P2 | 6h | None | 🔴 Not Started |
| P2-004 | Confidence scores | P2 | 3h | P0-001 | 🔴 Not Started |
| P3-001 | OpenClaw hook docs | P3 | 4h | Phase 1-2 | 🔴 Not Started |
| P3-002 | Webhooks | P3 | 8h | Phase 2 | 🔴 Not Started |
| P3-003 | Context optimization | P3 | 2h | Phase 1 | 🔴 Not Started |
| P4-001 | Memory browser | P3 | 16h | Phase 1 | 🟡 **Partial (Dashboard exists)** |
| P4-002 | Analytics dashboard | P3 | 12h | P4-001 | 🔴 Not Started |
| P4-003 | Health checks | P2 | 4h | Phase 1 | 🔴 Not Started |
| **P5-001** | **Memory correction API** | **P1** | **4h** | Phase 1 | 🔴 Not Started |
| **P5-002** | **User identity backfill** | **P2** | **2h** | P0-001 | 🔴 Not Started |
| **P5-003** | **Intelligent layer classification** | **P2** | **6h** | P0-001 | 🔴 Not Started |
| **P5-004** | **Agent self-memories** | **P1** | **8h** | Phase 1 | 🔴 Not Started |

---

## Notes for Beaux

1. **✅ Phase 1 Complete:** The critical extraction bugs are fixed. Memories now have proper 5W1H data.
2. **Metrics (2026-02-03):** 235 memories, 87 links, 95 entities, 87.9% WHO extraction rate
3. **Immediate Next Steps:**
   - P5-001 (Memory correction) - Let users fix errors
   - P5-004 (Agent self-memories) - Enable agent identity
4. **Mobile UI:** Both visualization and dashboard are now mobile-friendly

---

*This roadmap will be updated as work progresses. Each agent should update the Status column after completing tasks.*

*Last Updated: 2026-02-03 06:45 PST*
