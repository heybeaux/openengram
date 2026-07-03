/**
 * Engram Memory System - Semantic Recall Test Scenarios
 *
 * 20+ query→expected memory pairs for evaluating recall accuracy.
 *
 * KNOWN FAILURES (from existing scenario run 2026-02-03):
 * The existing scenarios.ts has 12 structural tests, 6 of which fail:
 *   1. Temporal Query: extraction timestamps — only 2.6% have "when" (needs ≥10%)
 *   2. Semantic Search: Embedding model recorded — 0% have model field
 *   3. Extraction Quality: What field populated — 35.1% (needs ≥90%)
 *   4. Deduplication: Superseded memories tracked — 0 superseded
 *   5. Deduplication: UPDATES links exist — no UPDATES links
 *   6. Link Quality: Link type diversity — insufficient link types
 *
 * The v0.5 plan references "2 of 25 recall misses at 92%" — this likely refers
 * to a separate recall suite not yet in the codebase. These new recall scenarios
 * will establish the baseline for semantic recall testing going forward.
 */

export interface RecallScenario {
  query: string;
  expectedContent: string[];
  expectedType?: string;
  description: string;
}

export const recallScenarios: RecallScenario[] = [
  {
    query: "What's Beaux's wife's name?",
    expectedContent: ['Deanna'],
    description: "Should recall spouse name",
  },
  {
    query: 'deployment practices',
    expectedContent: ['never deploys on Fridays'],
    description: "Should recall Friday deploy rule",
  },
  {
    query: 'martial arts training',
    expectedContent: ['Wing Chun', 'Sifu Liu Ping'],
    description: "Should recall martial arts style and instructor",
  },
  {
    query: "Beaux's children",
    expectedContent: ['Stella', 'Odin'],
    description: "Should recall children's names",
  },
  {
    query: 'coffee preferences',
    expectedContent: ['drip', 'latte'],
    description: "Should recall coffee habits",
  },
  {
    query: 'chocolate preference',
    expectedContent: ['white'],
    description: "Should recall white over dark chocolate preference",
  },
  {
    query: 'military service',
    expectedContent: ['Australian Army', 'RAEME'],
    description: "Should recall military branch and corps",
  },
  {
    query: 'ADHD medication',
    expectedContent: ['Vyvanse'],
    description: "Should recall ADHD medication",
  },
  {
    query: 'thyroid medication',
    expectedContent: ['Synthroid'],
    description: "Should recall thyroid medication",
  },
  {
    query: 'WhaleHawk stack',
    expectedContent: ['NestJS', 'Prisma', 'PostgreSQL', 'Pinecone'],
    description: "Should recall WhaleHawk tech stack",
  },
  {
    query: 'Engram port',
    expectedContent: ['3001'],
    description: "Should recall Engram runs on port 3001",
  },
  {
    query: 'engram-embed port',
    expectedContent: ['8080'],
    description: "Should recall engram-embed runs on port 8080",
  },
  {
    query: 'UltraEdge stack',
    expectedContent: ['React Native', 'Expo', 'Supabase'],
    description: "Should recall UltraEdge tech stack",
  },
  {
    query: "Beaux's birthday",
    expectedContent: ['August 8', '1985'],
    description: "Should recall birthday date",
  },
  {
    query: "Beaux's location",
    expectedContent: ['Powell River'],
    description: "Should recall location",
  },
  {
    query: 'Generosity Catalyst co-founders',
    expectedContent: ['Trevan', 'Matt'],
    description: "Should recall GC co-founders",
  },
  {
    query: 'SOC 2 compliance target',
    expectedContent: ['February 2026'],
    description: "Should recall SOC 2 target date",
  },
  {
    query: 'TTS voice preference',
    expectedContent: ['en-GB-RyanNeural'],
    description: "Should recall preferred TTS voice",
  },
  {
    query: 'prisma migrate dev danger',
    expectedContent: ['resets', 'database'],
    description: "Should recall prisma migrate dev warning",
  },
  {
    query: "Beaux's dog",
    expectedContent: ['Kali', 'husky'],
    description: "Should recall dog name and breed",
  },
  {
    query: 'Wing Chun academy location',
    expectedContent: ['Yantai'],
    description: "Should recall martial arts academy city",
  },
  {
    query: "Beaux's skill acquisition philosophy",
    expectedContent: ['practice the basics'],
    description: "Should recall learning philosophy",
  },
];
