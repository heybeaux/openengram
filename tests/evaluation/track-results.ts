/**
 * Engram Memory System - Longitudinal Result Tracking
 *
 * Loads recall test results over time and generates trend summaries.
 *
 * Usage: npx ts-node tests/evaluation/track-results.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import { RecallRunResult } from './recall-test';

const RESULTS_DIR = path.join(__dirname, 'results');

interface TrendEntry {
  date: string;
  recallPercent: number;
  passed: number;
  total: number;
}

interface TrendSummary {
  runs: TrendEntry[];
  latestRecall: number;
  bestRecall: number;
  worstRecall: number;
  trend: 'improving' | 'declining' | 'stable' | 'insufficient_data';
  regressions: Array<{ from: string; to: string; delta: number }>;
}

function loadRecallResults(): RecallRunResult[] {
  if (!fs.existsSync(RESULTS_DIR)) return [];

  const files = fs.readdirSync(RESULTS_DIR)
    .filter((f) => f.startsWith('recall-') && f.endsWith('.json'))
    .sort();

  return files.map((f) => {
    const raw = fs.readFileSync(path.join(RESULTS_DIR, f), 'utf-8');
    return JSON.parse(raw) as RecallRunResult;
  });
}

function generateTrend(results: RecallRunResult[]): TrendSummary {
  const runs: TrendEntry[] = results.map((r) => ({
    date: r.timestamp.split('T')[0],
    recallPercent: r.recallPercent,
    passed: r.passed,
    total: r.totalScenarios,
  }));

  if (runs.length === 0) {
    return {
      runs: [],
      latestRecall: 0,
      bestRecall: 0,
      worstRecall: 0,
      trend: 'insufficient_data',
      regressions: [],
    };
  }

  const percents = runs.map((r) => r.recallPercent);
  const latestRecall = percents[percents.length - 1];
  const bestRecall = Math.max(...percents);
  const worstRecall = Math.min(...percents);

  // Detect regressions (any drop > 5%)
  const regressions: Array<{ from: string; to: string; delta: number }> = [];
  for (let i = 1; i < runs.length; i++) {
    const delta = runs[i].recallPercent - runs[i - 1].recallPercent;
    if (delta < -5) {
      regressions.push({
        from: runs[i - 1].date,
        to: runs[i].date,
        delta: Math.round(delta * 10) / 10,
      });
    }
  }

  // Overall trend
  let trend: TrendSummary['trend'] = 'insufficient_data';
  if (runs.length >= 2) {
    const first = percents[0];
    const last = percents[percents.length - 1];
    if (last - first > 5) trend = 'improving';
    else if (first - last > 5) trend = 'declining';
    else trend = 'stable';
  }

  return { runs, latestRecall, bestRecall, worstRecall, trend, regressions };
}

function printTrend(summary: TrendSummary) {
  console.log('📈 Engram Recall Trend Summary\n');

  if (summary.runs.length === 0) {
    console.log('  No recall results found. Run recall-test.ts first.');
    return;
  }

  console.log('  Date       | Recall | Pass/Total');
  console.log('  -----------|--------|----------');
  for (const run of summary.runs) {
    console.log(`  ${run.date} | ${run.recallPercent.toFixed(1).padStart(5)}% | ${run.passed}/${run.total}`);
  }

  console.log(`\n  Latest: ${summary.latestRecall.toFixed(1)}%`);
  console.log(`  Best:   ${summary.bestRecall.toFixed(1)}%`);
  console.log(`  Worst:  ${summary.worstRecall.toFixed(1)}%`);
  console.log(`  Trend:  ${summary.trend}`);

  if (summary.regressions.length > 0) {
    console.log('\n  ⚠️  Regressions detected:');
    for (const reg of summary.regressions) {
      console.log(`    ${reg.from} → ${reg.to}: ${reg.delta}%`);
    }
  }
}

async function main() {
  const results = loadRecallResults();
  const summary = generateTrend(results);
  printTrend(summary);

  // Save trend summary
  const summaryPath = path.join(RESULTS_DIR, 'trend-summary.json');
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
  console.log(`\n💾 Trend saved to: ${summaryPath}`);
}

export { generateTrend, TrendSummary };

if (require.main === module) {
  main().catch((err) => {
    console.error('❌ Trend tracking failed:', err);
    process.exit(1);
  });
}
