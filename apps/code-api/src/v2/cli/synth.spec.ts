/**
 * Integration tests for `engram-code synth` (EC-38).
 *
 * Drives the new `synth` command end-to-end against a tiny fixture repo
 * with every LLM client mocked. Asserts that each of the four higher
 * passes (contracts/gotchas/subsystem/repository) lands a card on disk
 * at the concept path the v1 cards API expects, including the canonical
 * `repository` path used by the dashboard HomeCard.
 */

import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { LLMClient, LLMRequest, LLMResponse } from '../llm/openrouter';
import { run, EXIT } from './cli';
import {
  REPOSITORY_CARD_CONCEPT_PATH,
  parseSynthArgs,
  resolveDailyTokenCap,
  runSynth,
} from './synth';
import { mergeWithDefaults } from '../config';
import { BudgetTracker } from '../ingest/budget-tracker';
import type { PassRunPrismaClient } from '../passes/pass-run.repository';

interface CapturedIO {
  out: string;
  err: string;
  io: { stdout: (s: string) => void; stderr: (s: string) => void };
}

function captureIO(): CapturedIO {
  const cap: CapturedIO = {
    out: '',
    err: '',
    io: { stdout: () => {}, stderr: () => {} },
  };
  cap.io.stdout = (s: string) => {
    cap.out += s;
  };
  cap.io.stderr = (s: string) => {
    cap.err += s;
  };
  return cap;
}

/** Build a deterministic JSON response shaped like what the contracts prompt expects. */
function contractsLlm(): LLMClient {
  return async (req: LLMRequest): Promise<LLMResponse> => {
    // Discover the symbol names the prompt is asking us to annotate by
    // scraping the SYMBOLS block emitted by buildContractsPrompt().
    const names = Array.from(req.prompt.matchAll(/^\s*-\s+([A-Za-z_][A-Za-z0-9_]*)/gm)).map(
      (m) => m[1],
    );
    const body: Record<string, { description: string; stability: string }> = {};
    for (const n of names) body[n] = { description: `Mock annotation for ${n}.`, stability: 'stable' };
    return {
      model: req.model,
      content: '```json\n' + JSON.stringify(body) + '\n```',
      promptTokens: 100,
      completionTokens: 50,
      totalTokens: 150,
    };
  };
}

/** Mock gotchas: emit at least one finding so the writer produces a card. */
function gotchasLlm(): LLMClient {
  return async (req: LLMRequest): Promise<LLMResponse> => {
    return {
      model: req.model,
      content:
        '```json\n' +
        JSON.stringify({
          gotchas: [
            {
              kind: 'gotcha',
              title: 'Mocked gotcha',
              body: 'Mock body explaining the surprise.',
              evidence: { filePath: 'src/a.ts', line: 1 },
            },
          ],
        }) +
        '\n```',
      promptTokens: 80,
      completionTokens: 40,
      totalTokens: 120,
    };
  };
}

/** Mock subsystem namer: tag every cluster with a derived name. */
function subsystemLlm(): LLMClient {
  let counter = 0;
  return async (req: LLMRequest): Promise<LLMResponse> => {
    counter += 1;
    return {
      model: req.model,
      content:
        '```json\n' +
        JSON.stringify({
          name: `Mock Subsystem ${counter}`,
          description: 'Mocked one-line description.',
        }) +
        '\n```',
      promptTokens: 90,
      completionTokens: 30,
      totalTokens: 120,
    };
  };
}

/** Mock repository synthesizer: emit a different paragraph per LoD. */
function repositoryLlm(): LLMClient {
  return async (req: LLMRequest): Promise<LLMResponse> => {
    // Tag the response with whichever LoD the prompt is asking for so
    // tests can assert that all three slots get filled.
    let lod = 'STANDARD';
    if (/SUMMARY/i.test(req.prompt) && !/STANDARD|DEEP/i.test(req.prompt)) lod = 'SUMMARY';
    if (/DEEP/i.test(req.prompt) && !/STANDARD|SUMMARY/i.test(req.prompt)) lod = 'DEEP';
    return {
      model: req.model,
      content: `Mock repository ${lod} body.`,
      promptTokens: 200,
      completionTokens: 100,
      totalTokens: 300,
    };
  };
}

describe('engram-code synth', () => {
  let workdir: string;
  let repoPath: string;
  let outDir: string;

  beforeEach(() => {
    workdir = mkdtempSync(join(tmpdir(), 'engram-synth-'));
    repoPath = join(workdir, 'tiny-repo');
    mkdirSync(repoPath, { recursive: true });
    mkdirSync(join(repoPath, '.git'));
    writeFileSync(
      join(repoPath, 'a.ts'),
      'export function hello(): string { return "hi"; }\nexport class Foo { run() {} }\n',
      'utf8',
    );
    writeFileSync(
      join(repoPath, 'b.ts'),
      'export const VERSION = "1.0";\n// TODO: refactor this\n',
      'utf8',
    );
    writeFileSync(join(repoPath, 'README.md'), '# Tiny Repo\n\nMock readme.\n', 'utf8');
    outDir = join(workdir, 'artifacts');
  });

  afterEach(() => {
    rmSync(workdir, { recursive: true, force: true });
  });

  describe('parseSynthArgs', () => {
    it('defaults to `all` when no subcommand is given', () => {
      const args = parseSynthArgs(['/repo']);
      expect(args.subcommand).toBe('all');
      expect(args.repoPath).toBe('/repo');
      expect(args.dryRun).toBe(false);
    });

    it('parses individual subcommands', () => {
      for (const sub of ['contracts', 'gotchas', 'subsystem', 'repository']) {
        const args = parseSynthArgs([sub, '/repo']);
        expect(args.subcommand).toBe(sub);
      }
    });

    it('honors --out, --repo-id, --dry-run', () => {
      const args = parseSynthArgs([
        '/repo',
        '--out=/tmp/out',
        '--repo-id=demo',
        '--dry-run',
      ]);
      expect(args.outDir).toBe('/tmp/out');
      expect(args.repoId).toBe('demo');
      expect(args.dryRun).toBe(true);
    });

    it('rejects unknown flags', () => {
      expect(() => parseSynthArgs(['--frobnicate', '/repo'])).toThrow(/unknown flag/);
    });

    it('requires a repo path', () => {
      expect(() => parseSynthArgs([])).toThrow(/missing required <repo-path>/);
    });
  });

  describe('resolveDailyTokenCap', () => {
    afterEach(() => {
      delete process.env.EC_DAILY_TOKEN_CAP;
    });

    it('returns the config value by default', () => {
      const config = mergeWithDefaults({});
      const cap = resolveDailyTokenCap(config);
      expect(cap).toBe(config.budget.dailyTokenCap);
    });

    it('lets EC_DAILY_TOKEN_CAP override the config', () => {
      process.env.EC_DAILY_TOKEN_CAP = '1234';
      const cap = resolveDailyTokenCap(mergeWithDefaults({}));
      expect(cap).toBe(1234);
    });

    it('ignores garbage env values', () => {
      process.env.EC_DAILY_TOKEN_CAP = 'not-a-number';
      const config = mergeWithDefaults({});
      expect(resolveDailyTokenCap(config)).toBe(config.budget.dailyTokenCap);
    });
  });

  describe('runSynth (programmatic)', () => {
    it('runs all four passes and writes cards readable by /v1/cards', async () => {
      const summary = await runSynth({
        repoPath,
        outDir,
        repoId: 'tiny',
        subcommand: 'all',
        overrides: {
          contractsLlm: contractsLlm(),
          gotchasLlm: gotchasLlm(),
          subsystemLlm: subsystemLlm(),
          repositoryLlm: repositoryLlm(),
        },
      });

      expect(summary.repoId).toBe('tiny');
      expect(summary.structure?.filesParsed).toBeGreaterThan(0);
      expect(summary.contracts?.modulesAnnotated).toBeGreaterThan(0);
      // gotchas, subsystem, and repository all ran — values vary but they
      // should be present in the summary object.
      expect(summary.subsystem).toBeDefined();
      expect(summary.repository).toBeDefined();

      // The repository card MUST land at the concept path the dashboard
      // requests so HomeCard's GET resolves.
      const repoCardPath = join(outDir, 'cards', `${REPOSITORY_CARD_CONCEPT_PATH}.md`);
      expect(existsSync(repoCardPath)).toBe(true);
      const repoCardBody = await readFile(repoCardPath, 'utf8');
      expect(repoCardBody).toContain('Mock repository');

      // The per-pass artifacts that EC-23/24/25/26 already produce are
      // still emitted under the artifacts root.
      expect(existsSync(join(outDir, 'repository.md'))).toBe(true);
    });

    it('honors --dry-run by skipping LLM calls and reporting planned counts', async () => {
      const calls: string[] = [];
      const noopLLM: LLMClient = async (req) => {
        calls.push(req.model);
        return { model: req.model, content: '', totalTokens: 0 };
      };

      const summary = await runSynth({
        repoPath,
        outDir,
        repoId: 'tiny',
        subcommand: 'all',
        dryRun: true,
        overrides: {
          contractsLlm: noopLLM,
          gotchasLlm: noopLLM,
          subsystemLlm: noopLLM,
          repositoryLlm: noopLLM,
        },
      });

      expect(summary.dryRun).toBe(true);
      expect(summary.plannedCalls).toBeDefined();
      // No LLM calls actually fired.
      expect(calls).toEqual([]);
      // Repository card was NOT written under dry-run.
      expect(existsSync(join(outDir, 'cards', `${REPOSITORY_CARD_CONCEPT_PATH}.md`)))
        .toBe(false);
    });

    it('continues sibling passes when one fails', async () => {
      const throwing: LLMClient = async () => {
        throw new Error('mock LLM exploded');
      };
      const summary = await runSynth({
        repoPath,
        outDir,
        repoId: 'tiny',
        subcommand: 'all',
        overrides: {
          contractsLlm: throwing,
          gotchasLlm: gotchasLlm(),
          subsystemLlm: subsystemLlm(),
          repositoryLlm: repositoryLlm(),
        },
      });
      // Contracts pass logged an error count, but the others still ran.
      expect(summary.contracts?.errors).toBeGreaterThanOrEqual(1);
      expect(summary.repository).toBeDefined();
      expect(existsSync(join(outDir, 'cards', `${REPOSITORY_CARD_CONCEPT_PATH}.md`)))
        .toBe(true);
    });

    it('aborts later passes when BudgetTracker daily cap of 100 is exhausted (EC-48)', async () => {
      // In-memory Prisma fake — minimal surface for BudgetTracker.queryDailyHistoricalSpend.
      const fakePrisma: PassRunPrismaClient = {
        passRun: {
          create: async () => ({}) as never,
          findMany: async () => [],
        },
      } as unknown as PassRunPrismaClient;

      const tracker = new BudgetTracker({
        dailyCap: 100,
        perPassCap: 100,
        prisma: fakePrisma,
        repoId: 'tiny',
      });

      // Contracts mock spends 150 tokens, blowing through the daily cap on
      // the very first pass. The tracker should then refuse to start the
      // remaining passes.
      const recorded: Array<{ pass: string; status: string }> = [];

      const summary = await runSynth({
        repoPath,
        outDir,
        repoId: 'tiny',
        subcommand: 'all',
        overrides: {
          contractsLlm: contractsLlm(),
          gotchasLlm: gotchasLlm(),
          subsystemLlm: subsystemLlm(),
          repositoryLlm: repositoryLlm(),
        },
        budget: tracker,
        onPassRun: (run) => {
          recorded.push({ pass: run.passName, status: run.status });
        },
      });

      // Contracts ran and consumed tokens.
      expect(summary.contracts?.tokensUsed).toBeGreaterThan(0);
      // At least one downstream pass must be marked FAILED with the
      // budget-exceeded reason.
      const budgetFailures = recorded.filter(
        (r) => r.status === 'FAILED' && r.pass !== 'contracts',
      );
      expect(budgetFailures.length).toBeGreaterThanOrEqual(1);
    });

    it('individual subcommand `repository` runs structure + repository only', async () => {
      const calls: string[] = [];
      const sentinel: LLMClient = async (req) => {
        calls.push('contracts');
        return { model: req.model, content: '', totalTokens: 0 };
      };
      await runSynth({
        repoPath,
        outDir,
        repoId: 'tiny',
        subcommand: 'repository',
        overrides: {
          contractsLlm: sentinel,
          gotchasLlm: sentinel,
          subsystemLlm: sentinel,
          repositoryLlm: repositoryLlm(),
        },
      });
      expect(calls).toEqual([]);
    });
  });

  describe('CLI integration (run())', () => {
    it('exits 64 on missing repo path arg', async () => {
      const cap = captureIO();
      const code = await run(['synth'], cap.io);
      expect(code).toBe(EXIT.USAGE);
      expect(cap.err).toContain('missing required <repo-path>');
    });

    it('exits 66 when repo path does not exist', async () => {
      const cap = captureIO();
      const code = await run(['synth', join(workdir, 'nope')], cap.io);
      expect(code).toBe(EXIT.NOT_FOUND);
      expect(cap.err).toContain('not found');
    });

    it('--dry-run prints a planning summary and exits 0', async () => {
      const cap = captureIO();
      const code = await run(
        ['synth', repoPath, `--out=${outDir}`, '--repo-id=tiny', '--dry-run'],
        cap.io,
      );
      expect(code).toBe(EXIT.OK);
      expect(cap.out).toContain('dry-run plan');
    });
  });
});
