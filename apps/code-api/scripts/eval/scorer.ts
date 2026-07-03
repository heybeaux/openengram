/**
 * Phase 2 eval scorer (EC-29).
 *
 * Scores a {@link HarnessResult} answer against an {@link EvalQuestion}'s
 * ground-truth concept paths. A question is "correct" if the agent's
 * answer references at least one of the `mustInclude` paths and the run
 * terminated with `final_answer` within the token budget.
 *
 * `shouldInclude` paths are tracked separately for partial-credit
 * reporting; they do not affect pass/fail.
 */

import type { HarnessResult } from './harness';
import type { EvalQuestion } from './fixtures';

export interface ScoreReport {
  questionId: string;
  prompt: string;
  passed: boolean;
  reason: string;
  mustHits: string[];
  shouldHits: string[];
  tokensUsed: number;
  termination: HarnessResult['termination'];
  answer: string;
  conceptPathsFetched: string[];
}

export function scoreQuestion(
  question: EvalQuestion,
  result: HarnessResult,
): ScoreReport {
  const haystack = result.answer.toLowerCase();
  const mustHits = question.mustInclude.filter((p) =>
    haystack.includes(p.toLowerCase()),
  );
  const shouldHits = (question.shouldInclude ?? []).filter((p) =>
    haystack.includes(p.toLowerCase()),
  );

  let passed = false;
  let reason = '';

  if (result.termination !== 'final_answer') {
    reason = `run terminated as "${result.termination}" before a final answer`;
  } else if (mustHits.length === 0) {
    reason = `answer did not mention any required conceptPath (${question.mustInclude.join(', ')})`;
  } else {
    passed = true;
    reason = `matched required conceptPath(s): ${mustHits.join(', ')}`;
  }

  return {
    questionId: question.id,
    prompt: question.prompt,
    passed,
    reason,
    mustHits,
    shouldHits,
    tokensUsed: result.tokensUsed,
    termination: result.termination,
    answer: result.answer,
    conceptPathsFetched: result.conceptPathsFetched,
  };
}

export interface RepoScoreSummary {
  repoId: string;
  total: number;
  passed: number;
  passThreshold: number;
  meetsThreshold: boolean;
  averageTokens: number;
  reports: ScoreReport[];
}

export function summarizeRepo(
  repoId: string,
  reports: ScoreReport[],
  opts: { passThreshold: number },
): RepoScoreSummary {
  const passed = reports.filter((r) => r.passed).length;
  const averageTokens =
    reports.length === 0
      ? 0
      : Math.round(
          reports.reduce((acc, r) => acc + r.tokensUsed, 0) / reports.length,
        );
  return {
    repoId,
    total: reports.length,
    passed,
    passThreshold: opts.passThreshold,
    meetsThreshold: passed >= opts.passThreshold,
    averageTokens,
    reports,
  };
}
