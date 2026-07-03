/**
 * Tests for the gotchas pass orchestrator (EC-24).
 *
 * No filesystem, no network — LLM stubbed.
 */

import type { LLMClient } from '../../llm/openrouter';
import type { DetectGotchasInput } from './detector';
import {
  renderGotchasMarkdown,
  runGotchasPass,
} from './orchestrator';

const llmOk: LLMClient = async (req) => ({
  model: req.model,
  content: '- Watch out for X\n- Y is broken on Windows',
  promptTokens: 100,
  completionTokens: 50,
  totalTokens: 150,
});

function withTodos(modulePath: string, count = 1): DetectGotchasInput {
  const lines = Array.from({ length: count }, (_, i) => `// TODO: item ${i + 1}`);
  return {
    modulePath,
    files: [{ path: `${modulePath}/x.ts`, source: lines.join('\n'), language: 'typescript' }],
  };
}

describe('runGotchasPass', () => {
  it('emits a card per module with candidates', async () => {
    const result = await runGotchasPass(
      'repo-1',
      [withTodos('src/a'), withTodos('src/b', 3)],
      { llm: llmOk },
    );
    expect(result.modules).toHaveLength(2);
    expect(result.modules.every((m) => m.card !== null)).toBe(true);
    expect(result.modules[0].card!.sourcePass).toBe('gotchas');
    expect(result.modules[0].card!.level).toBe('MODULE');
    expect(result.modules[0].card!.content).toContain('## Gotchas: src/a');
    expect(result.modules[0].card!.content).toContain('Watch out');
    expect(result.llmCalls).toBe(2);
    expect(result.passRun.status).toBe('SUCCESS');
  });

  it('skips modules with zero candidates (no LLM call)', async () => {
    let calls = 0;
    const llm: LLMClient = async (req) => {
      calls += 1;
      return llmOk(req);
    };
    const clean: DetectGotchasInput = {
      modulePath: 'src/clean',
      files: [{ path: 'src/clean/x.ts', source: 'export function f() { return 1; }', language: 'typescript' }],
    };
    const result = await runGotchasPass('r', [clean], { llm });
    expect(result.modules[0].skipReason).toBe('no-candidates');
    expect(result.modules[0].card).toBeNull();
    expect(calls).toBe(0);
    expect(result.llmCalls).toBe(0);
  });

  it('honours maxLLMCalls cap and marks remainder call-cap', async () => {
    const modules = [withTodos('src/a'), withTodos('src/b'), withTodos('src/c')];
    const result = await runGotchasPass('r', modules, {
      llm: llmOk,
      maxLLMCalls: 2,
    });
    const capped = result.modules.filter((m) => m.skipReason === 'call-cap');
    const ok = result.modules.filter((m) => m.card !== null);
    expect(ok).toHaveLength(2);
    expect(capped).toHaveLength(1);
    expect(result.llmCalls).toBe(2);
  });

  it('honours runTokenCap independently of call cap', async () => {
    const modules = [withTodos('src/a'), withTodos('src/b'), withTodos('src/c')];
    const result = await runGotchasPass('r', modules, {
      llm: llmOk,
      runTokenCap: 200, // first call uses 150 -> next sees totalTokens=150<200, runs -> third skipped
    });
    const ok = result.modules.filter((m) => m.card !== null);
    const skipped = result.modules.filter((m) => m.skipReason === 'budget-exceeded');
    expect(ok.length).toBeGreaterThanOrEqual(1);
    expect(skipped.length).toBeGreaterThanOrEqual(1);
  });

  it('records llm-error per module without aborting the run', async () => {
    let calls = 0;
    const llm: LLMClient = async (req) => {
      calls += 1;
      if (calls === 1) throw new Error('boom');
      return llmOk(req);
    };
    const result = await runGotchasPass('r', [withTodos('src/a'), withTodos('src/b')], { llm });
    expect(result.modules[0].skipReason).toBe('llm-error');
    expect(result.modules[0].errorMessage).toBe('boom');
    expect(result.modules[1].card).not.toBeNull();
    expect(result.passRun.status).toBe('SUCCESS');
  });

  it('marks pass FAILED when every module errors', async () => {
    const llm: LLMClient = async () => {
      throw new Error('nope');
    };
    const result = await runGotchasPass('r', [withTodos('src/only')], { llm });
    expect(result.passRun.status).toBe('FAILED');
  });

  it('passes intent context to the prompt builder when resolver provided', async () => {
    let seenPrompt = '';
    const llm: LLMClient = async (req) => {
      seenPrompt = req.prompt;
      return llmOk(req);
    };
    await runGotchasPass('r', [withTodos('src/a')], {
      llm,
      resolveIntent: (p) => (p === 'src/a' ? 'auth module' : undefined),
    });
    expect(seenPrompt).toContain('auth module');
  });
});

describe('renderGotchasMarkdown', () => {
  it('wraps the LLM body with a header', () => {
    const md = renderGotchasMarkdown('src/a', '- bullet one\n- bullet two');
    expect(md).toContain('## Gotchas: src/a');
    expect(md).toContain('- bullet one');
  });

  it('substitutes a no-gotchas placeholder when the body is empty', () => {
    const md = renderGotchasMarkdown('src/a', '   ');
    expect(md).toContain('_(no real gotchas)_');
  });
});
