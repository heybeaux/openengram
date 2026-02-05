# 5W1H Extraction Debug Report

**Date:** 2026-02-02  
**Issue:** 220/221 memory extractions had null 5W1H values  
**Status:** ✅ FIXED

## Problem Summary

The LLM extraction was working correctly, but the extracted data was being silently lost due to a **case sensitivity mismatch** between the LLM response and the code expectations.

## Root Cause

### The Bug

The extraction prompt used uppercase field descriptors:
```
- WHO: People, organizations...
- WHAT: The core fact...
- WHEN: Any temporal context...
```

The LLM (GPT-4o-mini) responded with uppercase JSON keys:
```json
{
  "WHO": "Beaux",
  "WHAT": "Beaux prefers tabs over spaces."
}
```

But the TypeScript interface expected lowercase keys:
```typescript
interface ExtractionResponse {
  who: string | null;  // lowercase!
  what: string | null;
  ...
}
```

When accessing `result.who`, JavaScript returned `undefined` (because the actual key was `WHO`), which was then coerced to `null`:
```typescript
who: result.who || null,  // result.WHO exists, result.who is undefined → null
```

### Why It Wasn't Caught

1. The fallback `basicExtraction()` was silently used
2. No error was thrown - just incorrect null values
3. The error logging only caught exceptions, not data issues

## The Fix

### 1. Updated the prompt to explicitly request lowercase keys

```typescript
Extract these fields (use these EXACT lowercase JSON keys):
- "who": People, organizations...
- "what": The core fact...
```

### 2. Added defensive key normalization

```typescript
private normalizeResponseKeys(raw: Record<string, unknown>): ExtractionResponse {
  const normalized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    normalized[key.toLowerCase()] = value;
  }
  return normalized as unknown as ExtractionResponse;
}
```

### 3. Improved error logging

```typescript
console.error('[ExtractionService] LLM extraction failed:', {
  error: error instanceof Error ? error.message : String(error),
  rawPreview: raw.substring(0, 100),
  userName: context?.userName,
});
```

## Verification

After the fix, extraction returns proper lowercase keys:
```json
{
  "who": "Beaux",
  "what": "Beaux prefers tabs over spaces.",
  "when": null,
  "where": null,
  "why": null,
  "how": null,
  "topics": ["preferences"],
  "entities": []
}
```

## Files Modified

- `src/memory/extraction.service.ts`

## Recommendations

1. **Re-extract existing memories** - Run a migration script to re-extract 5W1H data for all 221 existing memories
2. **Add unit tests** - Test the extraction with various LLM response formats
3. **Consider schema validation** - Use Zod or similar to validate LLM responses before processing

## Migration Script (Optional)

To re-extract existing memories:

```typescript
// Re-run extraction for all memories with null extractions
const memories = await prisma.memory.findMany({
  where: {
    extraction: {
      who: null,
      what: null,
    }
  },
  include: { user: true }
});

for (const memory of memories) {
  const result = await extractionService.extract(memory.raw, {
    userName: memory.user?.name
  });
  
  await prisma.memoryExtraction.update({
    where: { memoryId: memory.id },
    data: {
      who: result.who,
      what: result.what,
      when: result.when,
      whereCtx: result.where,
      why: result.why,
      how: result.how,
      topics: result.topics,
      model: 'gpt-4o-mini'
    }
  });
}
```
