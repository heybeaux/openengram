/**
 * Round-trip + edge-case tests for the markdown card writer (EC-14).
 *
 * Tests live under `src/` because the repo's Jest config sets `rootDir:
 * "src"` (see EC-8 spec for the rationale). Each test gets its own tmpdir
 * so they can run in parallel without colliding.
 */

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Card } from './types';
import { readCard, writeCard } from './writer';

describe('v2 markdown card writer', () => {
  let workdir: string;

  beforeEach(() => {
    workdir = mkdtempSync(join(tmpdir(), 'engram-code-'));
  });

  afterEach(() => {
    rmSync(workdir, { recursive: true, force: true });
  });

  function sampleCard(overrides: Partial<Card> = {}): Card {
    return {
      conceptPath: 'engram/ingestion/parsers/typescript',
      kind: 'module',
      lod: {
        index: 'Tree-sitter based TypeScript parser.',
        summary:
          'Walks a TypeScript AST via tree-sitter and emits structural nodes and edges for the v2 pipeline.',
        standard:
          'The TypeScript extractor wraps tree-sitter-typescript and produces a `ParseResult` with nodes for modules, classes, functions, methods, imports, exports, and calls. Edges of types `contains`, `imports`, and `calls` capture inter-symbol structure. Errors are surfaced via `parseErrors` rather than thrown.',
        deep: 'Implementation notes: handles both .ts and .tsx via two distinct grammars; class methods inherit the class as `parent`; default exports surface as both an `export` node and a flag on the underlying symbol; import nodes record the resolved module specifier verbatim and the imported symbol set; tree-sitter parse errors are captured as a single string in `parseErrors`.',
      },
      metadata: {
        generated_at: '2026-05-24T20:00:00Z',
        model: 'claude-sonnet-4-6',
        hash: 'abc123',
        sources: ['src/ingestion/parsers/typescript.parser.ts'],
      },
      ...overrides,
    };
  }

  it('writes a card under <rootDir>/cards/<conceptPath>.md and returns the absolute path', async () => {
    const card = sampleCard();
    const written = await writeCard(workdir, card);

    expect(written).toBe(
      join(workdir, 'cards', 'engram/ingestion/parsers/typescript.md'),
    );
    const raw = readFileSync(written, 'utf8');
    expect(raw.startsWith('---\n')).toBe(true);
    expect(raw).toContain('conceptPath: engram/ingestion/parsers/typescript');
    expect(raw).toContain('kind: module');
    expect(raw).toContain('## index');
    expect(raw).toContain('## summary');
    expect(raw).toContain('## standard');
    expect(raw).toContain('## deep');
  });

  it('round-trips a simple card via writeCard + readCard', async () => {
    const card = sampleCard();
    const path = await writeCard(workdir, card);
    const got = await readCard(path);
    expect(got).toEqual(card);
  });

  it('creates nested concept-path directories as needed', async () => {
    const card = sampleCard({
      conceptPath: 'deeply/nested/path/to/some/capability',
      kind: 'capability',
    });
    const path = await writeCard(workdir, card);
    const got = await readCard(path);
    expect(got.conceptPath).toBe('deeply/nested/path/to/some/capability');
    expect(got.kind).toBe('capability');
  });

  it('preserves special characters in LoD content (colons, quotes, code fences, unicode)', async () => {
    const card = sampleCard({
      conceptPath: 'engram/edge-cases',
      lod: {
        index: 'Edge: cases — including "quotes" and emoji 🦑.',
        summary:
          'Contains a markdown code fence:\n\n```ts\nconst x: number = 1;\n```\n\nAnd a colon: in prose.',
        standard:
          'Multiple\n\nblank\n\n\nlines, and a YAML-looking line:\n  key: value\n  other: thing',
        deep: '## fake heading inside body\n\nShould not confuse the parser because the section parser only matches index|summary|standard|deep.',
      },
    });
    const path = await writeCard(workdir, card);
    const got = await readCard(path);
    expect(got).toEqual(card);
  });

  it('round-trips a card with an empty deep level', async () => {
    const card = sampleCard({
      conceptPath: 'engram/minimal',
      lod: {
        index: 'Minimal card.',
        summary: 'Has only the cheaper levels populated.',
        standard: 'Standard tier present; deep intentionally blank.',
        deep: '',
      },
    });
    const path = await writeCard(workdir, card);
    const got = await readCard(path);
    expect(got).toEqual(card);
    expect(got.lod.deep).toBe('');
  });

  it('round-trips arbitrary metadata including arrays and booleans', async () => {
    const card = sampleCard({
      metadata: {
        generated_at: '2026-05-24T20:00:00Z',
        model: 'claude-opus-4-7',
        hash: 'deadbeef',
        sources: ['src/a.ts', 'src/b/nested.ts', 'src/c with spaces.ts'],
        partial: true,
        token_count: 1842,
      },
    });
    const path = await writeCard(workdir, card);
    const got = await readCard(path);
    expect(got).toEqual(card);
  });

  it('rejects an invalid kind on write', async () => {
    const bad = sampleCard({ kind: 'bogus' as Card['kind'] });
    await expect(writeCard(workdir, bad)).rejects.toThrow(/invalid kind/);
  });

  it('rejects an absolute or traversal conceptPath', async () => {
    await expect(
      writeCard(workdir, sampleCard({ conceptPath: '/abs/path' })),
    ).rejects.toThrow();
    await expect(
      writeCard(workdir, sampleCard({ conceptPath: '../escape' })),
    ).rejects.toThrow();
  });

  it('overwrites an existing card on second write', async () => {
    const first = sampleCard();
    const second = sampleCard({
      lod: { ...first.lod, index: 'New one-liner.' },
    });
    await writeCard(workdir, first);
    const path = await writeCard(workdir, second);
    const got = await readCard(path);
    expect(got.lod.index).toBe('New one-liner.');
  });
});
