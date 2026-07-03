/**
 * LLM adapter for the Phase 2 eval harness (EC-29).
 *
 * Defines a minimal request/response shape that supports a single tool —
 * `request_cards` — and provides three concrete adapters:
 *
 *   - {@link createAnthropicSonnetAdapter} — real Sonnet via the Messages
 *     API. Requires `ANTHROPIC_API_KEY`. Used for the canonical results
 *     committed under `docs/eval/phase2-results.md`.
 *   - {@link createOpenRouterSonnetAdapter} — Sonnet via OpenRouter chat
 *     completions. Requires `OPENROUTER_API_KEY`. Useful if Anthropic is
 *     not available but OpenRouter routing is.
 *   - {@link createMockAdapter} — deterministic mock that drives the agent
 *     loop using a heuristic over the cards in scope. Used in CI/jest.
 *
 * The harness only depends on the {@link EvalLLMAdapter} interface; the
 * concrete adapters are interchangeable.
 */

import type { Card } from '../../src/v2/writers/markdown/types';

/** A single message in the agent loop. */
export interface EvalLLMMessage {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * The model's response. Either:
 *   - `kind: 'request_cards'` — the model is asking for more cards by
 *     conceptPath. The harness loads them and re-enters the loop.
 *   - `kind: 'final'` — the model committed to an answer.
 */
export type EvalLLMResponse =
  | {
      kind: 'request_cards';
      conceptPaths: string[];
      raw: string;
      promptTokens: number;
      completionTokens: number;
    }
  | {
      kind: 'final';
      answer: string;
      raw: string;
      promptTokens: number;
      completionTokens: number;
    };

export interface EvalLLMRequest {
  system: string;
  messages: EvalLLMMessage[];
}

export interface EvalLLMAdapter {
  /** Human-readable id for the report. */
  id: string;
  /** Drive a single round of the agent loop. */
  call(req: EvalLLMRequest): Promise<EvalLLMResponse>;
}

/** Tags the agent uses to indicate intent. Documented in the system prompt. */
export const REQUEST_CARDS_OPEN = '<request_cards>';
export const REQUEST_CARDS_CLOSE = '</request_cards>';
export const FINAL_ANSWER_OPEN = '<final_answer>';
export const FINAL_ANSWER_CLOSE = '</final_answer>';

/**
 * Parse a raw model completion into a structured response.
 *
 * Tolerates a mix of prose around the tags; prefers `final_answer` over
 * `request_cards` if both appear (the model committed). Returns a `final`
 * response with the raw text if neither tag is present — the loop will
 * treat that as an answer and let the scorer pass/fail it.
 */
export function parseResponse(raw: string): {
  kind: 'request_cards' | 'final';
  conceptPaths: string[];
  answer: string;
} {
  const finalMatch = extractBetween(raw, FINAL_ANSWER_OPEN, FINAL_ANSWER_CLOSE);
  if (finalMatch !== null) {
    return { kind: 'final', conceptPaths: [], answer: finalMatch.trim() };
  }
  const requestMatch = extractBetween(
    raw,
    REQUEST_CARDS_OPEN,
    REQUEST_CARDS_CLOSE,
  );
  if (requestMatch !== null) {
    const paths = requestMatch
      .split(/[\s,]+/)
      .map((p) => p.trim())
      .filter((p) => p !== '');
    if (paths.length > 0) {
      return { kind: 'request_cards', conceptPaths: paths, answer: '' };
    }
  }
  return { kind: 'final', conceptPaths: [], answer: raw.trim() };
}

function extractBetween(
  raw: string,
  open: string,
  close: string,
): string | null {
  const start = raw.indexOf(open);
  if (start === -1) return null;
  const end = raw.indexOf(close, start + open.length);
  if (end === -1) return null;
  return raw.slice(start + open.length, end);
}

// ─── mock adapter ───────────────────────────────────────────────────────

/**
 * Mock adapter used in CI / jest integration tests.
 *
 * Behaviour:
 *   1. On the first call, it inspects the question for keywords and
 *      requests one or two relevant subsystem cards. This exercises the
 *      `request_cards` round-trip without needing a real model.
 *   2. On any subsequent call, it picks the conceptPath of whichever
 *      subsystem card in scope has the most token-overlap with the
 *      question and emits that as its `<final_answer>`.
 *
 * The mock is intentionally **good enough** to pass the exit-gate
 * thresholds against the committed fixtures. It is NOT a stand-in for a
 * real model on novel codebases.
 */
export function createMockAdapter(allCards: Card[]): EvalLLMAdapter {
  const subsystemCards = allCards.filter((c) => c.kind === 'subsystem');
  return {
    id: 'mock-heuristic',
    async call(req) {
      const lastUser = [...req.messages]
        .reverse()
        .find((m) => m.role === 'user');
      const question = lastUser?.content ?? '';
      const ranked = rankSubsystems(question, subsystemCards);
      const top = ranked[0];
      if (!top) {
        return {
          kind: 'final',
          answer: 'No subsystem cards available.',
          raw: 'No subsystem cards available.',
          promptTokens: estimateTokens(req),
          completionTokens: 20,
        };
      }
      // First turn: request the top card; second turn: answer.
      const alreadyRequested = req.messages.some((m) =>
        m.content.includes(`Card: ${top.conceptPath}`),
      );
      if (!alreadyRequested) {
        const raw =
          `${REQUEST_CARDS_OPEN}${top.conceptPath}${REQUEST_CARDS_CLOSE}`;
        return {
          kind: 'request_cards',
          conceptPaths: [top.conceptPath],
          raw,
          promptTokens: estimateTokens(req),
          completionTokens: 30,
        };
      }
      const answer = `The right place is \`${top.conceptPath}\`. See its summary for the file list and conventions.`;
      const raw = `${FINAL_ANSWER_OPEN}${answer}${FINAL_ANSWER_CLOSE}`;
      return {
        kind: 'final',
        answer,
        raw,
        promptTokens: estimateTokens(req),
        completionTokens: 60,
      };
    },
  };
}

function rankSubsystems(question: string, cards: Card[]): Card[] {
  const qTokens = tokenize(question);
  const scored = cards.map((c) => {
    const haystack =
      `${c.conceptPath} ${c.lod.index} ${c.lod.summary} ${c.lod.standard}`.toLowerCase();
    let score = 0;
    for (const t of qTokens) {
      if (haystack.includes(t)) score += 1;
    }
    return { c, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored.map((s) => s.c);
}

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 3);
}

function estimateTokens(req: EvalLLMRequest): number {
  const all = req.system + req.messages.map((m) => m.content).join(' ');
  return Math.ceil(all.length / 4);
}

// ─── Anthropic Sonnet adapter ───────────────────────────────────────────

interface AnthropicAdapterOptions {
  apiKey: string;
  model?: string;
  maxTokens?: number;
  timeoutMs?: number;
}

/**
 * Real Sonnet adapter using the Anthropic Messages API directly (no SDK
 * dependency added). Requires `ANTHROPIC_API_KEY`.
 *
 * The harness uses the same `<request_cards>` / `<final_answer>` tag
 * protocol as the mock — Sonnet is instructed to emit one or the other
 * each turn.
 */
export function createAnthropicSonnetAdapter(
  opts: AnthropicAdapterOptions,
): EvalLLMAdapter {
  const model = opts.model ?? 'claude-sonnet-4-6';
  const maxTokens = opts.maxTokens ?? 1024;
  const timeoutMs = opts.timeoutMs ?? 60_000;
  return {
    id: `anthropic:${model}`,
    async call(req) {
      const body = {
        model,
        max_tokens: maxTokens,
        system: req.system,
        messages: req.messages.map((m) => ({
          role: m.role,
          content: m.content,
        })),
      };
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      let resp: Response;
      try {
        resp = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-api-key': opts.apiKey,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeout);
      }
      if (!resp.ok) {
        const text = await resp.text();
        throw new Error(`Anthropic ${resp.status}: ${text}`);
      }
      const json = (await resp.json()) as AnthropicResponse;
      const content = (json.content ?? [])
        .filter((b) => b.type === 'text')
        .map((b) => b.text ?? '')
        .join('');
      const parsed = parseResponse(content);
      const promptTokens = json.usage?.input_tokens ?? 0;
      const completionTokens = json.usage?.output_tokens ?? 0;
      if (parsed.kind === 'request_cards') {
        return {
          kind: 'request_cards',
          conceptPaths: parsed.conceptPaths,
          raw: content,
          promptTokens,
          completionTokens,
        };
      }
      return {
        kind: 'final',
        answer: parsed.answer,
        raw: content,
        promptTokens,
        completionTokens,
      };
    },
  };
}

interface AnthropicResponse {
  content?: Array<{ type: string; text?: string }>;
  usage?: { input_tokens?: number; output_tokens?: number };
}

// ─── OpenRouter Sonnet adapter (fallback) ──────────────────────────────

interface OpenRouterAdapterOptions {
  apiKey: string;
  model?: string;
  maxTokens?: number;
  timeoutMs?: number;
}

export function createOpenRouterSonnetAdapter(
  opts: OpenRouterAdapterOptions,
): EvalLLMAdapter {
  const model = opts.model ?? 'anthropic/claude-sonnet-4-6';
  const maxTokens = opts.maxTokens ?? 1024;
  const timeoutMs = opts.timeoutMs ?? 60_000;
  return {
    id: `openrouter:${model}`,
    async call(req) {
      const body = {
        model,
        max_tokens: maxTokens,
        messages: [
          { role: 'system', content: req.system },
          ...req.messages.map((m) => ({ role: m.role, content: m.content })),
        ],
      };
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      let resp: Response;
      try {
        resp = await fetch(
          'https://openrouter.ai/api/v1/chat/completions',
          {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              authorization: `Bearer ${opts.apiKey}`,
            },
            body: JSON.stringify(body),
            signal: controller.signal,
          },
        );
      } finally {
        clearTimeout(timeout);
      }
      if (!resp.ok) {
        const text = await resp.text();
        throw new Error(`OpenRouter ${resp.status}: ${text}`);
      }
      const json = (await resp.json()) as OpenRouterResponse;
      const content = json.choices?.[0]?.message?.content ?? '';
      const parsed = parseResponse(content);
      const promptTokens = json.usage?.prompt_tokens ?? 0;
      const completionTokens = json.usage?.completion_tokens ?? 0;
      if (parsed.kind === 'request_cards') {
        return {
          kind: 'request_cards',
          conceptPaths: parsed.conceptPaths,
          raw: content,
          promptTokens,
          completionTokens,
        };
      }
      return {
        kind: 'final',
        answer: parsed.answer,
        raw: content,
        promptTokens,
        completionTokens,
      };
    },
  };
}

interface OpenRouterResponse {
  choices?: Array<{ message?: { content?: string } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}
