# Temporal Memory Context — Design Document

*P6-006 Research Exploration*
*Created: 2026-02-04*

## The Problem

Agents don't have a sense of time. Every session is "now." This creates three concrete failures:

### 1. Rotting Relative Times
Memory stored: *"Meeting tomorrow at 3 PM"* (stored on Feb 3)  
Recalled on Feb 10: Still says "tomorrow" — but the meeting was a week ago.

### 2. Temporal Query Blindness
User asks: *"What did we discuss yesterday?"*  
Current system: Runs vector similarity search on the word "yesterday" — returns random results about discussions, not temporally filtered ones.

### 3. No Recency Awareness in Recall
User asks: *"What's my current project?"*  
System returns: A mix of current and 6-month-old project memories, weighted only by similarity.

## The Solution

Add temporal awareness at three layers:

### Layer 1: Temporal Annotations on Storage

When storing a memory, resolve relative times to absolute timestamps:

```typescript
// Input: "Meeting tomorrow at 3 PM" (stored 2026-02-04T21:00:00-08:00)
// Stored: 
{
  raw: "Meeting tomorrow at 3 PM",
  extraction: {
    when: "2026-02-05T15:00:00-08:00",  // Resolved absolute time
    whenConfidence: 0.9,
  },
  temporalContext: {
    storedAt: "2026-02-04T21:00:00-08:00",
    timezone: "America/Vancouver",
    relativeTimeResolved: true,          // Flag: we resolved relative → absolute
    originalTimeExpression: "tomorrow at 3 PM",
  }
}
```

**Key insight:** We already extract `when` via LLM. We just need to ensure the LLM resolves relative times given the current timestamp, and store the original expression for audit.

### Layer 2: Temporal Query Parsing

Parse temporal expressions in recall queries and convert to time filters:

```typescript
// "What did we discuss yesterday?" at 2026-02-05T10:00:00
// Parsed:
{
  query: "What did we discuss yesterday?",
  temporalFilter: {
    start: "2026-02-04T00:00:00-08:00",
    end: "2026-02-04T23:59:59-08:00",
  },
  semanticQuery: "What did we discuss",  // Stripped temporal part for embedding
}

// "What happened last week?"
{
  temporalFilter: {
    start: "2026-01-27T00:00:00-08:00",
    end: "2026-02-02T23:59:59-08:00",
  },
  semanticQuery: "What happened",
}
```

### Layer 3: Temporal Weighting in Retrieval

Blend temporal relevance with semantic similarity:

```
finalScore = (semanticSimilarity × α) + (temporalRelevance × β) + (effectiveScore × γ)
```

Where:
- `α = 0.5` (semantic weight — still primary)
- `β = 0.3` (temporal weight — when query has temporal intent)
- `γ = 0.2` (importance weight — effectiveScore)

`temporalRelevance` calculation:
- **Exact match**: Memory's `when` falls within temporal filter → 1.0
- **Close**: Within 1 day of filter → 0.7
- **Nearby**: Within 1 week → 0.3
- **Distant**: Beyond 1 week → 0.0
- **No temporal filter in query**: All memories get 0.5 (neutral)

## Implementation Plan

### Phase A: Temporal Query Parser (MVP)

A service that extracts temporal intent from queries.

```typescript
// src/memory/temporal/temporal-parser.service.ts

export interface TemporalFilter {
  start: Date;
  end: Date;
  expression: string;     // Original temporal phrase
  confidence: number;     // How sure we are about the time range
}

export interface ParsedQuery {
  semanticQuery: string;  // Query with temporal parts stripped
  temporalFilter: TemporalFilter | null;
}

@Injectable()
export class TemporalParserService {
  
  /**
   * Parse temporal expressions from a query
   * Uses pattern matching for common expressions,
   * falls back to LLM for complex ones.
   */
  parse(query: string, now: Date, timezone: string): ParsedQuery {
    // Try fast pattern matching first
    const patternResult = this.patternMatch(query, now, timezone);
    if (patternResult) return patternResult;
    
    // No temporal intent detected
    return { semanticQuery: query, temporalFilter: null };
  }

  private patternMatch(query: string, now: Date, tz: string): ParsedQuery | null {
    const patterns: Array<{
      regex: RegExp;
      resolve: (match: RegExpMatchArray, now: Date) => TemporalFilter;
    }> = [
      {
        regex: /\b(today|this morning|this afternoon|this evening|tonight)\b/i,
        resolve: (_, now) => this.dayRange(now, 0, 'today'),
      },
      {
        regex: /\byesterday\b/i,
        resolve: (_, now) => this.dayRange(now, -1, 'yesterday'),
      },
      {
        regex: /\b(last|past)\s+(week)\b/i,
        resolve: (_, now) => this.weekRange(now, -1, 'last week'),
      },
      {
        regex: /\b(this)\s+(week)\b/i,
        resolve: (_, now) => this.weekRange(now, 0, 'this week'),
      },
      {
        regex: /\b(last|past)\s+(\d+)\s+(day|days)\b/i,
        resolve: (m, now) => this.dayRange(now, -parseInt(m[2]), `last ${m[2]} days`),
      },
      {
        regex: /\b(last|past)\s+(month)\b/i,
        resolve: (_, now) => this.monthRange(now, -1, 'last month'),
      },
      {
        regex: /\b(\d+)\s+(hour|hours)\s+ago\b/i,
        resolve: (m, now) => this.hoursAgo(now, parseInt(m[1]), `${m[1]} hours ago`),
      },
    ];

    for (const { regex, resolve } of patterns) {
      const match = query.match(regex);
      if (match) {
        const filter = resolve(match, now);
        const semanticQuery = query.replace(regex, '').replace(/\s+/g, ' ').trim();
        return { semanticQuery: semanticQuery || query, temporalFilter: filter };
      }
    }

    return null;
  }

  // Helper methods for date range construction
  private dayRange(now: Date, offsetDays: number, expr: string): TemporalFilter { ... }
  private weekRange(now: Date, offsetWeeks: number, expr: string): TemporalFilter { ... }
  private monthRange(now: Date, offsetMonths: number, expr: string): TemporalFilter { ... }
  private hoursAgo(now: Date, hours: number, expr: string): TemporalFilter { ... }
}
```

### Phase B: Temporal-Aware Recall

Integrate temporal parsing into the recall pipeline:

```typescript
// In memory.service.ts recall()

async recall(userId: string, query: string, options?: RecallOptions): Promise<Memory[]> {
  // 1. Parse temporal intent
  const now = options?.now || new Date();
  const tz = options?.timezone || 'UTC';
  const parsed = this.temporalParser.parse(query, now, tz);
  
  // 2. Vector search using semantic query (temporal parts stripped)
  const vectorResults = await this.vectorSearch(parsed.semanticQuery, userId);
  
  // 3. If temporal filter exists, apply it
  if (parsed.temporalFilter) {
    // Add time-based WHERE clause
    const timeFiltered = await this.prisma.memory.findMany({
      where: {
        id: { in: vectorResults.map(r => r.id) },
        createdAt: {
          gte: parsed.temporalFilter.start,
          lte: parsed.temporalFilter.end,
        },
      },
    });
    
    // Re-score with temporal weighting
    return this.blendScores(vectorResults, timeFiltered, parsed.temporalFilter);
  }
  
  return vectorResults;
}
```

### Phase C: Temporal Annotations on Storage

When storing, resolve relative times in the extraction:

```typescript
// Update extraction prompt context
const TEMPORAL_CONTEXT = (now: Date, tz: string) => `
Current date and time: ${now.toISOString()} (${tz})
When extracting the "when" field:
- Resolve relative expressions ("tomorrow", "next week", "yesterday") to absolute ISO dates
- Store the resolved absolute date, not the relative expression
- Use the current date/time above as reference
`;
```

### Phase D: Rotted Time Detection (Maintenance)

Periodic job to find memories with stale relative time expressions:

```typescript
// Find memories where:
// 1. when field contains relative language ("tomorrow", "next week")
// 2. Memory is older than 24 hours
// These are "rotted" — the relative time no longer makes sense

async detectRottedTimes(userId: string): Promise<Memory[]> {
  const relativePatterns = ['tomorrow', 'next week', 'later today', 'tonight', 'this afternoon'];
  
  const candidates = await this.prisma.memory.findMany({
    where: {
      userId,
      deletedAt: null,
      createdAt: { lt: new Date(Date.now() - 24 * 60 * 60 * 1000) }, // Older than 24h
      extraction: {
        OR: relativePatterns.map(p => ({ 
          rawJson: { path: ['originalTimeExpression'], string_contains: p }
        })),
      },
    },
  });
  
  return candidates;
}
```

## What This Enables

1. **"What did we talk about yesterday?"** → Correctly filters to yesterday's memories
2. **"Remind me about last week's decisions"** → Returns decisions from last week
3. **No more rotted times** → "Meeting tomorrow" gets resolved to an absolute date at storage time
4. **Temporal scoring** → Recent memories naturally rank higher for temporal queries
5. **Time-aware context building** → When building agent context, recent memories weighted higher

## What We're NOT Doing (Yet)

- **Calendar integration** — That's a separate system
- **Timezone conversion in queries** — MVP assumes single timezone
- **Natural language date ranges** — "Between January and March" (future)
- **Temporal reasoning** — "What happened before X?" (future, needs causal graphs)

## Dependencies

- None (pure additive)
- Uses existing extraction pipeline
- Uses existing vector search

## Estimated Effort

| Phase | Effort | Value |
|-------|--------|-------|
| A: Temporal Parser | 3h | High — enables temporal queries |
| B: Temporal Recall | 2h | High — actually uses the parser |
| C: Storage Annotations | 2h | Medium — prevents future rot |
| D: Rot Detection | 1h | Low — maintenance job |
| **Total** | **8h** | |

## Decision

Start with Phase A + B (5 hours). This gives us temporal query parsing and temporal-aware recall — the highest-value pieces. Storage annotations (C) and rot detection (D) can follow.
