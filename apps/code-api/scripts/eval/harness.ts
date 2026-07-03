/**
 * Phase 2 eval harness (EC-29).
 *
 * Drives a single eval question through the agent loop:
 *
 *   1. Build the initial context: the repository summary card + a
 *      bounded `map` (depth=2) listing every available conceptPath with
 *      its `index` LoD line.
 *   2. Feed Sonnet (or the mock) the system prompt + initial user turn.
 *   3. If the model emits `<request_cards>...</request_cards>`, load
 *      each requested card's `standard` LoD and append it as the next
 *      user turn. Repeat until the model emits `<final_answer>...
 *      </final_answer>` or the token budget is exceeded.
 *   4. Return the final answer + token accounting + the conceptPaths
 *      the model touched.
 *
 * Pure-ish: no Prisma, no fs side-effects. The cards are passed in as a
 * `Map<conceptPath, Card>` so the caller controls where they come from
 * (fixtures on disk, in-memory test data, etc.).
 */

import type { Card } from '../../src/v2/writers/markdown/types';
import {
  FINAL_ANSWER_CLOSE,
  FINAL_ANSWER_OPEN,
  REQUEST_CARDS_CLOSE,
  REQUEST_CARDS_OPEN,
  type EvalLLMAdapter,
  type EvalLLMMessage,
  type EvalLLMResponse,
} from './llm-adapter';

export interface HarnessOptions {
  /** Hard cap on prompt + completion tokens across the whole loop. */
  tokenBudget: number;
  /** Cap on agent turns (request_cards rounds + final). */
  maxTurns?: number;
}

export interface HarnessResult {
  /** Final natural-language answer (empty string if budget exceeded). */
  answer: string;
  /** Concept paths the agent explicitly fetched via `request_cards`. */
  conceptPathsFetched: string[];
  /** Total prompt + completion tokens consumed. */
  tokensUsed: number;
  /** Reason the loop stopped. */
  termination: 'final_answer' | 'token_budget' | 'turn_budget' | 'error';
  /** Number of agent turns consumed (each LLM call = 1 turn). */
  turns: number;
  /** Optional error message when `termination === 'error'`. */
  error?: string;
}

export function buildSystemPrompt(): string {
  return [
    'You are evaluating a codebase to answer a "where would I add X" architectural question.',
    'You are given a repository summary card and a navigation map up front.',
    'You may request additional cards by their `conceptPath` using this exact protocol:',
    '',
    `  ${REQUEST_CARDS_OPEN}path/one path/two${REQUEST_CARDS_CLOSE}`,
    '',
    'You will receive the requested cards in the next turn. When you have enough context to answer,',
    'emit your answer wrapped in:',
    '',
    `  ${FINAL_ANSWER_OPEN}your answer here${FINAL_ANSWER_CLOSE}`,
    '',
    'Rules:',
    '- Answer only with the conceptPath(s) of the subsystem(s) the change belongs in, plus a one-sentence justification.',
    '- Prefer requesting one or two cards at a time; the token budget is tight.',
    '- Do not invent conceptPaths; only request ones that appear in the navigation map.',
    '- If you already have enough info from the initial context, skip straight to `<final_answer>`.',
  ].join('\n');
}

/**
 * Build the initial user turn: repository summary + navigation map.
 *
 * The map is a flat list of `<conceptPath>  -  <index LoD>` lines, sorted
 * by conceptPath, capped at `maxMapEntries` to keep the initial context
 * small. Subsystem cards are listed before module cards (and module cards
 * are usually omitted from the map in Phase 2 to keep token usage low).
 */
export function buildInitialUserTurn(
  question: string,
  cards: Map<string, Card>,
  opts: { maxMapEntries?: number } = {},
): string {
  const maxMapEntries = opts.maxMapEntries ?? 200;
  const repoCard = Array.from(cards.values()).find(
    (c) => c.kind === 'repository',
  );
  const subsystemCards = Array.from(cards.values())
    .filter((c) => c.kind === 'subsystem')
    .sort((a, b) => a.conceptPath.localeCompare(b.conceptPath));
  const moduleCards = Array.from(cards.values())
    .filter((c) => c.kind === 'module' || c.kind === 'capability')
    .sort((a, b) => a.conceptPath.localeCompare(b.conceptPath));

  const mapEntries = [...subsystemCards, ...moduleCards].slice(
    0,
    maxMapEntries,
  );

  const lines: string[] = [];
  lines.push('## Question');
  lines.push(question);
  lines.push('');
  if (repoCard) {
    lines.push('## Repository Card');
    lines.push(`conceptPath: ${repoCard.conceptPath}`);
    lines.push('');
    lines.push(repoCard.lod.standard || repoCard.lod.summary || '');
    lines.push('');
  }
  lines.push('## Navigation Map');
  for (const c of mapEntries) {
    lines.push(`- \`${c.conceptPath}\` (${c.kind}) — ${c.lod.index}`);
  }
  return lines.join('\n');
}

/** Build the user turn that follows a `request_cards` response. */
export function buildCardsResponseTurn(
  requested: string[],
  cards: Map<string, Card>,
): string {
  const lines: string[] = [];
  for (const path of requested) {
    const card = cards.get(path);
    if (!card) {
      lines.push(`Card: ${path}`);
      lines.push('(not found)');
      lines.push('');
      continue;
    }
    lines.push(`Card: ${card.conceptPath} (${card.kind})`);
    lines.push(card.lod.standard || card.lod.summary || card.lod.index || '');
    lines.push('');
  }
  return lines.join('\n');
}

/**
 * Run the full agent loop for a single question.
 */
export async function runHarness(args: {
  question: string;
  cards: Map<string, Card>;
  llm: EvalLLMAdapter;
  opts: HarnessOptions;
}): Promise<HarnessResult> {
  const { question, cards, llm, opts } = args;
  const maxTurns = opts.maxTurns ?? 6;
  const system = buildSystemPrompt();
  const messages: EvalLLMMessage[] = [
    { role: 'user', content: buildInitialUserTurn(question, cards) },
  ];

  let tokensUsed = 0;
  let turns = 0;
  const fetched: string[] = [];

  for (let turn = 0; turn < maxTurns; turn++) {
    turns++;
    let resp: EvalLLMResponse;
    try {
      resp = await llm.call({ system, messages });
    } catch (err) {
      return {
        answer: '',
        conceptPathsFetched: fetched,
        tokensUsed,
        termination: 'error',
        turns,
        error: (err as Error).message,
      };
    }
    tokensUsed += (resp.promptTokens ?? 0) + (resp.completionTokens ?? 0);
    if (tokensUsed > opts.tokenBudget) {
      return {
        answer: resp.kind === 'final' ? resp.answer : '',
        conceptPathsFetched: fetched,
        tokensUsed,
        termination: 'token_budget',
        turns,
      };
    }

    messages.push({ role: 'assistant', content: resp.raw });

    if (resp.kind === 'final') {
      return {
        answer: resp.answer,
        conceptPathsFetched: fetched,
        tokensUsed,
        termination: 'final_answer',
        turns,
      };
    }

    // request_cards branch
    const requested = resp.conceptPaths.slice(0, 5);
    for (const p of requested) {
      if (!fetched.includes(p)) fetched.push(p);
    }
    messages.push({
      role: 'user',
      content: buildCardsResponseTurn(requested, cards),
    });
  }

  return {
    answer: '',
    conceptPathsFetched: fetched,
    tokensUsed,
    termination: 'turn_budget',
    turns,
  };
}
