/**
 * Tests for the engram-code v2 CLI (EC-16).
 *
 * Drives the `run()` entrypoint directly with a captured-IO harness so we
 * can assert on stdout/stderr without spawning a subprocess. Each test gets
 * its own tmpdir for artifacts; the `index` test fakes the structure pass
 * via fixture files (TS source) so we exercise the real walker + parser
 * harness end-to-end.
 */

import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { run, EXIT, buildStubCards } from './cli';
import { writeCard } from '../writers/markdown/writer';
import type { Card } from '../writers/markdown/types';
import type { StructurePassResult } from '../passes/structure/orchestrator';

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

describe('engram-code CLI', () => {
  let workdir: string;

  beforeEach(() => {
    workdir = mkdtempSync(join(tmpdir(), 'engram-cli-'));
  });

  afterEach(() => {
    rmSync(workdir, { recursive: true, force: true });
  });

  describe('top-level dispatch', () => {
    it('prints usage and exits 64 with no command', async () => {
      const cap = captureIO();
      const code = await run([], cap.io);
      expect(code).toBe(EXIT.USAGE);
      expect(cap.out).toContain('engram-code');
      expect(cap.out).toContain('Usage:');
    });

    it('prints usage and exits 0 with --help', async () => {
      const cap = captureIO();
      const code = await run(['--help'], cap.io);
      expect(code).toBe(EXIT.OK);
      expect(cap.out).toContain('Usage:');
    });

    it('rejects unknown commands with exit 64', async () => {
      const cap = captureIO();
      const code = await run(['frobnicate'], cap.io);
      expect(code).toBe(EXIT.USAGE);
      expect(cap.err).toContain('unknown command "frobnicate"');
    });
  });

  describe('cards command', () => {
    beforeEach(async () => {
      const card: Card = {
        conceptPath: 'sample/module',
        kind: 'module',
        lod: {
          index: 'INDEX-BODY',
          summary: 'SUMMARY-BODY',
          standard: 'STANDARD-BODY',
          deep: 'DEEP-BODY',
        },
        metadata: { model: 'stub' },
      };
      await writeCard(workdir, card);
    });

    it('prints the summary LoD by default', async () => {
      const cap = captureIO();
      const code = await run(
        ['cards', 'sample/module', `--root=${workdir}`],
        cap.io,
      );
      expect(code).toBe(EXIT.OK);
      expect(cap.out.trim()).toBe('SUMMARY-BODY');
    });

    it('honors --lod=deep', async () => {
      const cap = captureIO();
      const code = await run(
        ['cards', 'sample/module', '--lod=deep', `--root=${workdir}`],
        cap.io,
      );
      expect(code).toBe(EXIT.OK);
      expect(cap.out.trim()).toBe('DEEP-BODY');
    });

    it('exits 66 for a missing card', async () => {
      const cap = captureIO();
      const code = await run(
        ['cards', 'nope/missing', `--root=${workdir}`],
        cap.io,
      );
      expect(code).toBe(EXIT.NOT_FOUND);
      expect(cap.err).toContain('not found');
    });

    it('rejects an invalid --lod with exit 64', async () => {
      const cap = captureIO();
      const code = await run(
        ['cards', 'sample/module', '--lod=novel', `--root=${workdir}`],
        cap.io,
      );
      expect(code).toBe(EXIT.USAGE);
      expect(cap.err).toContain('invalid --lod=novel');
    });

    it('requires a concept path', async () => {
      const cap = captureIO();
      const code = await run(['cards'], cap.io);
      expect(code).toBe(EXIT.USAGE);
      expect(cap.err).toContain('missing required <conceptPath>');
    });
  });

  describe('index command', () => {
    it('exits 66 for a missing repo path', async () => {
      const cap = captureIO();
      const code = await run(
        ['index', join(workdir, 'does-not-exist')],
        cap.io,
      );
      expect(code).toBe(EXIT.NOT_FOUND);
      expect(cap.err).toContain('repo path not found');
    });

    it('requires a repo path', async () => {
      const cap = captureIO();
      const code = await run(['index'], cap.io);
      expect(code).toBe(EXIT.USAGE);
      expect(cap.err).toContain('missing required <repo-path>');
    });

    describe('parse-error reporting (EC-19)', () => {
      // The TS extractor recovers from syntax errors and pushes one or more
      // entries onto `parseErrors`; we lean on that real behavior here so the
      // CLI's reporting path is exercised end-to-end through `runStructurePass`.
      function buildBrokenRepo(): { repoPath: string; outDir: string } {
        const repoPath = join(workdir, 'broken-repo');
        mkdirSync(repoPath, { recursive: true });
        writeFileSync(
          join(repoPath, 'broken.ts'),
          'function broken(x: number {\n  return ;\n',
          'utf8',
        );
        return { repoPath, outDir: join(workdir, 'broken-artifacts') };
      }

      it('prints one parse-error line per file by default', async () => {
        const { repoPath, outDir } = buildBrokenRepo();
        const cap = captureIO();
        const code = await run(
          ['index', repoPath, `--out=${outDir}`, '--repo-id=broken'],
          cap.io,
        );
        expect(code).toBe(EXIT.OK);
        expect(cap.err).toMatch(/parse-error broken\.ts:/);
        // Summary tally is preserved alongside the per-file detail.
        expect(cap.err).toMatch(/file\(s\) had parse errors/);
      });

      it('--quiet suppresses per-file lines but keeps the summary', async () => {
        const { repoPath, outDir } = buildBrokenRepo();
        const cap = captureIO();
        const code = await run(
          ['index', repoPath, `--out=${outDir}`, '--repo-id=broken', '--quiet'],
          cap.io,
        );
        expect(code).toBe(EXIT.OK);
        expect(cap.err).not.toMatch(/parse-error broken\.ts/);
        expect(cap.err).toMatch(/file\(s\) had parse errors/);
      });

      it('--verbose includes the parser id on each line', async () => {
        const { repoPath, outDir } = buildBrokenRepo();
        const cap = captureIO();
        const code = await run(
          ['index', repoPath, `--out=${outDir}`, '--repo-id=broken', '--verbose'],
          cap.io,
        );
        expect(code).toBe(EXIT.OK);
        expect(cap.err).toMatch(/parse-error \[typescript\] broken\.ts:/);
      });

      it('rejects --quiet and --verbose together', async () => {
        const { repoPath, outDir } = buildBrokenRepo();
        const cap = captureIO();
        const code = await run(
          [
            'index',
            repoPath,
            `--out=${outDir}`,
            '--repo-id=broken',
            '--quiet',
            '--verbose',
          ],
          cap.io,
        );
        expect(code).toBe(EXIT.USAGE);
        expect(cap.err).toContain('mutually exclusive');
      });
    });

    it('walks a repo and writes stub cards + INDEX.md', async () => {
      // Build a tiny TS repo. We only need enough source to produce at
      // least one structural node; the structure pass picks it up via
      // the parser registry.
      const repoPath = join(workdir, 'tiny-repo');
      mkdirSync(repoPath, { recursive: true });
      writeFileSync(
        join(repoPath, 'a.ts'),
        'export function hello() { return 1; }\nexport class Foo {}\n',
        'utf8',
      );
      const outDir = join(workdir, 'artifacts');

      const cap = captureIO();
      const code = await run(
        ['index', repoPath, `--out=${outDir}`, '--repo-id=tiny'],
        cap.io,
      );

      expect(code).toBe(EXIT.OK);
      expect(cap.out).toContain('engram-code: indexing');
      expect(cap.out).toMatch(/walked \d+ files/);
      expect(cap.out).toContain('wrote');
      expect(existsSync(join(outDir, 'INDEX.md'))).toBe(true);
      expect(existsSync(join(outDir, 'cards', 'a.md'))).toBe(true);
    });
  });

  describe('buildStubCards', () => {
    it('emits one card per file with deterministic content', () => {
      const result: StructurePassResult = {
        repoId: 'demo',
        repoPath: '/tmp/demo',
        filesWalked: 1,
        filesParsed: 1,
        fileErrors: [],
        nodes: [
          {
            kind: 'function',
            name: 'hello',
            filePath: 'src/a.ts',
            startLine: 1,
            endLine: 3,
          },
          {
            kind: 'class',
            name: 'Foo',
            filePath: 'src/a.ts',
            startLine: 5,
            endLine: 7,
          },
        ],
        edges: [],
      };
      const cards = buildStubCards(result, 'demo');
      expect(cards).toHaveLength(1);
      expect(cards[0].conceptPath).toBe('src/a');
      expect(cards[0].kind).toBe('module');
      expect(cards[0].lod.summary).toContain('function hello');
      expect(cards[0].lod.standard).toContain('Symbols:');
      expect(cards[0].lod.deep).toContain('class `Foo`');
      expect(cards[0].metadata.repo_id).toBe('demo');
    });

    it('skips paths with .. segments to stay writer-safe', () => {
      const result: StructurePassResult = {
        repoId: 'demo',
        repoPath: '/tmp/demo',
        filesWalked: 1,
        filesParsed: 1,
        fileErrors: [],
        nodes: [
          {
            kind: 'function',
            name: 'evil',
            filePath: '../escape.ts',
            startLine: 1,
            endLine: 2,
          },
        ],
        edges: [],
      };
      const cards = buildStubCards(result, 'demo');
      expect(cards).toHaveLength(0);
    });
  });

  describe('config command (EC-27)', () => {
    it('config show prints resolved defaults when no config file exists', async () => {
      const cap = captureIO();
      mkdirSync(join(workdir, '.git'));
      const code = await run(['config', 'show', workdir], cap.io);
      expect(code).toBe(EXIT.OK);
      expect(cap.out).toContain('<built-in defaults>');
      expect(cap.out).toContain('"passes"');
      expect(cap.out).toContain('"intent"');
    });

    it('config show surfaces values from .engram/config.yaml', async () => {
      const cap = captureIO();
      mkdirSync(join(workdir, '.git'));
      mkdirSync(join(workdir, '.engram'));
      writeFileSync(
        join(workdir, '.engram', 'config.yaml'),
        'passes:\n  intent:\n    model: custom/intent-model\n',
        'utf8',
      );
      const code = await run(['config', 'show', workdir], cap.io);
      expect(code).toBe(EXIT.OK);
      expect(cap.out).toContain('config.yaml');
      expect(cap.out).toContain('"custom/intent-model"');
    });

    it('config show exits with 70 on malformed config', async () => {
      const cap = captureIO();
      mkdirSync(join(workdir, '.git'));
      mkdirSync(join(workdir, '.engram'));
      writeFileSync(
        join(workdir, '.engram', 'config.yaml'),
        'passes:\n  intent:\n    bogus: yes\n',
        'utf8',
      );
      const code = await run(['config', 'show', workdir], cap.io);
      expect(code).toBe(EXIT.RUNTIME);
      expect(cap.err).toContain('invalid config');
    });

    it('config show rejects unknown subcommands', async () => {
      const cap = captureIO();
      const code = await run(['config', 'wat'], cap.io);
      expect(code).toBe(EXIT.USAGE);
      expect(cap.err).toContain('unknown subcommand');
    });

    it('config show errors when repo path does not exist', async () => {
      const cap = captureIO();
      const missing = join(workdir, 'definitely-missing');
      const code = await run(['config', 'show', missing], cap.io);
      expect(code).toBe(EXIT.NOT_FOUND);
      expect(cap.err).toContain('repo path not found');
    });
  });
});
