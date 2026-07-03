/**
 * Tests for the repository-synthesis orchestrator (EC-26).
 */

import type { LLMClient } from '../../llm/openrouter';
import { approxTokenCount } from '../synthesis.pass';

import type { RepositoryInput } from './gatherer';
import {
  buildIndexLine,
  fallbackBody,
  persistRepositoryPass,
  REPOSITORY_DEFAULT_MODEL,
  repositoryConceptPath,
  runRepositoryPass,
  type RepositoryPersistClient,
} from './orchestrator';

function input(over: Partial<RepositoryInput> = {}): RepositoryInput {
  return {
    metadata: {
      name: 'engram-code',
      languages: ['typescript'],
      topLevelDirs: ['src', 'prisma'],
      readme: 'README content here.',
      ...(over.metadata ?? {}),
    },
    subsystems: over.subsystems ?? [
      {
        name: 'Auth',
        slug: 'auth',
        description: 'Handles login.',
        memberModulePaths: ['src/auth', 'src/session'],
        standardCard: '## Auth\n\nOwns login + tokens.',
      },
      {
        name: 'Ingestion',
        slug: 'ingestion',
        description: 'Owns parsing.',
        memberModulePaths: ['src/ingest'],
        standardCard: '## Ingestion\n\nParses repos.',
      },
    ],
  };
}

/**
 * LLM stub that echoes the requested LoD into the body and reports a fixed
 * token cost. The body embeds the prompt's lead instruction so the test can
 * assert each LoD got its own prompt.
 */
const echoLLM: LLMClient = async (req) => {
  const lodMatch = req.prompt.match(/Write the (SUMMARY|STANDARD|DEEP)/);
  const lod = lodMatch ? lodMatch[1] : 'X';
  return {
    model: req.model,
    content: `Synthesized ${lod} body for repository. ` +
      `Mentions Auth and Ingestion subsystems.`,
    totalTokens: 200,
  };
};

describe('repositoryConceptPath', () => {
  it('namespaces by repo id', () => {
    expect(repositoryConceptPath('engram-code')).toBe('engram-code/repository');
  });
});

describe('buildIndexLine', () => {
  it('emits a deterministic one-liner', () => {
    const line = buildIndexLine('engram-code', input());
    expect(line).toContain('engram-code');
    expect(line).toContain('2 subsystems');
    expect(line).toContain('typescript');
  });

  it('handles zero subsystems with correct pluralization', () => {
    const line = buildIndexLine(
      'r',
      input({ subsystems: [] }),
    );
    expect(line).toContain('0 subsystems');
  });

  it('handles one subsystem (singular)', () => {
    const line = buildIndexLine(
      'r',
      input({
        subsystems: [
          {
            name: 'Solo',
            slug: 'solo',
            memberModulePaths: ['src/solo'],
          },
        ],
      }),
    );
    expect(line).toContain('1 subsystem,');
  });
});

describe('fallbackBody', () => {
  it('produces a deterministic body for each LoD', () => {
    const summary = fallbackBody('summary', input(), 'r');
    const standard = fallbackBody('standard', input(), 'r');
    const deep = fallbackBody('deep', input(), 'r');
    expect(summary).toContain('deterministic fallback');
    expect(standard).toContain('Auth');
    expect(deep).toContain('## Overview');
    expect(deep).toContain('## Subsystems');
  });

  it('respects the per-LoD budget', () => {
    const body = fallbackBody('summary', input(), 'r');
    expect(approxTokenCount(body)).toBeLessThanOrEqual(100);
  });
});

describe('runRepositoryPass', () => {
  it('produces all four LoD cards at level=REPOSITORY', async () => {
    const result = await runRepositoryPass('engram-code', input(), {
      llm: echoLLM,
      quietWarnings: true,
    });

    expect(result.cards).toHaveLength(4);
    const lods = result.cards.map((c) => c.lod).sort();
    expect(lods).toEqual(['DEEP', 'INDEX', 'STANDARD', 'SUMMARY']);

    for (const card of result.cards) {
      expect(card.level).toBe('REPOSITORY');
      expect(card.sourcePass).toBe('synthesis-repository');
      expect(card.conceptPath).toBe('engram-code/repository');
      expect(card.content.length).toBeGreaterThan(0);
    }
  });

  it('calls the LLM for summary/standard/deep, not index', async () => {
    const calls: Array<{ maxOutputTokens?: number; prompt: string }> = [];
    const recording: LLMClient = async (req) => {
      calls.push({ maxOutputTokens: req.maxOutputTokens, prompt: req.prompt });
      return echoLLM(req);
    };
    await runRepositoryPass('r', input(), {
      llm: recording,
      quietWarnings: true,
    });
    expect(calls).toHaveLength(3);
    const budgets = calls.map((c) => c.maxOutputTokens).sort((a, b) => (a ?? 0) - (b ?? 0));
    expect(budgets).toEqual([100, 500, 2000]);
  });

  it('uses the deterministic index line for the INDEX card', async () => {
    const result = await runRepositoryPass('engram-code', input(), {
      llm: echoLLM,
      quietWarnings: true,
    });
    const indexCard = result.cards.find((c) => c.lod === 'INDEX')!;
    expect(indexCard.content).toContain('engram-code');
    expect(indexCard.content).toContain('2 subsystems');
  });

  it('respects per-LoD token budgets in card content', async () => {
    const verbose: LLMClient = async (req) => ({
      model: req.model,
      content: 'x'.repeat(20_000),
      totalTokens: 100,
    });
    const result = await runRepositoryPass('r', input(), {
      llm: verbose,
      quietWarnings: true,
    });
    const summary = result.cards.find((c) => c.lod === 'SUMMARY')!;
    const standard = result.cards.find((c) => c.lod === 'STANDARD')!;
    const deep = result.cards.find((c) => c.lod === 'DEEP')!;
    expect(approxTokenCount(summary.content)).toBeLessThanOrEqual(100);
    expect(approxTokenCount(standard.content)).toBeLessThanOrEqual(500);
    expect(approxTokenCount(deep.content)).toBeLessThanOrEqual(2000);
  });

  it('falls back deterministically per-LoD on LLM error without aborting', async () => {
    let count = 0;
    const flaky: LLMClient = async (req) => {
      count += 1;
      if (count === 2) throw new Error('boom');
      return echoLLM(req);
    };
    const result = await runRepositoryPass('r', input(), {
      llm: flaky,
      quietWarnings: true,
    });
    expect(result.cards).toHaveLength(4);
    const errored = result.lods.find((l) => l.errorMessage === 'boom');
    expect(errored).toBeDefined();
    expect(errored?.fallback).toBe(true);
    // Other LoDs still succeed.
    const successes = result.lods.filter((l) => !l.fallback && l.lod !== 'INDEX');
    expect(successes.length).toBeGreaterThan(0);
    expect(result.passRun.status).toBe('SUCCESS');
  });

  it('marks pass FAILED only when every LLM call fails', async () => {
    const dead: LLMClient = async () => {
      throw new Error('nope');
    };
    const result = await runRepositoryPass('r', input(), {
      llm: dead,
      quietWarnings: true,
    });
    expect(result.passRun.status).toBe('FAILED');
    // Cards still produced via fallback bodies — never leave the repo without a card.
    expect(result.cards).toHaveLength(4);
    for (const card of result.cards) {
      expect(card.content.length).toBeGreaterThan(0);
    }
  });

  it('falls back deterministically when runTokenCap is exhausted mid-run', async () => {
    const result = await runRepositoryPass('r', input(), {
      llm: echoLLM,
      runTokenCap: 100, // first call uses 200 tokens; subsequent LoDs fall back
      quietWarnings: true,
    });
    const fallbacks = result.lods.filter((l) => l.fallback);
    expect(fallbacks.length).toBeGreaterThan(0);
    const budgetExhausted = result.lods.filter(
      (l) => l.errorMessage === 'run-token-cap-exceeded',
    );
    expect(budgetExhausted.length).toBeGreaterThan(0);
  });

  it('uses Opus as the default model', async () => {
    const calls: string[] = [];
    const llm: LLMClient = async (req) => {
      calls.push(req.model);
      return echoLLM(req);
    };
    await runRepositoryPass('r', input(), { llm, quietWarnings: true });
    expect(calls.every((m) => m === REPOSITORY_DEFAULT_MODEL)).toBe(true);
    expect(REPOSITORY_DEFAULT_MODEL).toContain('opus');
  });

  it('warns when raw input exceeds the budget', async () => {
    const warnings: Array<{ message: string }> = [];
    const huge: RepositoryInput = {
      metadata: {
        name: 'r',
        languages: ['ts'],
        topLevelDirs: ['src'],
        readme: 'x'.repeat(20_000),
      },
      subsystems: Array.from({ length: 50 }, (_, i) => ({
        name: `S${i}`,
        slug: `s${i}`,
        memberModulePaths: [`src/${i}`],
        standardCard: 'card '.repeat(200),
      })),
    };
    await runRepositoryPass('r', huge, {
      llm: echoLLM,
      onWarning: (message) => warnings.push({ message }),
    });
    expect(warnings.some((w) => w.message.includes('exceeds budget'))).toBe(true);
  });

  it('treats an empty LLM response as a fallback', async () => {
    const empty: LLMClient = async (req) => ({
      model: req.model,
      content: '   \n  ',
      totalTokens: 50,
    });
    const result = await runRepositoryPass('r', input(), {
      llm: empty,
      quietWarnings: true,
    });
    const fallbacks = result.lods.filter((l) => l.fallback);
    expect(fallbacks.length).toBe(3); // summary + standard + deep
    expect(fallbacks.every((l) => l.errorMessage === 'empty-response')).toBe(true);
  });

  it('produces a coherent repository card from a fixture mini-repo', async () => {
    // Exit-criteria check: end-to-end run with a realistic shape.
    const result = await runRepositoryPass(
      'mini-repo',
      {
        metadata: {
          name: 'mini-repo',
          languages: ['typescript', 'python'],
          topLevelDirs: ['src', 'docs', 'tests'],
          readme:
            '# mini-repo\n\nA tiny example repo with two subsystems: auth and search.',
        },
        subsystems: [
          {
            name: 'Auth',
            slug: 'auth',
            description: 'Owns user authentication.',
            memberModulePaths: ['src/auth/login', 'src/auth/session'],
            standardCard:
              '## Subsystem: Auth\n\nResponsible for user login flows, ' +
              'session management, and token issuance.',
          },
          {
            name: 'Search',
            slug: 'search',
            description: 'Owns search indexing.',
            memberModulePaths: ['src/search/index', 'src/search/query'],
            standardCard:
              '## Subsystem: Search\n\nIndexes documents and serves ' +
              'queries via a small ranking pipeline.',
          },
        ],
      },
      { llm: echoLLM, quietWarnings: true },
    );

    // 4 cards, all level=REPOSITORY, all sharing the same conceptPath.
    expect(result.cards).toHaveLength(4);
    const paths = new Set(result.cards.map((c) => c.conceptPath));
    expect(paths.size).toBe(1);
    expect([...paths][0]).toBe('mini-repo/repository');

    // Coherent: the index references the repo name + subsystem count.
    const idx = result.cards.find((c) => c.lod === 'INDEX')!.content;
    expect(idx).toContain('mini-repo');
    expect(idx).toContain('2 subsystems');

    // Pass run accounts the LLM tokens (3 calls × 200 each).
    expect(result.totalTokens).toBe(600);
    expect(result.passRun.passName).toBe('synthesis-repository');
    expect(result.passRun.status).toBe('SUCCESS');
  });
});

// ---------------------------------------------------------------------------
// persistRepositoryPass
// ---------------------------------------------------------------------------

interface Call {
  op: string;
  args: unknown;
}

function makeMockClient(): { client: RepositoryPersistClient; calls: Call[] } {
  const calls: Call[] = [];
  const card = {
    upsert: jest.fn(async (args: unknown) => {
      calls.push({ op: 'card.upsert', args });
      return {};
    }),
  };
  const tx = { card } as unknown as RepositoryPersistClient;
  const $transaction = jest.fn(
    async (fn: (tx: RepositoryPersistClient) => Promise<unknown>) => fn(tx),
  );
  const client = { card, $transaction } as unknown as RepositoryPersistClient;
  return { client, calls };
}

describe('persistRepositoryPass', () => {
  it('upserts all four cards inside one transaction keyed on (repoId, conceptPath, lod)', async () => {
    const { client, calls } = makeMockClient();
    const result = await runRepositoryPass('r', input(), {
      llm: echoLLM,
      quietWarnings: true,
    });
    const stats = await persistRepositoryPass(client, result.cards);

    expect(stats.cardsUpserted).toBe(4);
    expect((client.$transaction as jest.Mock).mock.calls).toHaveLength(1);
    expect(calls.filter((c) => c.op === 'card.upsert')).toHaveLength(4);

    const upsert = calls[0].args as {
      where: { repoId_conceptPath_lod: { conceptPath: string } };
    };
    expect(upsert.where.repoId_conceptPath_lod.conceptPath).toBe('r/repository');
  });

  it('throws when a card is not REPOSITORY-level', async () => {
    const { client } = makeMockClient();
    await expect(
      persistRepositoryPass(client, [
        {
          repoId: 'r',
          conceptPath: 'r/repository',
          lod: 'STANDARD',
          level: 'MODULE',
          content: 'x',
          sourcePass: 'synthesis-repository',
        },
      ]),
    ).rejects.toThrow(/level=REPOSITORY/);
  });

  it('throws when card conceptPaths disagree', async () => {
    const { client } = makeMockClient();
    await expect(
      persistRepositoryPass(client, [
        {
          repoId: 'r',
          conceptPath: 'r/repository',
          lod: 'INDEX',
          level: 'REPOSITORY',
          content: 'x',
          sourcePass: 'synthesis-repository',
        },
        {
          repoId: 'r',
          conceptPath: 'r/other',
          lod: 'SUMMARY',
          level: 'REPOSITORY',
          content: 'y',
          sourcePass: 'synthesis-repository',
        },
      ]),
    ).rejects.toThrow(/conceptPath mismatch/);
  });
});
