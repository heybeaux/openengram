/**
 * Tests for the Pass 6 (synthesis) module-level card generator.
 *
 * Coverage targets (EC-13 acceptance):
 *   1. A card is produced with all four LoD bodies populated.
 *   2. Each LoD body fits within its approximate token budget.
 *   3. The deterministic LoDs (`index`, `summary`) are pure functions of
 *      the input — same input ⇒ identical output across runs.
 *   4. The LLM hook is invoked for the LLM-backed LoDs and receives the
 *      correct budget.
 */

import type { ParseResult } from '../parsers/types';
import {
  LOD_TOKEN_BUDGETS,
  approxTokenCount,
  buildDeepPrompt,
  buildStandardPrompt,
  synthesizeModuleCard,
} from './synthesis.pass';

function fixtureStructure(): Pick<ParseResult, 'nodes' | 'edges' | 'language'> {
  return {
    language: 'typescript',
    nodes: [
      {
        kind: 'module',
        name: 'sample.ts',
        filePath: 'src/sample.ts',
        startLine: 1,
        endLine: 50,
      },
      {
        kind: 'class',
        name: 'Greeter',
        filePath: 'src/sample.ts',
        startLine: 5,
        endLine: 20,
      },
      {
        kind: 'function',
        name: 'helloWorld',
        filePath: 'src/sample.ts',
        startLine: 22,
        endLine: 28,
      },
      {
        kind: 'function',
        name: '_internalHelper',
        filePath: 'src/sample.ts',
        startLine: 30,
        endLine: 35,
      },
      {
        kind: 'export',
        name: 'Greeter',
        filePath: 'src/sample.ts',
        startLine: 5,
        endLine: 5,
      },
      {
        kind: 'export',
        name: 'helloWorld',
        filePath: 'src/sample.ts',
        startLine: 22,
        endLine: 22,
      },
    ],
    edges: [
      { from: 'helloWorld', to: 'Greeter', type: 'calls' },
      { from: 'src/sample.ts', to: 'node:fs', type: 'imports' },
    ],
  };
}

const FIXED_NOW = '2026-05-24T00:00:00.000Z';

describe('synthesizeModuleCard (Pass 6, module-level)', () => {
  it('produces a card with all four LoD bodies populated', async () => {
    const card = await synthesizeModuleCard({
      modulePath: 'src/sample',
      structure: fixtureStructure(),
      source: 'export class Greeter {}\nexport function helloWorld(){}\n',
      now: FIXED_NOW,
    });

    expect(card.conceptPath).toBe('src/sample');
    expect(card.kind).toBe('module');
    expect(card.lod.index).not.toHaveLength(0);
    expect(card.lod.summary).not.toHaveLength(0);
    expect(card.lod.standard).not.toHaveLength(0);
    expect(card.lod.deep).not.toHaveLength(0);

    expect(card.metadata.generated_at).toBe(FIXED_NOW);
    expect(card.metadata.hash).toMatch(/^[0-9a-f]{16}$/);
    expect(card.metadata.language).toBe('typescript');
    expect(card.metadata.sources).toEqual(['src/sample.ts']);
  });

  it('respects approximate token budgets for every LoD', async () => {
    const card = await synthesizeModuleCard({
      modulePath: 'src/sample',
      structure: fixtureStructure(),
      // A long source so deep-prompt source inclusion is exercised.
      source: 'x'.repeat(20_000),
      now: FIXED_NOW,
    });

    expect(approxTokenCount(card.lod.index)).toBeLessThanOrEqual(
      LOD_TOKEN_BUDGETS.index,
    );
    expect(approxTokenCount(card.lod.summary)).toBeLessThanOrEqual(
      LOD_TOKEN_BUDGETS.summary,
    );
    expect(approxTokenCount(card.lod.standard)).toBeLessThanOrEqual(
      LOD_TOKEN_BUDGETS.standard,
    );
    expect(approxTokenCount(card.lod.deep)).toBeLessThanOrEqual(
      LOD_TOKEN_BUDGETS.deep,
    );
  });

  it('is deterministic for `index` and `summary` given the same input', async () => {
    // Use a non-deterministic LLM stub to prove the deterministic LoDs are
    // unaffected by it.
    let call = 0;
    const flakyLLM = (_: string, max: number): Promise<string> => {
      call += 1;
      return Promise.resolve(`run-${call}-${max}`);
    };

    const a = await synthesizeModuleCard({
      modulePath: 'src/sample',
      structure: fixtureStructure(),
      now: FIXED_NOW,
      llm: flakyLLM,
    });
    const b = await synthesizeModuleCard({
      modulePath: 'src/sample',
      structure: fixtureStructure(),
      now: FIXED_NOW,
      llm: flakyLLM,
    });

    expect(a.lod.index).toBe(b.lod.index);
    expect(a.lod.summary).toBe(b.lod.summary);
    // Hash is also deterministic.
    expect(a.metadata.hash).toBe(b.metadata.hash);
    // And the LLM-backed LoDs DID change (confirms the flaky stub fired).
    expect(a.lod.standard).not.toBe(b.lod.standard);
  });

  it('passes the correct token budget to the LLM hook for each LoD', async () => {
    const calls: Array<{ prompt: string; max: number }> = [];
    const recordingLLM = (prompt: string, max: number): Promise<string> => {
      calls.push({ prompt, max });
      return Promise.resolve(`body@${max}`);
    };

    await synthesizeModuleCard({
      modulePath: 'src/sample',
      structure: fixtureStructure(),
      source: 'export const x = 1;\n',
      now: FIXED_NOW,
      llm: recordingLLM,
    });

    expect(calls).toHaveLength(2);
    const budgets = calls.map((c) => c.max).sort((a, b) => a - b);
    expect(budgets).toEqual([
      LOD_TOKEN_BUDGETS.standard,
      LOD_TOKEN_BUDGETS.deep,
    ]);

    // Standard prompt should not embed full source; deep prompt should.
    const standardCall = calls.find(
      (c) => c.max === LOD_TOKEN_BUDGETS.standard,
    )!;
    const deepCall = calls.find((c) => c.max === LOD_TOKEN_BUDGETS.deep)!;
    expect(standardCall.prompt).toContain('STANDARD');
    expect(deepCall.prompt).toContain('DEEP');
    expect(deepCall.prompt).toContain('--- source (truncated) ---');
  });

  it('builds prompts that reference the module path and language', () => {
    const input = {
      modulePath: 'src/sample',
      structure: fixtureStructure(),
      source: 'export const x = 1;\n',
    };
    expect(buildStandardPrompt(input)).toContain('src/sample');
    expect(buildStandardPrompt(input)).toContain('typescript');
    expect(buildDeepPrompt(input)).toContain('src/sample');
    expect(buildDeepPrompt(input)).toContain('typescript');
  });

  it('falls back gracefully when no exports or symbols are present', async () => {
    const card = await synthesizeModuleCard({
      modulePath: 'src/empty',
      structure: { language: 'go', nodes: [], edges: [] },
      now: FIXED_NOW,
    });

    expect(card.lod.index).toContain('no top-level symbols');
    expect(card.lod.summary).toContain('(no public symbols detected)');
    expect(approxTokenCount(card.lod.index)).toBeLessThanOrEqual(
      LOD_TOKEN_BUDGETS.index,
    );
  });
});
