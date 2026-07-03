# Engram Improvement Plan
*Generated: 2026-02-02*
*Implemented: 2026-02-02*

## ✅ COMPLETED IMPROVEMENTS

### 1. User Identity Resolution
- ✅ Updated `ExtractionService.extract()` to accept `ExtractionContext` with `userName`
- ✅ Updated extraction prompt to use actual user name instead of generic "User"
- ✅ Added post-processing to replace any remaining "User" references with actual name
- ✅ `AutoExtractorService` now accepts `ExtractorContext` with `userName`
- ✅ `ConversationObserverService` fetches user's `externalId` and passes it through pipeline

### 2. Semantic Deduplication
- ✅ Added `findDuplicate()` method in `MemoryService`
- ✅ Dedup check happens BEFORE creating memory (threshold: 0.90 similarity)
- ✅ Duplicates are reinforced instead of created (increments `usedCount`, boosts `importanceScore`)
- ✅ Fail-open behavior if embedding fails (allows creation)

### 3. Source Attribution
- ✅ Added `sourceTimestamp`, `sourceTurnIndex`, `sourceMessageId` to `CreateMemoryDto`
- ✅ Source metadata stored in `MemoryExtraction.rawJson` field
- ✅ `ConversationObserverService` passes turn timestamps through to storage

### 4. Entity Storage
- ✅ Updated `ExtractionService` to return `EntityWithType[]` (name + type)
- ✅ Added `storeEntities()` method in `MemoryService`
- ✅ Entities are normalized, deduplicated, and linked to memories via `MemoryEntity`
- ✅ Extraction prompt updated to request typed entities

### 5. Memory Linking
- ✅ Added `linkRelatedMemories()` method in `MemoryService`
- ✅ Memories with 0.65-0.90 similarity are linked as `RELATED` via `MemoryChainLink`
- ✅ Links created with confidence = similarity score

---

## Problem Statement
Memories are being captured without sufficient context, leading to:
- Generic "User" references instead of actual names
- Duplicate memories (same fact stored multiple times)
- Missing temporal context (when things happened)
- No entity linking (people, projects, orgs)
- No source attribution (which conversation, which turn)

## Root Causes

### 1. Context Loss in Extraction Pipeline
The extraction service only sees the final memory text, not:
- WHO the user actually is (their profile/name)
- The full conversation context
- Timestamps from the original messages

### 2. No Semantic Deduplication at Storage
`auto-extractor.service.ts` does basic Jaccard deduplication on *new* extractions,
but `memory.service.ts` doesn't check against *existing* memories before storing.

### 3. Entity Extraction Without Storage
`extraction.service.ts` extracts entities but they're never written to the Entity table.

### 4. Missing Source Attribution
We store `sessionId` but not:
- The specific turn/message that generated this memory
- The original timestamp of the statement
- A link back to conversation logs

---

## Proposed Fixes

### Fix 1: Enhanced Extraction Context
Pass user profile and conversation context to extraction:

```typescript
// extraction.service.ts
async extract(raw: string, context?: {
  userName?: string;
  userProfile?: Record<string, any>;
  conversationId?: string;
  turnIndex?: number;
  timestamp?: Date;
}): Promise<ExtractionResult>
```

Update the prompt to use this context:
```
Given this memory about ${context.userName || 'a user'}:
"${raw}"

Context:
- Timestamp: ${context.timestamp || 'unknown'}
- Conversation: ${context.conversationId || 'unknown'}
```

### Fix 2: Semantic Deduplication Before Storage
Before creating a new memory, search for similar ones:

```typescript
// memory.service.ts
async remember(userId: string, dto: CreateMemoryDto): Promise<MemoryWithExtraction> {
  // NEW: Check for duplicates first
  const embedding = await this.embedding.generate(dto.raw);
  const similar = await this.embedding.search(userId, embedding, 5);
  
  const duplicate = similar.find(m => m.score > 0.92);
  if (duplicate) {
    // Update existing memory instead of creating new
    await this.reinforceMemory(duplicate.id);
    return this.getById(duplicate.id);
  }
  
  // ... existing creation logic
}
```

### Fix 3: Entity Storage
After extraction, create/link Entity records:

```typescript
// memory.service.ts - in extractAndEmbed()
if (extracted.entities.length > 0) {
  for (const entityName of extracted.entities) {
    const entity = await this.findOrCreateEntity(userId, entityName);
    await this.prisma.memoryEntity.create({
      data: { memoryId, entityId: entity.id }
    });
  }
}
```

### Fix 4: Source Attribution
Add source metadata to CreateMemoryDto and store it:

```typescript
// dto/create-memory.dto.ts
export class CreateMemoryDto {
  // ... existing fields
  
  @IsOptional()
  source?: {
    conversationId?: string;
    turnIndex?: number;
    timestamp?: Date;
    originalText?: string;  // The exact user message
  };
}
```

Store in a new `memory_sources` table or in the extraction's `rawJson` field.

### Fix 5: Memory Linking
After creating a memory, find and link related memories:

```typescript
// memory.service.ts
private async linkRelatedMemories(memoryId: string, embedding: number[], userId: string) {
  const related = await this.embedding.search(userId, embedding, 10);
  
  for (const match of related.filter(m => m.id !== memoryId && m.score > 0.7)) {
    await this.prisma.memoryChainLink.create({
      data: {
        sourceId: memoryId,
        targetId: match.id,
        linkType: 'RELATED',
        confidence: match.score,
        createdBy: 'system',
      }
    });
  }
}
```

### Fix 6: User Resolution
When observing conversations, pass the user's identity:

```typescript
// auto.controller.ts
@Post('observe')
async observe(@Body() dto: ObserveDto, @Request() req) {
  const user = await this.getUser(req);
  return this.observer.observe(user.id, dto, {
    userName: user.name || user.externalId,
    userProfile: user.profile,
  });
}
```

Update the extraction prompt to resolve "User" → actual name.

---

## Implementation Priority

1. **User Resolution** (High Impact, Low Effort)
   - Pass user identity to extraction
   - Update prompt to use real name
   
2. **Semantic Deduplication** (High Impact, Medium Effort)
   - Prevents duplicate memories
   - Reinforces existing memories instead

3. **Source Attribution** (Medium Impact, Low Effort)
   - Store timestamp and turn index
   - Enables "when did I learn this?" queries

4. **Entity Storage** (Medium Impact, Medium Effort)
   - Enable queries like "what do I know about Deanna?"
   - Foundation for relationship tracking

5. **Memory Linking** (Lower Priority)
   - Nice to have but not blocking quality
   - Can be added via consolidation job later

---

## Testing Plan

### Quality Tests
1. Feed same fact twice → should not create duplicate
2. "User prefers X" → should resolve to "Beaux prefers X"
3. Ask "when did you learn X?" → should have timestamp
4. Query "what do you know about [person]?" → should find linked entities

### Regression Tests
1. Existing memories should still load
2. Performance: observe() < 2s
3. Memory creation should not block on extraction

---

## Questions for Beaux
1. Should duplicates be merged or just skipped?
2. What similarity threshold for dedup? (suggest 0.92)
3. Should we backfill existing memories with better extraction?
4. Priority: accuracy first, or also tackle the dashboard?
