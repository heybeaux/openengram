# Engram Evaluation Test Harness

A scientific test regime for measuring memory quality and recall performance.

## Quick Start

```bash
# Navigate to engram directory
cd ~/projects/agent-memory/engram

# Run baseline capture
npx ts-node tests/evaluation/baseline.ts

# Run scenario tests
npx ts-node tests/evaluation/scenarios.ts

# Compare two baselines (after making improvements)
npx ts-node tests/evaluation/compare.ts baseline-before.json baseline-after.json
```

## Files

| File | Purpose |
|------|---------|
| `baseline.ts` | Captures current state metrics and saves to JSON |
| `scenarios.ts` | Runs 12+ test scenarios and reports pass/fail |
| `scorer.ts` | Scoring functions for memory quality evaluation |
| `compare.ts` | Generates before/after comparison reports |
| `results/` | Directory for saved evaluation results |

## Metrics Captured

### Core Counts
- Total memories
- Total extractions
- Extractions with 5W1H data
- Total entities
- Total memory chain links

### Quality Scores
- **5W1H Completion Rate**: % of extraction fields populated
- **Avg Entities/Memory**: Entity extraction density
- **Avg Links/Memory**: Memory interconnection density

### 5W1H Breakdown
Individual completion rates for:
- WHO (people/actors)
- WHAT (core fact/action)
- WHEN (temporal context)
- WHERE (location/context)
- WHY (reasoning/motivation)
- HOW (method/process)

### Sample Analysis
Random sample of 20 memories scored for:
- 5W1H score (0-6 points)
- Entity extraction quality (F1 score)
- Link density

## Test Scenarios

### Entity Queries
1. Find memories about known entities
2. Entity type distribution (person, org, etc)

### Temporal Queries
3. Extractions have "when" field
4. Memory creation dates are valid

### Semantic Search
5. Memories have embeddings stored
6. Embedding model is recorded

### Extraction Quality
7. "What" field populated (should be ~100%)
8. Topics extracted

### Deduplication
9. Superseded memories tracked
10. UPDATES links exist

### Link Quality
11. Memory chain links exist
12. Link type diversity

## Workflow

### Before Making Changes

```bash
# Capture baseline
npx ts-node tests/evaluation/baseline.ts "pre-improvement"

# Note the output file path
```

### After Making Changes

```bash
# Capture new state
npx ts-node tests/evaluation/baseline.ts "post-improvement"

# Compare results
npx ts-node tests/evaluation/compare.ts \
  baseline-2024-01-01T00-00-00-000Z.json \
  baseline-2024-01-02T00-00-00-000Z.json

# Or auto-detect latest two files
npx ts-node tests/evaluation/compare.ts
```

### Continuous Monitoring

```bash
# Run scenarios as part of CI/CD
npx ts-node tests/evaluation/scenarios.ts

# Exit code 1 if any scenarios fail
```

## Output Format

### Baseline Results (`baseline-*.json`)

```json
{
  "timestamp": "2024-01-01T12:00:00.000Z",
  "runLabel": "pre-improvement",
  "metrics": {
    "totalMemories": 224,
    "extractionsWithData": 1,
    "fiveW1HCompletionRate": 0.004,
    "avgEntitiesPerMemory": 0,
    "avgLinksPerMemory": 0.004,
    "fiveW1HBreakdown": {
      "who": 0.004,
      "what": 0.004,
      "when": 0.0,
      "where": 0.0,
      "why": 0.0,
      "how": 0.0
    },
    "sampleScores": [...]
  }
}
```

### Scenario Results (`scenarios-*.json`)

```json
{
  "timestamp": "2024-01-01T12:00:00.000Z",
  "totalScenarios": 12,
  "passed": 8,
  "failed": 4,
  "passRate": 0.667,
  "overallScorePercent": 72.5,
  "scenarios": [
    {
      "name": "Entity Query: Find memories about known entities",
      "passed": true,
      "score": 1,
      "maxScore": 1,
      "details": "Entity \"Beaux\" (person) has 5 linked memories"
    }
  ]
}
```

### Comparison Report (`comparison-*.md`)

Markdown report showing:
- Before/after metrics table
- Change percentages with ✅/❌ indicators
- Big wins highlighted
- Regressions flagged

## Interpreting Results

### Healthy System Targets

| Metric | Target | Critical |
|--------|--------|----------|
| 5W1H Completion Rate | > 50% | < 10% |
| Avg Entities/Memory | > 0.5 | < 0.1 |
| Avg Links/Memory | > 0.2 | < 0.05 |
| WHAT field populated | > 90% | < 50% |
| Embeddings present | > 80% | < 50% |

### Red Flags

- 🚨 `extractionsWithData` much lower than `totalExtractions`
- 🚨 Zero entities despite names in raw text
- 🚨 No memory chain links at all
- 🚨 Missing embedding models

## Extending

### Adding New Scenarios

Edit `scenarios.ts` and add to the `scenarios` array:

```typescript
{
  name: 'My New Scenario',
  category: 'entity_query',
  description: 'What this tests',
  run: async (): Promise<ScenarioResult> => {
    // Your test logic here
    return {
      name: 'My New Scenario',
      passed: true,
      score: 1,
      maxScore: 1,
      details: 'Details about the result',
    };
  },
}
```

### Custom Scoring

Import from `scorer.ts`:

```typescript
import { score5W1H, scoreEntityExtraction, cosineSimilarity } from './scorer';
```
