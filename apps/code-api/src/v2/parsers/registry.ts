/**
 * In-memory singleton registry mapping file extensions and language ids to
 * `LanguageExtractor` implementations.
 *
 * The registry is intentionally trivial: extractors are added at process
 * startup (e.g. by the language module's own side-effecting import), and
 * the harness looks them up at parse time. Tests can call `clear()` to
 * isolate state between cases.
 */

import { LanguageExtractor } from './types';

const byExtension = new Map<string, LanguageExtractor>();
const byLanguage = new Map<string, LanguageExtractor>();

/**
 * Normalize an extension to the form the registry stores: lower-case with
 * a leading dot. Accepts `ts`, `.ts`, `.TS` and returns `.ts`.
 */
function normalizeExtension(ext: string): string {
  const lower = ext.toLowerCase();
  return lower.startsWith('.') ? lower : `.${lower}`;
}

/**
 * Register an extractor. Later registrations for the same extension or
 * language id win — this lets a host application override defaults.
 */
export function register(extractor: LanguageExtractor): void {
  byLanguage.set(extractor.language.toLowerCase(), extractor);
  for (const ext of extractor.extensions) {
    byExtension.set(normalizeExtension(ext), extractor);
  }
}

/**
 * Look up an extractor by file extension. Accepts either `.ts` or `ts`.
 * Returns `null` when no extractor is registered.
 */
export function getByExtension(ext: string): LanguageExtractor | null {
  return byExtension.get(normalizeExtension(ext)) ?? null;
}

/**
 * Look up an extractor by logical language id (case-insensitive).
 */
export function getByLanguage(lang: string): LanguageExtractor | null {
  return byLanguage.get(lang.toLowerCase()) ?? null;
}

/**
 * List every registered language id, in insertion order.
 */
export function listLanguages(): string[] {
  return Array.from(byLanguage.keys());
}

/**
 * Drop every registration. Intended for tests and reload scenarios; not
 * something production code should call.
 */
export function clear(): void {
  byExtension.clear();
  byLanguage.clear();
}
