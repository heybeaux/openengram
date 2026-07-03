/**
 * No-op stub extractor.
 *
 * Registered for `.txt` so the harness can be wired up and exercised before
 * any real language extractor exists. EC-9/10/11 replace this pattern with
 * real tree-sitter-backed extractors for TypeScript, Python, and Go.
 *
 * The stub returns a single `module` node spanning the whole file and no
 * edges — just enough shape to prove the registry + harness round-trip.
 */

import { register } from './registry';
import { LanguageExtractor, ParseResult } from './types';

export const stubExtractor: LanguageExtractor = {
  language: 'text',
  extensions: ['.txt'],
  parse(filePath: string, source: string): ParseResult {
    const lineCount = source.length === 0 ? 0 : source.split('\n').length;
    return {
      filePath,
      language: 'text',
      nodes: [
        {
          kind: 'module',
          name: filePath,
          filePath,
          startLine: 1,
          endLine: Math.max(1, lineCount),
        },
      ],
      edges: [],
      parseErrors: [],
    };
  },
};

/**
 * Register the stub. Importing this module for side effects (e.g. from a
 * bootstrap file or a test) installs the extractor into the registry.
 */
export function registerStubExtractor(): void {
  register(stubExtractor);
}
