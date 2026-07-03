/**
 * Tests for the language-agnostic parser harness.
 *
 * NOTE on file location: the repo's Jest config sets `rootDir: "src"` and
 * `testRegex: ".*\\.spec\\.ts$"`, so specs must live under `src/`. The
 * EC-8 task brief asks for `test/v2/parsers/harness.spec.ts`, but Jest
 * would not discover that path without config changes — and EC-8 explicitly
 * restricts changes to `src/v2/`. Co-locating the spec keeps both
 * constraints satisfied.
 */

import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { parseFile } from './harness';
import { clear, getByLanguage, listLanguages } from './registry';
import { registerStubExtractor } from './stub.extractor';

describe('v2 parser harness', () => {
  let workdir: string;

  beforeEach(() => {
    clear();
    workdir = mkdtempSync(join(tmpdir(), 'ec8-harness-'));
  });

  afterEach(() => {
    clear();
    rmSync(workdir, { recursive: true, force: true });
  });

  describe('with the stub extractor registered', () => {
    beforeEach(() => {
      registerStubExtractor();
    });

    it('registers the stub for .txt and exposes it by language', () => {
      expect(listLanguages()).toContain('text');
      expect(getByLanguage('text')?.extensions).toContain('.txt');
    });

    it('parses a .txt fixture into a well-shaped ParseResult', () => {
      const fixture = join(workdir, 'hello.txt');
      writeFileSync(fixture, 'line one\nline two\nline three\n');

      const result = parseFile(fixture);

      expect(result).not.toBeNull();
      expect(result).toMatchObject({
        filePath: fixture,
        language: 'text',
        edges: [],
        parseErrors: [],
      });
      expect(result!.nodes).toHaveLength(1);
      expect(result!.nodes[0]).toMatchObject({
        kind: 'module',
        name: fixture,
        startLine: 1,
      });
      expect(result!.nodes[0].endLine).toBeGreaterThanOrEqual(1);
    });

    it('returns null for an extension with no registered extractor', () => {
      const fixture = join(workdir, 'unknown.xyz');
      writeFileSync(fixture, 'whatever');
      expect(parseFile(fixture)).toBeNull();
    });

    it('returns null for a missing file rather than throwing', () => {
      const fixture = join(workdir, 'does-not-exist.txt');
      expect(() => parseFile(fixture)).not.toThrow();
      expect(parseFile(fixture)).toBeNull();
    });

    it('returns null for a binary file (NUL in first 8KB)', () => {
      const fixture = join(workdir, 'binary.txt');
      // Real text up front, then a NUL byte well inside the sniff window.
      const head = Buffer.from('this looks textual ');
      const nul = Buffer.from([0x00]);
      const tail = Buffer.from('but it is not');
      writeFileSync(fixture, Buffer.concat([head, nul, tail]));

      expect(parseFile(fixture)).toBeNull();
    });

    it('captures extractor errors into parseErrors instead of throwing', () => {
      // Replace the stub with one that throws to exercise the harness's
      // error-capture path without modifying the real stub.
      clear();
      const throwing = {
        language: 'text',
        extensions: ['.txt'],
        parse(): never {
          throw new Error('boom');
        },
      };
      // Use the registry directly so this test is self-contained.
      const { register } = require('./registry') as typeof import('./registry');
      register(throwing);

      const fixture = join(workdir, 'broken.txt');
      writeFileSync(fixture, 'irrelevant');

      const result = parseFile(fixture);
      expect(result).not.toBeNull();
      expect(result!.nodes).toEqual([]);
      expect(result!.edges).toEqual([]);
      expect(result!.parseErrors).toEqual(['boom']);
      expect(result!.language).toBe('text');
    });
  });

  describe('with an empty registry', () => {
    it('returns null when nothing is registered', () => {
      const fixture = join(workdir, 'hello.txt');
      writeFileSync(fixture, 'hi');
      expect(parseFile(fixture)).toBeNull();
    });
  });
});
