/**
 * Integration test for the Phase 2 exit-gate eval harness (EC-29).
 *
 * Runs the full harness against both committed fixtures using the
 * deterministic mock adapter. The mock is intentionally a simple
 * keyword-overlap ranker — it cannot stand in for Sonnet's semantic
 * understanding, so this test asserts the *mechanics* of the harness:
 *
 *   - the agent loop completes (no errors / no infinite recursion)
 *   - every question finishes with `final_answer` within budget
 *   - the scorer produces a well-formed report for every question
 *   - the answer references at least one card the harness fetched
 *
 * The canonical pass/fail measurement against the 4/5-per-repo threshold
 * uses real Sonnet via `scripts/eval/phase2-eval.ts --llm=anthropic`,
 * which writes `docs/eval/phase2-results.md`. That file is committed and
 * is the artifact CI inspects on merge.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { EVAL_FIXTURES } from './fixtures';
import { runHarness } from './harness';
import { createMockAdapter } from './llm-adapter';
import { scoreQuestion } from './scorer';
import { materializeFixture } from './fixture-loader';

describe('Phase 2 exit-gate harness (mock LLM, end-to-end)', () => {
  let workdir: string;
  beforeAll(() => {
    workdir = mkdtempSync(join(tmpdir(), 'phase2-eval-e2e-'));
  });
  afterAll(() => {
    rmSync(workdir, { recursive: true, force: true });
  });

  it.each(EVAL_FIXTURES.map((f) => [f.repoId, f] as const))(
    'runs every question for %s within budget and produces a well-formed report',
    async (_repoId, fixture) => {
      const cards = await materializeFixture(fixture, workdir);
      const adapter = createMockAdapter(Array.from(cards.values()));

      for (const question of fixture.questions) {
        const result = await runHarness({
          question: question.prompt,
          cards,
          llm: adapter,
          opts: { tokenBudget: 8000 },
        });

        // Mechanics — the loop terminates on a real answer, not an error.
        expect(result.termination).toBe('final_answer');
        expect(result.answer).not.toBe('');
        expect(result.tokensUsed).toBeGreaterThan(0);
        expect(result.tokensUsed).toBeLessThanOrEqual(8000);

        // Scorer should produce a well-formed report (even if it fails —
        // the mock can't reliably pass the semantic threshold).
        const report = scoreQuestion(question, result);
        expect(report.questionId).toBe(question.id);
        expect(typeof report.passed).toBe('boolean');
        expect(report.tokensUsed).toBe(result.tokensUsed);

        // The mock always requests one card before answering — that
        // round-trip must show up in the fetched list.
        expect(result.conceptPathsFetched.length).toBeGreaterThanOrEqual(1);
      }
    },
  );

  it('mock heuristic answers at least one engram-code question correctly (smoke)', async () => {
    // The mock is too dumb to hit 4/5, but it should hit *something* —
    // that's a sanity check that the wiring isn't accidentally constant
    // (e.g. always emitting the wrong card).
    const fixture = EVAL_FIXTURES.find((f) => f.repoId === 'engram-code')!;
    const cards = await materializeFixture(fixture, workdir);
    const adapter = createMockAdapter(Array.from(cards.values()));
    let passed = 0;
    for (const question of fixture.questions) {
      const result = await runHarness({
        question: question.prompt,
        cards,
        llm: adapter,
        opts: { tokenBudget: 8000 },
      });
      if (scoreQuestion(question, result).passed) passed++;
    }
    expect(passed).toBeGreaterThanOrEqual(1);
  });
});
