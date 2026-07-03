/**
 * Tests for the OpenRouter client.
 *
 * No network: we stub `global.fetch` per case and assert request shape +
 * fallback behaviour + budget reporting.
 */

import { callOpenRouter, LLMError } from './openrouter';

describe('callOpenRouter', () => {
  const originalFetch = global.fetch;
  const originalKey = process.env.OPENROUTER_API_KEY;

  afterEach(() => {
    global.fetch = originalFetch;
    process.env.OPENROUTER_API_KEY = originalKey;
    jest.restoreAllMocks();
  });

  it('throws when OPENROUTER_API_KEY is missing', async () => {
    delete process.env.OPENROUTER_API_KEY;
    await expect(
      callOpenRouter({ model: 'google/gemini-2.5-flash', prompt: 'hi' }),
    ).rejects.toThrow(LLMError);
  });

  it('posts to OpenRouter with bearer auth + returns parsed content', async () => {
    process.env.OPENROUTER_API_KEY = 'sk-test';
    const fetchSpy = jest.fn(async (_url, init) => {
      const body = JSON.parse((init as RequestInit).body as string);
      expect(body.model).toBe('google/gemini-2.5-flash');
      expect(body.messages).toEqual([
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'hello' },
      ]);
      expect((init as RequestInit).headers as Record<string, string>).toMatchObject({
        Authorization: 'Bearer sk-test',
      });
      return new Response(
        JSON.stringify({
          model: 'google/gemini-2.5-flash',
          choices: [{ message: { content: 'world' } }],
          usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    });
    global.fetch = fetchSpy;

    const out = await callOpenRouter({
      model: 'google/gemini-2.5-flash',
      prompt: 'hello',
      system: 'sys',
      maxOutputTokens: 100,
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(out.content).toBe('world');
    expect(out.totalTokens).toBe(7);
    expect(out.promptTokens).toBe(5);
  });

  it('falls back to fallbackModel on 5xx', async () => {
    process.env.OPENROUTER_API_KEY = 'sk-test';
    const calls: string[] = [];
    global.fetch = jest.fn(async (_url, init) => {
      const body = JSON.parse((init as RequestInit).body as string);
      calls.push(body.model);
      if (body.model === 'google/gemini-2.5-flash') {
        return new Response('upstream timeout', { status: 502 });
      }
      return new Response(
        JSON.stringify({
          model: body.model,
          choices: [{ message: { content: 'fallback ok' } }],
          usage: { total_tokens: 3 },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    });

    const out = await callOpenRouter({
      model: 'google/gemini-2.5-flash',
      fallbackModel: 'anthropic/claude-sonnet-4-6',
      prompt: 'hi',
    });

    expect(calls).toEqual(['google/gemini-2.5-flash', 'anthropic/claude-sonnet-4-6']);
    expect(out.content).toBe('fallback ok');
    expect(out.model).toBe('anthropic/claude-sonnet-4-6');
  });

  it('does NOT fall back on a 4xx (non-transient)', async () => {
    process.env.OPENROUTER_API_KEY = 'sk-test';
    global.fetch = jest.fn(
      async () => new Response('bad request', { status: 400 }),
    );

    await expect(
      callOpenRouter({
        model: 'google/gemini-2.5-flash',
        fallbackModel: 'anthropic/claude-sonnet-4-6',
        prompt: 'hi',
      }),
    ).rejects.toThrow(/OpenRouter 400/);
  });

  it('reports usage even when only prompt+completion are returned', async () => {
    process.env.OPENROUTER_API_KEY = 'sk-test';
    global.fetch = jest.fn(
      async () =>
        new Response(
          JSON.stringify({
            choices: [{ message: { content: 'ok' } }],
            usage: { prompt_tokens: 10, completion_tokens: 4 },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
    );

    const out = await callOpenRouter({ model: 'x', prompt: 'p' });
    expect(out.totalTokens).toBe(14);
  });
});
