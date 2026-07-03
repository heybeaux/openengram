/**
 * File-level parser harness.
 *
 * The harness is the only place in v2 that touches the filesystem during
 * parsing. It resolves a file's extractor via the registry, reads the file,
 * runs a cheap binary-detection heuristic, and dispatches to the extractor.
 *
 * Extractor failures are caught and surfaced via `ParseResult.parseErrors`
 * so a single broken file never halts a repo-wide indexing pass.
 */

import { readFileSync, statSync } from 'node:fs';
import { extname } from 'node:path';

import { getByExtension } from './registry';
import { LanguageExtractor, ParseResult } from './types';

/** Number of bytes to sniff when deciding if a file is binary. */
const BINARY_SNIFF_BYTES = 8 * 1024;

/**
 * Cheap binary heuristic: treat any file that contains a NUL byte in its
 * first 8KB as binary. Mirrors what `git`, `grep`, and friends do, and
 * avoids pulling in a real content-type detector for this use case.
 */
function looksBinary(buffer: Buffer): boolean {
  const limit = Math.min(buffer.length, BINARY_SNIFF_BYTES);
  for (let i = 0; i < limit; i++) {
    if (buffer[i] === 0) return true;
  }
  return false;
}

/**
 * Build a `ParseResult` populated only with an error message. Used when an
 * extractor throws — we still want a result object so callers can aggregate
 * errors across a whole repo.
 */
function errorResult(
  filePath: string,
  extractor: LanguageExtractor,
  message: string,
): ParseResult {
  return {
    filePath,
    language: extractor.language,
    nodes: [],
    edges: [],
    parseErrors: [message],
  };
}

/**
 * Parse a single file.
 *
 * Returns `null` (rather than throwing) for any of:
 *  - the file doesn't exist / isn't a regular file
 *  - no extractor is registered for the file's extension
 *  - the file appears to be binary
 *
 * If an extractor throws, the error is captured into `parseErrors` and a
 * result with empty `nodes`/`edges` is returned.
 *
 * @param filePath absolute or repo-relative path; what gets stored on the
 *   result is whatever the caller passed in, so prefer repo-relative paths.
 */
export function parseFile(filePath: string): ParseResult | null {
  const ext = extname(filePath);
  if (!ext) return null;

  const extractor = getByExtension(ext);
  if (!extractor) return null;

  let buffer: Buffer;
  try {
    const stats = statSync(filePath);
    if (!stats.isFile()) return null;
    buffer = readFileSync(filePath);
  } catch {
    return null;
  }

  if (looksBinary(buffer)) return null;

  const source = buffer.toString('utf8');

  try {
    return extractor.parse(filePath, source);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return errorResult(filePath, extractor, message);
  }
}
