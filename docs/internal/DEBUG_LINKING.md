# Memory Linking Debug Report

**Date:** 2026-02-02 23:10 PST
**Auditor:** Engram Memory Linking Auditor Subagent

## Problem Statement
- 221 memories exist in the database
- Only 1 MemoryChainLink record exists
- `linkRelatedMemories()` should create links between semantically similar memories (0.65-0.90 similarity)

## Investigation Summary

### Database State
| Metric | Count |
|--------|-------|
| Total memories | 221 |
| Memories with embeddings | 220 |
| Existing chain links | 1 |
| Memories that SHOULD have links | 86 |
| Total missing links | 152 |

### Root Cause: Missing Backfill

**The linking code works correctly.** The issue is that:

1. Memory linking feature was added in commit `3a90b17` on Feb 2, 2026 at 22:06 PST
2. All 224 memories created BEFORE this commit were never processed for linking
3. `linkRelatedMemories()` is only called during `extractAndEmbed()` - which runs on NEW memory creation
4. The ONE existing link was created correctly 4 seconds after its source memory

### Timeline Evidence
```
Link created at:       2026-02-03T06:56:45.198Z (4.1 seconds after memory)
Memories before link:  224 (never processed for linking)
Memories after link:   4 (processed, but no high-similarity matches found)
```

### Linking Logic Analysis

The `linkRelatedMemories()` function in `memory.service.ts`:
1. ✅ Correctly searches for similar memories using `embedding.search()`
2. ✅ Correctly filters by similarity threshold (0.65-0.90)
3. ✅ Correctly creates links via upsert
4. ❌ **Only runs for NEW memories** - not retroactively applied

```typescript
// Current flow - only runs for new memories
async remember() {
  // ... create memory ...
  this.extractAndEmbed(memory.id, ...).catch(...); // async, fire-and-forget
}

private async extractAndEmbed() {
  // ... extraction ...
  // ... embedding generation ...
  await this.linkRelatedMemories(memoryId, embedding, userId); // Only called here
}
```

### Similarity Score Distribution (sampled 250 pairs)

| Range | Count | Percentage | Status |
|-------|-------|------------|--------|
| ≥ 0.90 (duplicates) | 1 | 0.4% | Would be deduplicated |
| 0.65-0.90 (related) | 38 | 15.2% | **Should be linked** |
| 0.50-0.65 | 96 | 38.4% | Below threshold |
| < 0.50 | 115 | 46.0% | Unrelated |

### Example Missing Links

High-similarity memory pairs that should be linked:

1. **Score 0.880** - "User orders a large latte with dairy milk..." ↔ "User drinks a large latte with dairy milk..."
2. **Score 0.858** - "User works with Salesforce, Pardot, Shopify..." ↔ "User utilizes a multi-system approach..."
3. **Score 0.829** - "Beaux cannot start the day without coffee..." ↔ "User cannot start the day without coffee..."
4. **Score 0.806** - "User never deploys on Fridays..." ↔ "User has a Friday deployment rule..."

## Solution

### 1. Backfill Script (Required)
Run `scripts/backfill-links.ts` to process all existing memories:

```bash
cd ~/projects/agent-memory/engram
npx tsx scripts/backfill-links.ts
```

### 2. Future Improvements (Optional)
- Add logging to `linkRelatedMemories()` for debugging
- Consider running link creation as a batch job periodically
- Add metrics/monitoring for link creation success rate

## Files Modified/Created

| File | Purpose |
|------|---------|
| `scripts/backfill-links.ts` | Backfill links for existing memories |
| `scripts/audit-all-memories.ts` | Audit script to find missing links |
| `scripts/test-linking-v2.ts` | Test vector search and similarity |
| `DEBUG_LINKING.md` | This report |

## Resolution

### Backfill Executed Successfully ✅

```
=== Memory Link Backfill Results ===
Mode: LIVE
Memories processed: 220
Links created: 76
Links skipped (existing): 78
Errors: 0
Duration: 1.48s

Total links in database: 77 (was 1)
```

### Sample Links Created

| Score | Source | Target |
|-------|--------|--------|
| 0.755 | User is working on the UltraEdge project... | User is working on the UltraEdge project, which... |
| 0.711 | User is working on the UltraEdge project... | User is working on a project called UltraEdge... |
| 0.685 | User is working on the UltraEdge project... | User has revived a project named 'UltraEdge'... |
| 0.730 | User noted a double header bug... | User is working on the UltraEdge project... |

## Conclusion

**The linking code is working correctly.** The issue was that existing memories weren't backfilled when the feature was deployed. 

**Status: RESOLVED** - The backfill script created 76 new links (77 total), connecting semantically similar memories.
