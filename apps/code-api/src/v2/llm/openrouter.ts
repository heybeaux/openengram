/**
 * Minimal OpenRouter chat-completions client.
 *
 * Used by every LLM-backed pass (intent, contracts, gotchas, synthesis).
 * Kept dependency-free — global `fetch` + `AbortController` from Node 18+ —
 * so adding a new pass doesn't drag in a new SDK.
 *
 * Tests must NOT hit the live API. Pass an `llm` override into orchestrators
 * (see {@link LLMClient}) or stub `fetch` if you really must exercise this
 * module directly.
 *
 * Routing: model names are OpenRouter-style slugs ("google/gemini-2.5-flash",
 * "anthropic/claude-sonnet-4-6", etc.). The client retries once on a 5xx or
 * timeout, then falls back to `fallbackModel` if supplied — the spec calls
 * for `gemini-flash` primary + `sonnet` fallback on the intent pass.
 *
 * Spec: docs/specs/engram-code-v2.md §4.4 (model routing).
 */

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

/**
 * Pluggable LLM call shape used everywhere downstream. Tests pass a fake;
 * production passes wire {@link callOpenRouter} or a curried variant.
 */
export interface LLMClient {
  (request: LLMRequest): Promise<LLMResponse>;
}

export interface LLMRequest {
  /** Primary model slug, e.g. `google/gemini-2.5-flash`. */
  model: string;
  /** Optional fallback model, attempted on primary failure. */
  fallbackModel?: string;
  /** Single user prompt — the passes don't need multi-turn yet. */
  prompt: string;
  /** Optional system prompt. */
  system?: string;
  /** Cap on response tokens. */
  maxOutputTokens?: number;
  /** Override request timeout (ms). Default 30s. */
  timeoutMs?: number;
}

export interface LLMResponse {
  /** Model that actually produced the response (may be the fallback). */
  model: string;
  /** Assistant message content. */
  content: string;
  /** Prompt tokens reported by the provider, when available. */
  promptTokens?: number;
  /** Completion tokens reported by the provider, when available. */
  completionTokens?: number;
  /** Sum of prompt + completion. Used for budget accounting. */
  totalTokens: number;
}

export class LLMError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'LLMError';
  }
}

/**
 * Production OpenRouter caller. Reads `OPENROUTER_API_KEY` from the env at
 * call time so tests can mutate `process.env` between cases.
 *
 * Retries: a single retry on transient failure (5xx, network error, timeout)
 * before failing over to `fallbackModel`. We deliberately don't loop — passes
 * should batch and re-run failed modules at the orchestrator level, not
 * hammer the same model.
 */
export const callOpenRouter: LLMClient = async (request) => {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new LLMError('OPENROUTER_API_KEY is not set');
  }

  try {
    return await sendOnce(apiKey, { ...request, model: request.model });
  } catch (primaryErr) {
    if (!request.fallbackModel) throw primaryErr;
    if (!isTransient(primaryErr)) throw primaryErr;
    return await sendOnce(apiKey, { ...request, model: request.fallbackModel });
  }
};

async function sendOnce(apiKey: string, request: LLMRequest): Promise<LLMResponse> {
  const timeoutMs = request.timeoutMs ?? 30_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const messages: Array<{ role: 'system' | 'user'; content: string }> = [];
  if (request.system) messages.push({ role: 'system', content: request.system });
  messages.push({ role: 'user', content: request.prompt });

  const body: Record<string, unknown> = {
    model: request.model,
    messages,
  };
  if (request.maxOutputTokens) body.max_tokens = request.maxOutputTokens;

  try {
    const res = await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        // OpenRouter recommends an HTTP-Referer + X-Title for ranking + abuse
        // attribution. Static strings — no PII leaks.
        'HTTP-Referer': 'https://github.com/heybeaux/engram-code',
        'X-Title': 'engram-code',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new LLMError(
        `OpenRouter ${res.status}: ${text.slice(0, 500)}`,
        res.status,
      );
    }

    const json = (await res.json()) as OpenRouterResponse;
    const choice = json.choices?.[0];
    if (!choice?.message?.content) {
      throw new LLMError('OpenRouter returned empty content');
    }
    const promptTokens = json.usage?.prompt_tokens ?? undefined;
    const completionTokens = json.usage?.completion_tokens ?? undefined;
    const totalTokens =
      json.usage?.total_tokens ??
      (promptTokens ?? 0) + (completionTokens ?? 0);

    return {
      model: json.model ?? request.model,
      content: choice.message.content,
      promptTokens,
      completionTokens,
      totalTokens,
    };
  } catch (err) {
    if (err instanceof LLMError) throw err;
    if ((err as { name?: string }).name === 'AbortError') {
      throw new LLMError(`OpenRouter request timed out after ${timeoutMs}ms`, undefined, err);
    }
    throw new LLMError(`OpenRouter call failed: ${(err as Error).message}`, undefined, err);
  } finally {
    clearTimeout(timer);
  }
}

function isTransient(err: unknown): boolean {
  if (!(err instanceof LLMError)) return true;
  if (err.status === undefined) return true; // network/timeout
  return err.status >= 500;
}

interface OpenRouterResponse {
  model?: string;
  choices?: Array<{ message?: { content?: string } }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}
