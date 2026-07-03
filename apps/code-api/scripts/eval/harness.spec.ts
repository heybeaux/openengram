/**
 * Unit tests for the Phase 2 eval harness modules (EC-29).
 *
 * Covers:
 *   - `parseResponse` tag parsing for the LLM adapter.
 *   - `buildInitialUserTurn` shape (question, repo card, map).
 *   - `runHarness` loop:
 *       * happy path: request_cards → final_answer
 *       * token-budget termination
 *       * turn-budget termination
 *       * adapter error → `termination: 'error'`
 *   - `scoreQuestion` pass/fail semantics on conceptPath matching.
 *   - `materializeFixture` round-trips cards through the writer.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runHarness, buildInitialUserTurn } from './harness';
import {
  parseResponse,
  REQUEST_CARDS_OPEN,
  REQUEST_CARDS_CLOSE,
  FINAL_ANSWER_OPEN,
  FINAL_ANSWER_CLOSE,
  type EvalLLMAdapter,
} from './llm-adapter';
import { scoreQuestion } from './scorer';
import { materializeFixture } from './fixture-loader';
import { EVAL_FIXTURES } from './fixtures';
import type { Card } from '../../src/v2/writers/markdown/types';

function makeCard(conceptPath: string, kind: Card['kind']): Card {
  return {
    conceptPath,
    kind,
    lod: {
      index: `${kind} ${conceptPath}`,
      summary: `summary of ${conceptPath}`,
      standard: `standard body of ${conceptPath}`,
      deep: `deep body of ${conceptPath}`,
    },
    metadata: { model: 'test' },
  };
}

function cardMap(cards: Card[]): Map<string, Card> {
  const m = new Map<string, Card>();
  for (const c of cards) m.set(c.conceptPath, c);
  return m;
}

describe('parseResponse', () => {
  it('extracts a final answer', () => {
    const raw = `prelude ${FINAL_ANSWER_OPEN}the answer${FINAL_ANSWER_CLOSE} postlude`;
    expect(parseResponse(raw)).toEqual({
      kind: 'final',
      conceptPaths: [],
      answer: 'the answer',
    });
  });

  it('extracts requested concept paths', () => {
    const raw = `${REQUEST_CARDS_OPEN}foo/bar baz/qux${REQUEST_CARDS_CLOSE}`;
    expect(parseResponse(raw)).toEqual({
      kind: 'request_cards',
      conceptPaths: ['foo/bar', 'baz/qux'],
      answer: '',
    });
  });

  it('prefers final over request when both appear', () => {
    const raw = `${REQUEST_CARDS_OPEN}x${REQUEST_CARDS_CLOSE} and ${FINAL_ANSWER_OPEN}done${FINAL_ANSWER_CLOSE}`;
    expect(parseResponse(raw).kind).toBe('final');
  });

  it('treats raw text as a final answer when no tags present', () => {
    expect(parseResponse('just words')).toEqual({
      kind: 'final',
      conceptPaths: [],
      answer: 'just words',
    });
  });
});

describe('buildInitialUserTurn', () => {
  it('includes the question, repo card, and a map of subsystems', () => {
    const cards = cardMap([
      makeCard('repo/repository', 'repository'),
      makeCard('repo/alpha', 'subsystem'),
      makeCard('repo/beta', 'subsystem'),
    ]);
    const turn = buildInitialUserTurn('where do I add X?', cards);
    expect(turn).toContain('where do I add X?');
    expect(turn).toContain('repo/repository');
    expect(turn).toContain('`repo/alpha` (subsystem)');
    expect(turn).toContain('`repo/beta` (subsystem)');
  });

  it('sorts subsystems before modules in the map', () => {
    const cards = cardMap([
      makeCard('repo/repository', 'repository'),
      makeCard('repo/zsub', 'subsystem'),
      makeCard('repo/amod', 'module'),
    ]);
    const turn = buildInitialUserTurn('q', cards);
    const subIdx = turn.indexOf('repo/zsub');
    const modIdx = turn.indexOf('repo/amod');
    expect(subIdx).toBeGreaterThan(-1);
    expect(modIdx).toBeGreaterThan(-1);
    expect(subIdx).toBeLessThan(modIdx);
  });
});

describe('runHarness', () => {
  const cards = cardMap([
    makeCard('repo/repository', 'repository'),
    makeCard('repo/payments', 'subsystem'),
  ]);

  it('finishes on final_answer in one turn', async () => {
    const adapter: EvalLLMAdapter = {
      id: 'fake',
      async call() {
        return {
          kind: 'final',
          answer: 'repo/payments',
          raw: `${FINAL_ANSWER_OPEN}repo/payments${FINAL_ANSWER_CLOSE}`,
          promptTokens: 100,
          completionTokens: 50,
        };
      },
    };
    const result = await runHarness({
      question: 'where?',
      cards,
      llm: adapter,
      opts: { tokenBudget: 8000 },
    });
    expect(result.termination).toBe('final_answer');
    expect(result.answer).toBe('repo/payments');
    expect(result.tokensUsed).toBe(150);
    expect(result.turns).toBe(1);
  });

  it('round-trips request_cards then final_answer', async () => {
    let turn = 0;
    const adapter: EvalLLMAdapter = {
      id: 'fake',
      async call() {
        turn++;
        if (turn === 1) {
          return {
            kind: 'request_cards',
            conceptPaths: ['repo/payments'],
            raw: `${REQUEST_CARDS_OPEN}repo/payments${REQUEST_CARDS_CLOSE}`,
            promptTokens: 100,
            completionTokens: 20,
          };
        }
        return {
          kind: 'final',
          answer: 'repo/payments',
          raw: `${FINAL_ANSWER_OPEN}repo/payments${FINAL_ANSWER_CLOSE}`,
          promptTokens: 150,
          completionTokens: 50,
        };
      },
    };
    const result = await runHarness({
      question: 'where?',
      cards,
      llm: adapter,
      opts: { tokenBudget: 8000 },
    });
    expect(result.turns).toBe(2);
    expect(result.conceptPathsFetched).toEqual(['repo/payments']);
    expect(result.termination).toBe('final_answer');
  });

  it('terminates on token budget', async () => {
    const adapter: EvalLLMAdapter = {
      id: 'fake',
      async call() {
        return {
          kind: 'request_cards',
          conceptPaths: ['repo/payments'],
          raw: `${REQUEST_CARDS_OPEN}repo/payments${REQUEST_CARDS_CLOSE}`,
          promptTokens: 9000,
          completionTokens: 100,
        };
      },
    };
    const result = await runHarness({
      question: 'where?',
      cards,
      llm: adapter,
      opts: { tokenBudget: 1000 },
    });
    expect(result.termination).toBe('token_budget');
  });

  it('terminates on turn budget', async () => {
    const adapter: EvalLLMAdapter = {
      id: 'fake',
      async call() {
        return {
          kind: 'request_cards',
          conceptPaths: ['repo/payments'],
          raw: `${REQUEST_CARDS_OPEN}repo/payments${REQUEST_CARDS_CLOSE}`,
          promptTokens: 10,
          completionTokens: 5,
        };
      },
    };
    const result = await runHarness({
      question: 'where?',
      cards,
      llm: adapter,
      opts: { tokenBudget: 100000, maxTurns: 2 },
    });
    expect(result.termination).toBe('turn_budget');
    expect(result.turns).toBe(2);
  });

  it('captures adapter errors', async () => {
    const adapter: EvalLLMAdapter = {
      id: 'fake',
      async call() {
        throw new Error('boom');
      },
    };
    const result = await runHarness({
      question: 'where?',
      cards,
      llm: adapter,
      opts: { tokenBudget: 8000 },
    });
    expect(result.termination).toBe('error');
    expect(result.error).toBe('boom');
  });
});

describe('scoreQuestion', () => {
  it('passes when answer mentions a required conceptPath', () => {
    const report = scoreQuestion(
      {
        id: 'q1',
        prompt: '?',
        mustInclude: ['repo/payments'],
      },
      {
        answer: 'You want repo/payments',
        conceptPathsFetched: [],
        tokensUsed: 100,
        termination: 'final_answer',
        turns: 1,
      },
    );
    expect(report.passed).toBe(true);
    expect(report.mustHits).toEqual(['repo/payments']);
  });

  it('fails when answer omits all required paths', () => {
    const report = scoreQuestion(
      {
        id: 'q1',
        prompt: '?',
        mustInclude: ['repo/payments'],
      },
      {
        answer: 'You want repo/webhooks',
        conceptPathsFetched: [],
        tokensUsed: 100,
        termination: 'final_answer',
        turns: 1,
      },
    );
    expect(report.passed).toBe(false);
  });

  it('fails when run terminated early', () => {
    const report = scoreQuestion(
      {
        id: 'q1',
        prompt: '?',
        mustInclude: ['repo/payments'],
      },
      {
        answer: 'repo/payments',
        conceptPathsFetched: [],
        tokensUsed: 100,
        termination: 'token_budget',
        turns: 1,
      },
    );
    expect(report.passed).toBe(false);
    expect(report.reason).toContain('token_budget');
  });

  it('counts bonus hits without affecting pass/fail', () => {
    const report = scoreQuestion(
      {
        id: 'q1',
        prompt: '?',
        mustInclude: ['repo/payments'],
        shouldInclude: ['repo/config'],
      },
      {
        answer: 'repo/payments and repo/config',
        conceptPathsFetched: [],
        tokensUsed: 100,
        termination: 'final_answer',
        turns: 1,
      },
    );
    expect(report.passed).toBe(true);
    expect(report.shouldHits).toEqual(['repo/config']);
  });
});

describe('materializeFixture', () => {
  let workdir: string;
  beforeEach(() => {
    workdir = mkdtempSync(join(tmpdir(), 'phase2-fixture-'));
  });
  afterEach(() => {
    rmSync(workdir, { recursive: true, force: true });
  });

  it('round-trips every fixture card through writeCard/readCard', async () => {
    for (const fixture of EVAL_FIXTURES) {
      const map = await materializeFixture(fixture, workdir);
      expect(map.size).toBe(fixture.cards.length);
      for (const card of fixture.cards) {
        const read = map.get(card.conceptPath);
        expect(read).toBeDefined();
        expect(read!.kind).toBe(card.kind);
        expect(read!.lod.summary).toBe(card.lod.summary);
      }
    }
  });
});
