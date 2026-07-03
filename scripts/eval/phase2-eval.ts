#!/usr/bin/env npx ts-node
/**
 * Phase 2 exit-gate eval entrypoint (EC-29).
 *
 * Usage:
 *
 *   npx ts-node scripts/eval/phase2-eval.ts [--out=docs/eval/phase2-results.md] [--llm=mock|anthropic|openrouter]
 *
 * Behaviour:
 *
 *   - Materializes the committed eval fixtures to a temp dir on disk
 *     (round-tripping through the real `writeCard` writer so the harness
 *     exercises the same code path the indexing pipeline produces).
 *   - For each fixture repo, runs every eval question through the harness
 *     using the selected LLM adapter.
 *   - Scores each question against its ground-truth concept paths.
 *   - Writes a human-readable markdown report to `--out`.
 *   - Exits non-zero if any repo fails to meet the per-repo pass threshold
 *     (default: 4/5 correct).
 *
 * LLM selection:
 *
 *   - `--llm=mock` (default) — deterministic heuristic. No network calls.
 *     This is what CI runs.
 *   - `--llm=anthropic` — real Claude Sonnet via the Messages API.
 *     Requires `ANTHROPIC_API_KEY`. Used to generate the canonical
 *     committed `docs/eval/phase2-results.md`.
 *   - `--llm=openrouter` — Sonnet via OpenRouter. Requires
 *     `OPENROUTER_API_KEY`. Fallback when Anthropic is not available.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { EVAL_FIXTURES } from './fixtures';
import { runHarness } from './harness';
import {
  createAnthropicSonnetAdapter,
  createMockAdapter,
  createOpenRouterSonnetAdapter,
  type EvalLLMAdapter,
} from './llm-adapter';
import {
  scoreQuestion,
  summarizeRepo,
  type RepoScoreSummary,
  type ScoreReport,
} from './scorer';
import { materializeFixture } from './fixture-loader';

const DEFAULT_TOKEN_BUDGET = 8000;
const DEFAULT_PASS_THRESHOLD = 4; // out of 5 questions per repo
const DEFAULT_OUT = 'docs/eval/phase2-results.md';

interface CliArgs {
  out: string;
  llm: 'mock' | 'anthropic' | 'openrouter';
  tokenBudget: number;
  passThreshold: number;
}

function parseArgs(argv: string[]): CliArgs {
  let out = DEFAULT_OUT;
  let llm: CliArgs['llm'] = 'mock';
  let tokenBudget = DEFAULT_TOKEN_BUDGET;
  let passThreshold = DEFAULT_PASS_THRESHOLD;
  for (const arg of argv) {
    if (arg.startsWith('--out=')) out = arg.slice('--out='.length);
    else if (arg.startsWith('--llm=')) {
      const v = arg.slice('--llm='.length);
      if (v !== 'mock' && v !== 'anthropic' && v !== 'openrouter') {
        throw new Error(`--llm must be mock|anthropic|openrouter, got "${v}"`);
      }
      llm = v;
    } else if (arg.startsWith('--token-budget=')) {
      tokenBudget = parseInt(arg.slice('--token-budget='.length), 10);
      if (!Number.isInteger(tokenBudget) || tokenBudget < 100) {
        throw new Error(`--token-budget must be an integer >= 100`);
      }
    } else if (arg.startsWith('--pass-threshold=')) {
      passThreshold = parseInt(arg.slice('--pass-threshold='.length), 10);
      if (!Number.isInteger(passThreshold) || passThreshold < 1) {
        throw new Error(`--pass-threshold must be a positive integer`);
      }
    } else if (arg === '--help' || arg === '-h') {
      printUsage();
      process.exit(0);
    } else {
      throw new Error(`unknown argument "${arg}"`);
    }
  }
  return { out, llm, tokenBudget, passThreshold };
}

function printUsage(): void {
  process.stdout.write(
    [
      'phase2-eval — Phase 2 exit-gate eval harness (EC-29)',
      '',
      'Usage:',
      '  npx ts-node scripts/eval/phase2-eval.ts [options]',
      '',
      'Options:',
      `  --out=<file>             Output markdown report (default: ${DEFAULT_OUT})`,
      '  --llm=<mock|anthropic|openrouter>  LLM adapter (default: mock)',
      `  --token-budget=<n>       Per-question token cap (default: ${DEFAULT_TOKEN_BUDGET})`,
      `  --pass-threshold=<n>     Pass threshold per repo (default: ${DEFAULT_PASS_THRESHOLD}/5)`,
      '',
    ].join('\n') + '\n',
  );
}

function buildAdapter(
  kind: CliArgs['llm'],
  allCards: Map<string, import('../../src/v2/writers/markdown/types').Card>,
): EvalLLMAdapter {
  if (kind === 'mock') {
    return createMockAdapter(Array.from(allCards.values()));
  }
  if (kind === 'anthropic') {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY required for --llm=anthropic');
    return createAnthropicSonnetAdapter({ apiKey });
  }
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY required for --llm=openrouter');
  return createOpenRouterSonnetAdapter({ apiKey });
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  process.stdout.write(
    `phase2-eval: llm=${args.llm} token-budget=${args.tokenBudget} pass-threshold=${args.passThreshold}/5\n`,
  );

  const workdir = mkdtempSync(join(tmpdir(), 'phase2-eval-'));
  try {
    const summaries: RepoScoreSummary[] = [];
    for (const fixture of EVAL_FIXTURES) {
      process.stdout.write(`\n=== ${fixture.repoId}: ${fixture.description} ===\n`);
      const cardMap = await materializeFixture(fixture, workdir);
      const adapter = buildAdapter(args.llm, cardMap);
      const reports: ScoreReport[] = [];
      for (const question of fixture.questions) {
        process.stdout.write(`  - ${question.id}: `);
        const result = await runHarness({
          question: question.prompt,
          cards: cardMap,
          llm: adapter,
          opts: { tokenBudget: args.tokenBudget },
        });
        const report = scoreQuestion(question, result);
        reports.push(report);
        process.stdout.write(
          `${report.passed ? 'PASS' : 'FAIL'} (${report.tokensUsed} tok, ${report.termination})\n`,
        );
      }
      summaries.push(
        summarizeRepo(fixture.repoId, reports, {
          passThreshold: args.passThreshold,
        }),
      );
    }

    const report = renderReport(summaries, args);
    const outPath = resolve(args.out);
    await writeFile(outPath, report, 'utf8');
    process.stdout.write(`\nReport written to ${outPath}\n`);

    const allPassed = summaries.every((s) => s.meetsThreshold);
    if (!allPassed) {
      process.stderr.write(
        `\nphase2-eval: FAILED — at least one repo missed threshold\n`,
      );
      process.exit(1);
    }
    process.stdout.write(`\nphase2-eval: PASSED — all repos met threshold\n`);
  } finally {
    rmSync(workdir, { recursive: true, force: true });
  }
}

function renderReport(
  summaries: RepoScoreSummary[],
  args: CliArgs,
): string {
  const now = new Date().toISOString();
  const lines: string[] = [];
  lines.push('# Phase 2 Exit-Gate Eval Results');
  lines.push('');
  lines.push(`_Generated by \`scripts/eval/phase2-eval.ts\` (EC-29)._`);
  lines.push('');
  lines.push(`- Run time: ${now}`);
  lines.push(`- LLM adapter: \`${args.llm}\``);
  lines.push(`- Token budget per question: ${args.tokenBudget}`);
  lines.push(`- Pass threshold per repo: ${args.passThreshold}/5`);
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push('| Repo | Passed | Avg tokens | Met threshold? |');
  lines.push('|------|--------|-----------|----------------|');
  for (const s of summaries) {
    lines.push(
      `| \`${s.repoId}\` | ${s.passed}/${s.total} | ${s.averageTokens} | ${s.meetsThreshold ? '✅' : '❌'} |`,
    );
  }
  lines.push('');
  for (const s of summaries) {
    lines.push(`## \`${s.repoId}\``);
    lines.push('');
    for (const r of s.reports) {
      lines.push(`### ${r.questionId} — ${r.passed ? 'PASS ✅' : 'FAIL ❌'}`);
      lines.push('');
      lines.push(`**Question:** ${r.prompt}`);
      lines.push('');
      lines.push(`- Termination: \`${r.termination}\``);
      lines.push(`- Tokens used: ${r.tokensUsed}`);
      lines.push(`- Concept paths fetched: ${formatPaths(r.conceptPathsFetched)}`);
      lines.push(`- Required hits: ${formatPaths(r.mustHits)}`);
      if (r.shouldHits.length > 0) {
        lines.push(`- Bonus hits: ${formatPaths(r.shouldHits)}`);
      }
      lines.push(`- Reason: ${r.reason}`);
      lines.push('');
      lines.push('**Answer:**');
      lines.push('');
      lines.push('```');
      lines.push(r.answer || '(no answer)');
      lines.push('```');
      lines.push('');
    }
  }
  return lines.join('\n') + '\n';
}

function formatPaths(paths: string[]): string {
  if (paths.length === 0) return '_(none)_';
  return paths.map((p) => `\`${p}\``).join(', ');
}

main().catch((err) => {
  process.stderr.write(`phase2-eval: ${(err as Error).message}\n`);
  process.exit(1);
});
