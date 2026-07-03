/**
 * Integration test for the EC-39 ingest flow.
 *
 * Drives the full state machine end-to-end with both the git clone and
 * every LLM client mocked. Asserts:
 *   - state machine moves queued → cloning → structure → … → done
 *   - artifacts land at `~/.engram-code/artifacts/<repoId>/`
 *   - re-submitting the same URL while a job is in flight coalesces
 *   - invalid URLs are rejected before queueing
 *   - clone errors surface clean failure kinds (`not-found`, `network`)
 *
 * The artifacts root is rebased onto a tmpdir via env override for the
 * duration of the test so we never touch `~/.engram-code`.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { CloneError, type GitCloneAdapter } from './git-clone.adapter';
import {
  IngestService,
  InvalidUrlError,
} from './ingest.service';
import type { LLMClient, LLMRequest, LLMResponse } from '../llm/openrouter';

/** Lay down a tiny TS source tree at the clone target so structure has something to parse. */
function fixtureCloneAdapter(): GitCloneAdapter {
  return {
    async clone({ targetDir }) {
      mkdirSync(targetDir, { recursive: true });
      mkdirSync(join(targetDir, '.git'), { recursive: true });
      writeFileSync(
        join(targetDir, 'a.ts'),
        'export function hello(): string { return "hi"; }\n',
        'utf8',
      );
      writeFileSync(
        join(targetDir, 'b.ts'),
        'export const VERSION = "1.0";\n// TODO: refactor\n',
        'utf8',
      );
      writeFileSync(
        join(targetDir, 'README.md'),
        '# Fixture\n\nIntegration test repo.\n',
        'utf8',
      );
    },
  };
}

function failingCloneAdapter(kind: 'not-found' | 'network'): GitCloneAdapter {
  return {
    async clone() {
      throw new CloneError(kind, `Simulated ${kind} failure.`);
    },
  };
}

function contractsLlm(): LLMClient {
  return async (req: LLMRequest): Promise<LLMResponse> => {
    const names = Array.from(req.prompt.matchAll(/^\s*-\s+([A-Za-z_][A-Za-z0-9_]*)/gm)).map(
      (m) => m[1],
    );
    const body: Record<string, { description: string; stability: string }> = {};
    for (const n of names) body[n] = { description: `Mock ${n}.`, stability: 'stable' };
    return {
      model: req.model,
      content: '```json\n' + JSON.stringify(body) + '\n```',
      promptTokens: 100,
      completionTokens: 50,
      totalTokens: 150,
    };
  };
}

function gotchasLlm(): LLMClient {
  return async (req: LLMRequest): Promise<LLMResponse> => ({
    model: req.model,
    content:
      '```json\n' +
      JSON.stringify({
        gotchas: [
          {
            kind: 'gotcha',
            title: 'Mocked gotcha',
            body: 'Mock body.',
            evidence: { filePath: 'a.ts', line: 1 },
          },
        ],
      }) +
      '\n```',
    promptTokens: 80,
    completionTokens: 40,
    totalTokens: 120,
  });
}

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
          description: 'Mock description.',
        }) +
        '\n```',
      promptTokens: 90,
      completionTokens: 30,
      totalTokens: 120,
    };
  };
}

function repositoryLlm(): LLMClient {
  return async (req: LLMRequest): Promise<LLMResponse> => ({
    model: req.model,
    content: 'Mock repository body.',
    promptTokens: 200,
    completionTokens: 100,
    totalTokens: 300,
  });
}

describe('IngestService (EC-39a integration)', () => {
  let workdir: string;
  let savedEcHome: string | undefined;

  beforeEach(() => {
    workdir = mkdtempSync(join(tmpdir(), 'engram-ingest-'));
    savedEcHome = process.env.EC_HOME;
    // Pin storage roots under tmpdir. `EC_HOME` is honored by storage.ts;
    // `process.env.HOME` is not enough because Node's `os.homedir()` caches.
    process.env.EC_HOME = join(workdir, '.engram-code');
  });

  afterEach(() => {
    if (savedEcHome === undefined) delete process.env.EC_HOME;
    else process.env.EC_HOME = savedEcHome;
    rmSync(workdir, { recursive: true, force: true });
  });

  function makeService(adapter: GitCloneAdapter = fixtureCloneAdapter()): IngestService {
    return new IngestService(adapter, {
      contractsLlm: contractsLlm(),
      gotchasLlm: gotchasLlm(),
      subsystemLlm: subsystemLlm(),
      repositoryLlm: repositoryLlm(),
    });
  }

  it('drives a submission through queued → ready and persists artifacts', async () => {
    const svc = makeService();
    const { job, coalesced } = svc.submit({
      url: 'https://github.com/heybeaux/engram-code',
    });
    expect(coalesced).toBe(false);
    expect(job.status).toBe('queued');
    expect(job.repoId).toBe('heybeaux__engram-code');

    const finished = await svc.waitForJob(job.id, 30_000);
    if (finished.status !== 'ready') {
      // Surface the failure reason in the assertion message for easier debug.
      throw new Error(
        `Expected ready, got ${finished.status}: ${finished.error ?? '(no error msg)'}`,
      );
    }
    expect(finished.stage).toBe('done');
    expect(finished.progress).toBe(100);
    expect(finished.error).toBeUndefined();
    expect(finished.finishedAt).toBeDefined();

    // Repository card should be written for the dashboard HomeCard to read.
    const cardPath = join(
      workdir,
      '.engram-code',
      'artifacts',
      'heybeaux__engram-code',
      'cards',
      'repository.md',
    );
    if (!existsSync(cardPath)) {
      // Helpful debug: list what got written.
      const { readdirSync } = require('node:fs');
      const root = join(workdir, '.engram-code');
      let actual: string[] = [];
      try {
        actual = readdirSync(join(root, 'artifacts'), { recursive: true }) as string[];
      } catch {
        // Best-effort debug listing only.
      }
      throw new Error(
        `Repository card not at ${cardPath}\nArtifacts tree: ${JSON.stringify(actual, null, 2)}`,
      );
    }
    expect(existsSync(cardPath)).toBe(true);
  }, 60_000);

  it('coalesces duplicate URLs into the same in-flight job', () => {
    const svc = makeService();
    const first = svc.submit({ url: 'https://github.com/heybeaux/engram-code' });
    const second = svc.submit({ url: 'https://github.com/heybeaux/engram-code' });
    expect(second.coalesced).toBe(true);
    expect(second.job.id).toBe(first.job.id);
  });

  it('rejects non-GitHub URLs synchronously', () => {
    const svc = makeService();
    expect(() => svc.submit({ url: 'https://example.com/foo/bar' })).toThrow(
      InvalidUrlError,
    );
    expect(() => svc.submit({ url: 'not a url' })).toThrow(InvalidUrlError);
  });

  it('classifies a 404 clone failure as `not-found`', async () => {
    const svc = makeService(failingCloneAdapter('not-found'));
    const { job } = svc.submit({ url: 'https://github.com/missing/repo' });
    const finished = await svc.waitForJob(job.id, 10_000);
    expect(finished.status).toBe('failed');
    expect(finished.errorKind).toBe('not-found');
    expect(finished.error).toMatch(/Simulated not-found/);
  });

  it('classifies a network clone failure as `network`', async () => {
    const svc = makeService(failingCloneAdapter('network'));
    const { job } = svc.submit({ url: 'https://github.com/foo/bar' });
    const finished = await svc.waitForJob(job.id, 10_000);
    expect(finished.status).toBe('failed');
    expect(finished.errorKind).toBe('network');
  });

  it('lists recent jobs newest-first', async () => {
    const svc = makeService();
    const a = svc.submit({ url: 'https://github.com/owner/repo-a' });
    // Force the timestamp to differ so list ordering is deterministic.
    await new Promise((r) => setTimeout(r, 5));
    const b = svc.submit({ url: 'https://github.com/owner/repo-b' });

    const listed = svc.list();
    expect(listed.length).toBe(2);
    expect(listed[0].id).toBe(b.job.id);
    expect(listed[1].id).toBe(a.job.id);
  });

  it('allows a new submission for the same repo after a failure', async () => {
    const failing = failingCloneAdapter('not-found');
    const svc = new IngestService(failing, {
      contractsLlm: contractsLlm(),
      gotchasLlm: gotchasLlm(),
      subsystemLlm: subsystemLlm(),
      repositoryLlm: repositoryLlm(),
    });
    const first = svc.submit({ url: 'https://github.com/heybeaux/engram-code' });
    await svc.waitForJob(first.job.id, 10_000);

    const second = svc.submit({ url: 'https://github.com/heybeaux/engram-code' });
    expect(second.coalesced).toBe(false);
    expect(second.job.id).not.toBe(first.job.id);
  });
});

// Avoid unused-import lint when the helper is wired but not directly named.
void mkdirSync;
