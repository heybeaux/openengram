/**
 * Tests for the repository INDEX.md writer (EC-14).
 *
 * Verifies that the index links to every card via a working relative path,
 * sorts by kind then concept, and that the linked files actually exist on
 * disk after both writers run.
 */

import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';

import { writeRepoIndex } from './index-writer';
import { Card } from './types';
import { writeCard } from './writer';

describe('v2 markdown repo index writer', () => {
  let workdir: string;

  beforeEach(() => {
    workdir = mkdtempSync(join(tmpdir(), 'engram-code-'));
  });

  afterEach(() => {
    rmSync(workdir, { recursive: true, force: true });
  });

  const baseLod = {
    index: 'one-liner',
    summary: 'short paragraph',
    standard: 'standard tier',
    deep: 'deep tier',
  };

  const cards: Card[] = [
    {
      conceptPath: 'engram',
      kind: 'repository',
      lod: baseLod,
      metadata: { hash: '111' },
    },
    {
      conceptPath: 'engram/ingestion',
      kind: 'subsystem',
      lod: baseLod,
      metadata: { hash: '222' },
    },
    {
      conceptPath: 'engram/ingestion/parsers/typescript',
      kind: 'module',
      lod: baseLod,
      metadata: { hash: '333' },
    },
  ];

  it('writes INDEX.md with a row per card and a working relative link', async () => {
    for (const c of cards) await writeCard(workdir, c);
    const indexPath = await writeRepoIndex(workdir, {
      name: 'engram-code',
      cards,
    });

    expect(indexPath).toBe(join(workdir, 'INDEX.md'));
    const raw = readFileSync(indexPath, 'utf8');

    expect(raw).toContain('# engram-code');
    expect(raw).toContain('Generated index of 3 cards');
    expect(raw).toContain('| Concept | Kind | Link |');
    for (const c of cards) {
      expect(raw).toContain(`\`${c.conceptPath}\``);
      expect(raw).toContain(c.kind);
    }

    // Each linked file path resolves to a real card on disk.
    const linkRe = /\]\(([^)]+)\)/g;
    let m: RegExpExecArray | null;
    const links: string[] = [];
    while ((m = linkRe.exec(raw)) !== null) links.push(m[1]);
    expect(links.length).toBe(cards.length);
    for (const link of links) {
      const abs = resolve(dirname(indexPath), link);
      expect(existsSync(abs)).toBe(true);
    }
  });

  it('orders rows by kind (repository → subsystem → module → capability) then conceptPath', async () => {
    const shuffled: Card[] = [
      {
        conceptPath: 'z/capability',
        kind: 'capability',
        lod: baseLod,
        metadata: {},
      },
      { conceptPath: 'a/module', kind: 'module', lod: baseLod, metadata: {} },
      { conceptPath: 'repo', kind: 'repository', lod: baseLod, metadata: {} },
      {
        conceptPath: 'b/subsystem',
        kind: 'subsystem',
        lod: baseLod,
        metadata: {},
      },
    ];
    for (const c of shuffled) await writeCard(workdir, c);
    const indexPath = await writeRepoIndex(workdir, {
      name: 'demo',
      cards: shuffled,
    });
    const raw = readFileSync(indexPath, 'utf8');

    const order = ['repo', 'b/subsystem', 'a/module', 'z/capability'];
    let last = -1;
    for (const concept of order) {
      const at = raw.indexOf(`\`${concept}\``);
      expect(at).toBeGreaterThan(last);
      last = at;
    }
  });

  it('handles an empty card list with a friendly placeholder', async () => {
    const indexPath = await writeRepoIndex(workdir, {
      name: 'empty-repo',
      cards: [],
    });
    const raw = readFileSync(indexPath, 'utf8');
    expect(raw).toContain('# empty-repo');
    expect(raw).toContain('Generated index of 0 cards');
    expect(raw).toContain('_No cards yet._');
    expect(raw).not.toContain('| Concept |');
  });

  it('uses forward-slash links regardless of host OS', async () => {
    const card = cards[2]; // nested
    await writeCard(workdir, card);
    const indexPath = await writeRepoIndex(workdir, {
      name: 'slash-check',
      cards: [card],
    });
    const raw = readFileSync(indexPath, 'utf8');
    expect(raw).toContain('](cards/engram/ingestion/parsers/typescript.md)');
    expect(raw).not.toMatch(/\]\(cards\\/); // no Windows backslash
  });
});
