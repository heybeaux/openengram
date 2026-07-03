/**
 * Engram Memory System - Before/After Comparison
 * 
 * Compares two evaluation result files and generates a report.
 * Run with: npx ts-node tests/evaluation/compare.ts <before.json> <after.json>
 */

import * as fs from 'fs';
import * as path from 'path';

interface BaselineMetrics {
  totalMemories: number;
  totalExtractions: number;
  extractionsWithData: number;
  totalEntities: number;
  totalLinks: number;
  fiveW1HCompletionRate: number;
  avgEntitiesPerMemory: number;
  avgLinksPerMemory: number;
  fiveW1HBreakdown: {
    who: number;
    what: number;
    when: number;
    where: number;
    why: number;
    how: number;
  };
  sampleSize: number;
  sampleScores: Array<{
    memoryId: string;
    fiveW1HScore: number;
    entityScore: number;
    hasExtraction: boolean;
  }>;
}

interface BaselineResult {
  timestamp: string;
  runLabel: string;
  metrics: BaselineMetrics;
}

interface ComparisonResult {
  timestamp: string;
  before: {
    file: string;
    timestamp: string;
    label: string;
  };
  after: {
    file: string;
    timestamp: string;
    label: string;
  };
  changes: {
    metric: string;
    before: number;
    after: number;
    change: number;
    changePercent: number;
    improved: boolean;
    significant: boolean;
  }[];
  summary: {
    totalImproved: number;
    totalRegressed: number;
    totalUnchanged: number;
    overallVerdict: 'improved' | 'regressed' | 'mixed' | 'unchanged';
  };
  markdown: string;
}

function formatPercent(value: number): string {
  return (value * 100).toFixed(1) + '%';
}

function formatChange(change: number, isPercent: boolean = false): string {
  const prefix = change > 0 ? '+' : '';
  if (isPercent) {
    return prefix + (change * 100).toFixed(1) + '%';
  }
  return prefix + change.toFixed(2);
}

function getChangeEmoji(improved: boolean, significant: boolean): string {
  if (!significant) return '➖';
  return improved ? '✅' : '❌';
}

function compare(beforeFile: string, afterFile: string): ComparisonResult {
  // Load files
  const beforePath = path.isAbsolute(beforeFile) 
    ? beforeFile 
    : path.join(__dirname, 'results', beforeFile);
  const afterPath = path.isAbsolute(afterFile) 
    ? afterFile 
    : path.join(__dirname, 'results', afterFile);
  
  if (!fs.existsSync(beforePath)) {
    throw new Error(`Before file not found: ${beforePath}`);
  }
  if (!fs.existsSync(afterPath)) {
    throw new Error(`After file not found: ${afterPath}`);
  }
  
  const before: BaselineResult = JSON.parse(fs.readFileSync(beforePath, 'utf-8'));
  const after: BaselineResult = JSON.parse(fs.readFileSync(afterPath, 'utf-8'));
  
  // Compare metrics
  const changes: ComparisonResult['changes'] = [];
  
  // Helper to add metric comparison
  const addMetric = (
    name: string, 
    beforeVal: number, 
    afterVal: number, 
    higherIsBetter: boolean = true,
    threshold: number = 0.05, // 5% change is significant
  ) => {
    const change = afterVal - beforeVal;
    const changePercent = beforeVal !== 0 ? change / beforeVal : (afterVal !== 0 ? Infinity : 0);
    const improved = higherIsBetter ? change > 0 : change < 0;
    const significant = Math.abs(changePercent) >= threshold || 
      (beforeVal === 0 && afterVal !== 0) ||
      (beforeVal !== 0 && afterVal === 0);
    
    changes.push({
      metric: name,
      before: beforeVal,
      after: afterVal,
      change,
      changePercent,
      improved: improved && significant,
      significant,
    });
  };
  
  // Core metrics
  addMetric('Total Memories', before.metrics.totalMemories, after.metrics.totalMemories);
  addMetric('Total Extractions', before.metrics.totalExtractions, after.metrics.totalExtractions);
  addMetric('Extractions With Data', before.metrics.extractionsWithData, after.metrics.extractionsWithData);
  addMetric('Total Entities', before.metrics.totalEntities, after.metrics.totalEntities);
  addMetric('Total Links', before.metrics.totalLinks, after.metrics.totalLinks);
  
  // Quality scores
  addMetric('5W1H Completion Rate', before.metrics.fiveW1HCompletionRate, after.metrics.fiveW1HCompletionRate);
  addMetric('Avg Entities/Memory', before.metrics.avgEntitiesPerMemory, after.metrics.avgEntitiesPerMemory);
  addMetric('Avg Links/Memory', before.metrics.avgLinksPerMemory, after.metrics.avgLinksPerMemory);
  
  // 5W1H breakdown
  addMetric('WHO completion', before.metrics.fiveW1HBreakdown.who, after.metrics.fiveW1HBreakdown.who);
  addMetric('WHAT completion', before.metrics.fiveW1HBreakdown.what, after.metrics.fiveW1HBreakdown.what);
  addMetric('WHEN completion', before.metrics.fiveW1HBreakdown.when, after.metrics.fiveW1HBreakdown.when);
  addMetric('WHERE completion', before.metrics.fiveW1HBreakdown.where, after.metrics.fiveW1HBreakdown.where);
  addMetric('WHY completion', before.metrics.fiveW1HBreakdown.why, after.metrics.fiveW1HBreakdown.why);
  addMetric('HOW completion', before.metrics.fiveW1HBreakdown.how, after.metrics.fiveW1HBreakdown.how);
  
  // Sample scores (average)
  const beforeAvg5W1H = before.metrics.sampleScores.length > 0
    ? before.metrics.sampleScores.reduce((s, x) => s + x.fiveW1HScore, 0) / before.metrics.sampleScores.length
    : 0;
  const afterAvg5W1H = after.metrics.sampleScores.length > 0
    ? after.metrics.sampleScores.reduce((s, x) => s + x.fiveW1HScore, 0) / after.metrics.sampleScores.length
    : 0;
  addMetric('Sample Avg 5W1H Score', beforeAvg5W1H, afterAvg5W1H);
  
  // Summary
  const improved = changes.filter(c => c.improved && c.significant).length;
  const regressed = changes.filter(c => !c.improved && c.significant).length;
  const unchanged = changes.filter(c => !c.significant).length;
  
  let verdict: ComparisonResult['summary']['overallVerdict'];
  if (improved > regressed * 2) {
    verdict = 'improved';
  } else if (regressed > improved * 2) {
    verdict = 'regressed';
  } else if (improved === 0 && regressed === 0) {
    verdict = 'unchanged';
  } else {
    verdict = 'mixed';
  }
  
  // Generate markdown report
  const markdown = generateMarkdownReport(before, after, changes, {
    totalImproved: improved,
    totalRegressed: regressed,
    totalUnchanged: unchanged,
    overallVerdict: verdict,
  });
  
  return {
    timestamp: new Date().toISOString(),
    before: {
      file: beforeFile,
      timestamp: before.timestamp,
      label: before.runLabel,
    },
    after: {
      file: afterFile,
      timestamp: after.timestamp,
      label: after.runLabel,
    },
    changes,
    summary: {
      totalImproved: improved,
      totalRegressed: regressed,
      totalUnchanged: unchanged,
      overallVerdict: verdict,
    },
    markdown,
  };
}

function generateMarkdownReport(
  before: BaselineResult,
  after: BaselineResult,
  changes: ComparisonResult['changes'],
  summary: ComparisonResult['summary'],
): string {
  const verdictEmoji = {
    improved: '🎉',
    regressed: '⚠️',
    mixed: '🔄',
    unchanged: '➖',
  };
  
  let md = `# Engram Evaluation Comparison Report

**Generated:** ${new Date().toISOString()}

## Overview

| | Before | After |
|---|---|---|
| **Run Label** | ${before.runLabel} | ${after.runLabel} |
| **Timestamp** | ${before.timestamp} | ${after.timestamp} |

### Verdict: ${verdictEmoji[summary.overallVerdict]} ${summary.overallVerdict.toUpperCase()}

- ✅ Improved: ${summary.totalImproved} metrics
- ❌ Regressed: ${summary.totalRegressed} metrics
- ➖ Unchanged: ${summary.totalUnchanged} metrics

## Detailed Comparison

| Metric | Before | After | Change | Status |
|--------|--------|-------|--------|--------|
`;
  
  for (const c of changes) {
    const emoji = getChangeEmoji(c.improved, c.significant);
    const beforeStr = c.metric.includes('completion') || c.metric.includes('Rate')
      ? formatPercent(c.before)
      : c.before.toFixed(2);
    const afterStr = c.metric.includes('completion') || c.metric.includes('Rate')
      ? formatPercent(c.after)
      : c.after.toFixed(2);
    const changeStr = c.metric.includes('completion') || c.metric.includes('Rate')
      ? formatChange(c.change, true)
      : formatChange(c.change);
    
    md += `| ${c.metric} | ${beforeStr} | ${afterStr} | ${changeStr} | ${emoji} |\n`;
  }
  
  md += `
## Key Insights

`;

  // Highlight significant improvements
  const bigWins = changes.filter(c => c.improved && c.significant && Math.abs(c.changePercent) > 0.2);
  if (bigWins.length > 0) {
    md += `### 🎯 Big Wins\n\n`;
    for (const win of bigWins) {
      md += `- **${win.metric}**: ${formatChange(win.changePercent, true)} improvement\n`;
    }
    md += '\n';
  }
  
  // Highlight regressions
  const regressions = changes.filter(c => !c.improved && c.significant);
  if (regressions.length > 0) {
    md += `### ⚠️ Regressions to Address\n\n`;
    for (const reg of regressions) {
      md += `- **${reg.metric}**: ${formatChange(reg.changePercent, true)}\n`;
    }
    md += '\n';
  }
  
  md += `---
*Report generated by Engram Evaluation System*
`;
  
  return md;
}

async function main() {
  const args = process.argv.slice(2);
  
  if (args.length < 2) {
    // If no args, find latest two baseline files
    const resultsDir = path.join(__dirname, 'results');
    if (!fs.existsSync(resultsDir)) {
      console.error('Usage: npx ts-node tests/evaluation/compare.ts <before.json> <after.json>');
      console.error('\nNo results directory found. Run baseline.ts first.');
      process.exit(1);
    }
    
    const files = fs.readdirSync(resultsDir)
      .filter(f => f.startsWith('baseline-') && f.endsWith('.json'))
      .sort()
      .reverse();
    
    if (files.length < 2) {
      console.error('Usage: npx ts-node tests/evaluation/compare.ts <before.json> <after.json>');
      console.error(`\nOnly ${files.length} baseline file(s) found. Need at least 2 for comparison.`);
      process.exit(1);
    }
    
    args[0] = files[1]; // Older = before
    args[1] = files[0]; // Newer = after
    console.log(`Auto-detected files:\n  Before: ${args[0]}\n  After:  ${args[1]}\n`);
  }
  
  try {
    const result = compare(args[0], args[1]);
    
    // Save JSON result
    const resultsDir = path.join(__dirname, 'results');
    const jsonPath = path.join(resultsDir, `comparison-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
    fs.writeFileSync(jsonPath, JSON.stringify(result, null, 2));
    
    // Save markdown report
    const mdPath = path.join(resultsDir, `comparison-${new Date().toISOString().replace(/[:.]/g, '-')}.md`);
    fs.writeFileSync(mdPath, result.markdown);
    
    // Print markdown to console
    console.log(result.markdown);
    
    console.log(`\n💾 Saved to:`);
    console.log(`  JSON: ${jsonPath}`);
    console.log(`  Markdown: ${mdPath}`);
    
  } catch (error) {
    console.error('❌ Comparison failed:', error);
    process.exit(1);
  }
}

// Export for use in other files
export { compare }; export type { ComparisonResult };

// Run if executed directly
if (require.main === module) {
  main();
}
