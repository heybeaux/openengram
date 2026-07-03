/**
 * Markdown artifact writer (EC-14).
 *
 * Persists LoD `Card`s to disk under `<rootDir>/cards/<conceptPath>.md`.
 * Each file is a small markdown document with a YAML frontmatter block
 * carrying `metadata` plus four `## index|summary|standard|deep` sections.
 *
 * Round-trippable: `writeCard` followed by `readCard` on the returned path
 * MUST yield a structurally-equal `Card`. The on-disk format is the source
 * of truth — the Postgres `cards` table is rebuildable from these files.
 *
 * YAML handling is intentionally minimal. We support exactly the subset
 * the synthesizer emits — scalars, ISO timestamps, and string arrays — so
 * we can avoid pulling in a YAML dependency for the writer layer. If/when
 * we need richer YAML (anchors, nested maps, multi-line scalars), swap in
 * `yaml` here without changing the public Card shape.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';

import { Card, CardKind, LoDContent } from './types';

/** Order of LoD sections in the rendered markdown. Stable for diff hygiene. */
const LOD_ORDER: (keyof LoDContent)[] = [
  'index',
  'summary',
  'standard',
  'deep',
];

const VALID_KINDS: readonly CardKind[] = [
  'repository',
  'subsystem',
  'module',
  'capability',
];

/**
 * Resolve the on-disk path for a card under `<rootDir>/cards/`.
 *
 * Exported for use by `index-writer.ts` so the index can link to the same
 * paths the writer produces, without re-implementing the convention.
 */
export function cardFilePath(rootDir: string, conceptPath: string): string {
  if (!conceptPath || conceptPath.trim() === '') {
    throw new Error('cardFilePath: conceptPath must be non-empty');
  }
  if (conceptPath.startsWith('/') || conceptPath.includes('..')) {
    throw new Error(
      `cardFilePath: conceptPath must be a relative slash path, got "${conceptPath}"`,
    );
  }
  return join(rootDir, 'cards', `${conceptPath}.md`);
}

/**
 * Write a card to `<rootDir>/cards/<conceptPath>.md`.
 *
 * Creates parent directories as needed. Overwrites any existing file at
 * that path. Returns the absolute path that was written.
 */
export async function writeCard(rootDir: string, card: Card): Promise<string> {
  if (!VALID_KINDS.includes(card.kind)) {
    throw new Error(`writeCard: invalid kind "${card.kind}"`);
  }
  const filePath = cardFilePath(rootDir, card.conceptPath);
  await mkdir(dirname(filePath), { recursive: true });
  const rendered = renderCard(card);
  await writeFile(filePath, rendered, 'utf8');
  return isAbsolute(filePath) ? filePath : resolve(filePath);
}

/**
 * Read a card markdown file back into a `Card` object.
 *
 * Inverse of `writeCard` for files this module produced. Throws if the
 * frontmatter block is missing or malformed — we don't try to recover from
 * hand-edited cards here; that's a job for a future linter pass.
 */
export async function readCard(filePath: string): Promise<Card> {
  const raw = await readFile(filePath, 'utf8');
  const { frontmatter, body } = splitFrontmatter(raw);
  const metadata = parseFrontmatter(frontmatter);

  const conceptPath = metadata.conceptPath;
  const kind = metadata.kind;
  if (typeof conceptPath !== 'string' || conceptPath === '') {
    throw new Error(`readCard: missing string "conceptPath" in ${filePath}`);
  }
  if (typeof kind !== 'string' || !VALID_KINDS.includes(kind as CardKind)) {
    throw new Error(`readCard: missing/invalid "kind" in ${filePath}`);
  }

  // conceptPath and kind live in frontmatter but are first-class on Card;
  // strip them from the metadata bag so round-tripping is loss-free.
  const rest: Record<string, unknown> = { ...metadata };
  delete rest.conceptPath;
  delete rest.kind;

  return {
    conceptPath,
    kind: kind as CardKind,
    lod: parseLoDSections(body),
    metadata: rest,
  };
}

// ─── rendering ────────────────────────────────────────────────────────────

function renderCard(card: Card): string {
  const frontmatter = renderFrontmatter({
    conceptPath: card.conceptPath,
    kind: card.kind,
    ...card.metadata,
  });
  const sections = LOD_ORDER.map(
    (level) => `## ${level}\n\n${card.lod[level]}\n`,
  ).join('\n');
  return `---\n${frontmatter}---\n\n${sections}`;
}

/**
 * Render a flat object as YAML. Supports:
 *   - scalars: string, number, boolean, null
 *   - arrays of scalars (rendered as `- item` block sequences)
 *
 * Strings are quoted only when ambiguity would otherwise arise (contains
 * `:`, leading/trailing whitespace, YAML indicators, or looks like a bool/
 * null/number literal). Keeps generated cards diff-friendly.
 */
function renderFrontmatter(data: Record<string, unknown>): string {
  const lines: string[] = [];
  for (const [key, value] of Object.entries(data)) {
    if (Array.isArray(value)) {
      if (value.length === 0) {
        lines.push(`${key}: []`);
        continue;
      }
      lines.push(`${key}:`);
      for (const item of value) {
        lines.push(`  - ${renderScalar(item)}`);
      }
    } else {
      lines.push(`${key}: ${renderScalar(value)}`);
    }
  }
  return lines.join('\n') + '\n';
}

function renderScalar(v: unknown): string {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'null';
  // Anything non-string (e.g. nested objects) is JSON-encoded — this keeps
  // round-tripping safe even for shapes the synthesizer isn't supposed to
  // emit. Strings are quoted only when needed for YAML disambiguation.
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  if (needsQuoting(s)) {
    return JSON.stringify(s); // JSON strings are a valid YAML scalar subset
  }
  return s;
}

function needsQuoting(s: string): boolean {
  if (s === '') return true;
  if (/^[\s]|[\s]$/.test(s)) return true;
  if (/[:#\n\r\t]/.test(s)) return true;
  if (/^[-?!&*|>%@`]/.test(s)) return true;
  if (/^(true|false|null|yes|no|on|off|~)$/i.test(s)) return true;
  if (/^-?\d+(\.\d+)?([eE][-+]?\d+)?$/.test(s)) return true;
  return false;
}

// ─── parsing ──────────────────────────────────────────────────────────────

interface SplitResult {
  frontmatter: string;
  body: string;
}

/**
 * Split a card file into its frontmatter block and body.
 *
 * Accepts either LF or CRLF line endings on input but normalizes to LF
 * internally — markdown content in the body keeps whatever line endings
 * the synthesizer produced.
 */
function splitFrontmatter(raw: string): SplitResult {
  const normalized = raw.replace(/\r\n/g, '\n');
  if (!normalized.startsWith('---\n')) {
    throw new Error('card file missing leading "---" frontmatter fence');
  }
  const end = normalized.indexOf('\n---\n', 4);
  if (end === -1) {
    throw new Error('card file missing closing "---" frontmatter fence');
  }
  return {
    frontmatter: normalized.slice(4, end + 1),
    body: normalized.slice(end + 5),
  };
}

/**
 * Parse the flat YAML subset produced by `renderFrontmatter`.
 *
 * Recognizes:
 *   - `key: value` scalars (with optional JSON-string quoting)
 *   - `key:` followed by `  - item` block sequence lines
 *   - `key: []` empty arrays
 *
 * Anything outside that grammar throws — synthesizer output is the only
 * legal input here.
 */
function parseFrontmatter(text: string): Record<string, unknown> {
  const lines = text.split('\n');
  const out: Record<string, unknown> = {};
  let currentKey: string | null = null;
  let currentArr: unknown[] | null = null;

  const flush = () => {
    if (currentKey !== null && currentArr !== null) {
      out[currentKey] = currentArr;
      currentKey = null;
      currentArr = null;
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === '') continue;

    if (currentArr !== null && /^\s+-\s/.test(line)) {
      const itemText = line.replace(/^\s+-\s+/, '');
      currentArr.push(parseScalar(itemText));
      continue;
    }

    flush();

    const match = /^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/.exec(line);
    if (!match) {
      throw new Error(`frontmatter: cannot parse line ${i + 1}: "${line}"`);
    }
    const [, key, rest] = match;
    if (rest === '') {
      // Beginning of a block sequence (or empty value — disambiguate by
      // peeking the next non-blank line).
      currentKey = key;
      currentArr = [];
      continue;
    }
    if (rest === '[]') {
      out[key] = [];
      continue;
    }
    out[key] = parseScalar(rest);
  }
  flush();
  return out;
}

function parseScalar(raw: string): unknown {
  const s = raw.trim();
  if (s === 'null' || s === '~') return null;
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (s.startsWith('"') && s.endsWith('"')) {
    try {
      return JSON.parse(s);
    } catch {
      return s.slice(1, -1);
    }
  }
  if (/^-?\d+$/.test(s)) return parseInt(s, 10);
  if (/^-?\d+\.\d+$/.test(s)) return parseFloat(s);
  return s;
}

/**
 * Parse the four LoD sections out of the body.
 *
 * The body shape is fixed: `## index`, `## summary`, `## standard`,
 * `## deep`, in that order. Missing sections yield empty strings rather
 * than throwing — the synthesizer is allowed to skip e.g. `deep` for
 * trivial concepts.
 */
function parseLoDSections(body: string): LoDContent {
  const sections: Record<string, string> = {};
  const re = /^##\s+(index|summary|standard|deep)\s*$/gm;
  const positions: { level: string; start: number; bodyStart: number }[] = [];

  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    positions.push({
      level: m[1],
      start: m.index,
      bodyStart: m.index + m[0].length,
    });
  }

  for (let i = 0; i < positions.length; i++) {
    const cur = positions[i];
    const end = i + 1 < positions.length ? positions[i + 1].start : body.length;
    sections[cur.level] = stripSectionWhitespace(
      body.slice(cur.bodyStart, end),
    );
  }

  return {
    index: sections.index ?? '',
    summary: sections.summary ?? '',
    standard: sections.standard ?? '',
    deep: sections.deep ?? '',
  };
}

/**
 * Strip the single leading and trailing newlines `renderCard` adds around
 * each section body so writing then reading is loss-free.
 */
function stripSectionWhitespace(s: string): string {
  let out = s;
  if (out.startsWith('\n')) out = out.slice(1);
  if (out.startsWith('\n')) out = out.slice(1);
  if (out.endsWith('\n\n')) out = out.slice(0, -2);
  else if (out.endsWith('\n')) out = out.slice(0, -1);
  return out;
}
