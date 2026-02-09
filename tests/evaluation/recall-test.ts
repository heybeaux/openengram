/**
 * Engram Memory System - Semantic Recall Test Runner
 *
 * Queries the Engram search API for each recall scenario and checks
 * if the expected content appears in the results.
 *
 * Usage: ENGRAM_URL=http://localhost:3001 npx ts-node tests/evaluation/recall-test.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import { recallScenarios, RecallScenario } from './recall-scenarios';

const ENGRAM_URL = process.env.ENGRAM_URL || 'http://localhost:3001';
const USER_ID = process.env.ENGRAM_USER_ID || 'beaux';

interface RecallResult {
  scenario: string;
  query: string;
  passed: boolean;
  matchedContent: string[];
  missedContent: string[];
  topResultPreview?: string;
  duration: number;
}

interface RecallRunResult {
  timestamp: string;
  engramUrl: string;
  userId: string;
  totalScenarios: number;
  passed: number;
  failed: number;
  recallPercent: number;
  results: RecallResult[];
}

async function queryEngram(query: string): Promise<any[]> {
  const res = await fetch(`${ENGRAM_URL}/v1/memories/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId: USER_ID, query, limit: 10 }),
  });

  if (!res.ok) {
    throw new Error(`Engram query failed: ${res.status} ${res.statusText}`);
  }

  const data = await res.json();
  // Handle both { memories: [...] } and direct array responses
  return Array.isArray(data) ? data : data.memories || data.results || [];
}

function checkContent(memories: any[], expectedContent: string[]): { matched: string[]; missed: string[] } {
  const matched: string[] = [];
  const missed: string[] = [];

  for (const expected of expectedContent) {
    const found = memories.some((m) => {
      const text = (m.content || m.raw || m.text || JSON.stringify(m)).toLowerCase();
      return text.includes(expected.toLowerCase());
    });
    if (found) {
      matched.push(expected);
    } else {
      missed.push(expected);
    }
  }

  return { matched, missed };
}

async function runRecallTest(scenario: RecallScenario): Promise<RecallResult> {
  const start = Date.now();

  try {
    const memories = await queryEngram(scenario.query);
    const { matched, missed } = checkContent(memories, scenario.expectedContent);
    const passed = missed.length === 0;

    return {
      scenario: scenario.description,
      query: scenario.query,
      passed,
      matchedContent: matched,
      missedContent: missed,
      topResultPreview: memories[0]
        ? (memories[0].content || memories[0].raw || '').substring(0, 120)
        : '(no results)',
      duration: Date.now() - start,
    };
  } catch (error) {
    return {
      scenario: scenario.description,
      query: scenario.query,
      passed: false,
      matchedContent: [],
      missedContent: scenario.expectedContent,
      topResultPreview: `ERROR: ${error instanceof Error ? error.message : String(error)}`,
      duration: Date.now() - start,
    };
  }
}

async function main() {
  console.log(`🧠 Engram Semantic Recall Test`);
  console.log(`   Server: ${ENGRAM_URL}`);
  console.log(`   User:   ${USER_ID}`);
  console.log(`   Scenarios: ${recallScenarios.length}\n`);

  const results: RecallResult[] = [];

  for (const scenario of recallScenarios) {
    const result = await runRecallTest(scenario);
    results.push(result);

    const icon = result.passed ? '✓' : '✗';
    console.log(`  ${icon} ${result.scenario}`);
    if (!result.passed) {
      console.log(`    Query: "${result.query}"`);
      console.log(`    Missing: ${result.missedContent.join(', ')}`);
      console.log(`    Top result: ${result.topResultPreview}`);
    }
  }

  const passed = results.filter((r) => r.passed).length;
  const recallPercent = (passed / results.length) * 100;

  const runResult: RecallRunResult = {
    timestamp: new Date().toISOString(),
    engramUrl: ENGRAM_URL,
    userId: USER_ID,
    totalScenarios: results.length,
    passed,
    failed: results.length - passed,
    recallPercent,
    results,
  };

  console.log(`\n📊 Recall Accuracy: ${passed}/${results.length} (${recallPercent.toFixed(1)}%)`);

  // Save results
  const resultsDir = path.join(__dirname, 'results');
  if (!fs.existsSync(resultsDir)) {
    fs.mkdirSync(resultsDir, { recursive: true });
  }

  const dateStr = new Date().toISOString().split('T')[0];
  const filepath = path.join(resultsDir, `recall-${dateStr}.json`);
  fs.writeFileSync(filepath, JSON.stringify(runResult, null, 2));
  console.log(`💾 Results saved to: ${filepath}`);

  return runResult;
}

export { main as runRecallTest, RecallRunResult, RecallResult };

if (require.main === module) {
  main().catch((err) => {
    console.error('❌ Recall test failed:', err);
    process.exit(1);
  });
}
