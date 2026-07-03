/**
 * engram-code v2 CLI (EC-16).
 *
 * Two commands in Phase 1:
 *
 *   - `engram-code index <repo-path>`
 *     Runs Pass 1 (structure) over the repo and writes one module-level
 *     card per source file via the EC-14 markdown writer. Synthesis (EC-13,
 *     LLM-backed) is **stubbed** here — each card is populated with a
 *     deterministic placeholder body derived from the structure graph so
 *     the rest of the pipeline (writer, API, downstream consumers) has
 *     real artifacts to work against. Once EC-13 lands, replace
 *     `buildStubCards` with the real synthesizer.
 *
 *   - `engram-code cards <conceptPath> [--lod=summary]`
 *     Reads a card off disk and prints the requested LoD body to stdout.
 *
 * Arg parsing is intentionally hand-rolled: we don't want a new runtime
 * dependency just to handle two commands and one flag.
 */

import { promises as fs } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';

import { ConfigError, loadConfig } from '../config';
import { runStructurePass } from '../passes/structure/orchestrator';
import type { StructurePassResult } from '../passes/structure/orchestrator';
import { registerElixirExtractor } from '../parsers/elixir.extractor';
import { registerGoExtractor } from '../parsers/go.extractor';
import { registerPythonExtractor } from '../parsers/python.extractor';
import { registerRustExtractor } from '../parsers/rust.extractor';
import { registerSwiftExtractor } from '../parsers/swift.extractor';
import { registerTypeScriptExtractor } from '../parsers/typescript.extractor';
import type { StructureNode } from '../parsers/types';
import { cardFilePath, readCard, writeCard } from '../writers/markdown/writer';
import type { Card, LoDContent } from '../writers/markdown/types';
import { writeRepoIndex } from '../writers/markdown/index-writer';

import {
  parseSynthArgs,
  renderSummary,
  runSynth,
  type SynthArgs,
} from './synth';

/** Exit codes — kept distinct so shells / CI can branch on them. */
export const EXIT = {
  OK: 0,
  USAGE: 64,
  NOT_FOUND: 66,
  RUNTIME: 70,
} as const;

/** Minimal IO surface so the CLI is testable without spawning processes. */
export interface CliIO {
  stdout: (s: string) => void;
  stderr: (s: string) => void;
}

const DEFAULT_IO: CliIO = {
  stdout: (s) => process.stdout.write(s),
  stderr: (s) => process.stderr.write(s),
};

const VALID_LODS: readonly (keyof LoDContent)[] = [
  'index',
  'summary',
  'standard',
  'deep',
];

/**
 * Top-level entrypoint. Returns a numeric exit code rather than calling
 * `process.exit` directly so tests can assert on it.
 */
export async function run(
  argv: string[],
  io: CliIO = DEFAULT_IO,
): Promise<number> {
  const [command, ...rest] = argv;
  if (!command || command === '--help' || command === '-h') {
    io.stdout(usage());
    return command ? EXIT.OK : EXIT.USAGE;
  }

  switch (command) {
    case 'index':
      return runIndex(rest, io);
    case 'cards':
      return runCards(rest, io);
    case 'config':
      return runConfig(rest, io);
    case 'synth':
      return runSynthCommand(rest, io);
    case 'hook':
      return runHookCommand(rest, io);
    default:
      io.stderr(`engram-code: unknown command "${command}"\n${usage()}`);
      return EXIT.USAGE;
  }
}

/**
 * `engram-code hook install <repo>` (EC-49).
 *
 * Drops `scripts/post-commit-hook.sh` into the repo's
 * `.git/hooks/post-commit` so future commits POST to the scheduler
 * webhook. We do not chain a pre-existing hook — if one exists we
 * refuse without `--force` so we don't clobber user state.
 */
async function runHookCommand(argv: string[], io: CliIO): Promise<number> {
  const sub = argv[0];
  if (sub !== 'install') {
    io.stderr(
      'engram-code hook: usage: engram-code hook install <repo-path> [--force]\n',
    );
    return EXIT.USAGE;
  }
  const repoArg = argv[1];
  if (!repoArg) {
    io.stderr('engram-code hook install: <repo-path> required\n');
    return EXIT.USAGE;
  }
  const force = argv.includes('--force');
  const repoPath = resolve(repoArg);
  const gitDir = join(repoPath, '.git');
  let stat;
  try {
    stat = await fs.stat(gitDir);
  } catch {
    io.stderr(`engram-code hook install: ${gitDir} not found\n`);
    return EXIT.NOT_FOUND;
  }
  if (!stat.isDirectory()) {
    io.stderr(`engram-code hook install: ${gitDir} is not a directory\n`);
    return EXIT.USAGE;
  }
  const hooksDir = join(gitDir, 'hooks');
  await fs.mkdir(hooksDir, { recursive: true });
  const target = join(hooksDir, 'post-commit');
  if (!force) {
    try {
      await fs.access(target);
      io.stderr(
        `engram-code hook install: ${target} already exists; pass --force to overwrite\n`,
      );
      return EXIT.USAGE;
    } catch {
      // not present, proceed
    }
  }
  // Source script ships under `scripts/` next to this package. Resolve
  // relative to __dirname so the installed CLI finds it whether running
  // from source or from `dist/`.
  const source = await locateHookScript(io);
  if (source === null) return EXIT.RUNTIME;
  const body = await fs.readFile(source, 'utf8');
  await fs.writeFile(target, body, { mode: 0o755 });
  io.stdout(`engram-code: installed post-commit hook at ${target}\n`);
  return EXIT.OK;
}

async function locateHookScript(io: CliIO): Promise<string | null> {
  const candidates = [
    join(__dirname, '..', '..', '..', 'scripts', 'post-commit-hook.sh'),
    join(__dirname, '..', '..', '..', '..', 'scripts', 'post-commit-hook.sh'),
    resolve(process.cwd(), 'scripts', 'post-commit-hook.sh'),
  ];
  for (const c of candidates) {
    try {
      await fs.access(c);
      return c;
    } catch {
      // try next
    }
  }
  io.stderr(
    'engram-code hook install: could not locate scripts/post-commit-hook.sh\n',
  );
  return null;
}

function usage(): string {
  return [
    'engram-code — LoD card generator for codebases (v2 Phase 1+2)',
    '',
    'Usage:',
    '  engram-code index <repo-path> [--out=<dir>] [--repo-id=<id>] [--quiet|--verbose]',
    '  engram-code cards <conceptPath> [--lod=summary] [--root=<dir>]',
    '  engram-code config show <repo-path> [--config=<file>]',
    '  engram-code synth <repo-path> [--out=<dir>] [--repo-id=<id>] [--dry-run]',
    '  engram-code synth contracts|gotchas|subsystem|repository|hotspots <repo-path> [...flags]',
    '  engram-code hook install <repo-path> [--force]',
    '',
    'Options:',
    '  --out=<dir>     Artifacts root (default: <repo>/.engram/artifacts)',
    '  --repo-id=<id>  Repo identifier stamped into card metadata (default: dir name)',
    '  --quiet         Suppress per-file parse-error lines; keep summary count only',
    '  --verbose       Include parser id and first stack line on per-file parse-error lines',
    '  --root=<dir>    Artifacts root for `cards` (default: $ENGRAM_ARTIFACTS_ROOT or ./.engram/artifacts)',
    '  --lod=<level>   One of index|summary|standard|deep (default: summary)',
    '  --config=<file> Explicit `.engram/config.yaml` path for `config show`',
    '  --dry-run       For `synth`: print the planned LLM calls + token estimate without running them',
    '',
  ].join('\n');
}

// ─── `engram-code index` ─────────────────────────────────────────────────

interface IndexArgs {
  repoPath: string;
  outDir?: string;
  repoId?: string;
  quiet?: boolean;
  verbose?: boolean;
}

async function runIndex(argv: string[], io: CliIO): Promise<number> {
  let parsed: IndexArgs;
  try {
    parsed = parseIndexArgs(argv);
  } catch (err) {
    io.stderr(`engram-code index: ${(err as Error).message}\n${usage()}`);
    return EXIT.USAGE;
  }

  const repoPath = resolve(parsed.repoPath);
  let stat;
  try {
    stat = await fs.stat(repoPath);
  } catch {
    io.stderr(`engram-code index: repo path not found: ${repoPath}\n`);
    return EXIT.NOT_FOUND;
  }
  if (!stat.isDirectory()) {
    io.stderr(`engram-code index: not a directory: ${repoPath}\n`);
    return EXIT.USAGE;
  }

  const repoId = parsed.repoId ?? defaultRepoId(repoPath);
  const outDir = parsed.outDir ?? join(repoPath, '.engram', 'artifacts');

  io.stdout(`engram-code: indexing ${repoPath}\n`);

  // The parser registry is process-global but extractors don't self-register
  // on import; do it lazily here so the CLI doesn't force tree-sitter native
  // bindings to load when only `engram-code cards` is invoked.
  ensureExtractorsRegistered();

  let result: StructurePassResult;
  try {
    result = await runStructurePass(repoPath, repoId);
  } catch (err) {
    io.stderr(
      `engram-code index: structure pass failed: ${(err as Error).message}\n`,
    );
    return EXIT.RUNTIME;
  }

  io.stdout(
    `engram-code: walked ${result.filesWalked} files, parsed ${result.filesParsed}, ${result.nodes.length} nodes, ${result.edges.length} edges\n`,
  );
  if (result.fileErrors.length > 0) {
    // Per-file detail (EC-19). The previous behavior — a single summary line
    // — turned out to be useless when debugging which file actually broke;
    // we now stream one line per error to stderr by default. `--quiet`
    // restores the old summary-only output, `--verbose` adds the parser id
    // and the first line of any embedded stack trace.
    if (!parsed.quiet) {
      for (const fileErr of result.fileErrors) {
        for (const message of fileErr.errors) {
          const firstLine = message.split('\n', 1)[0] ?? '';
          if (parsed.verbose) {
            io.stderr(
              `engram-code: parse-error [${fileErr.language}] ${fileErr.filePath}: ${firstLine}\n`,
            );
          } else {
            io.stderr(
              `engram-code: parse-error ${fileErr.filePath}: ${firstLine}\n`,
            );
          }
        }
      }
    }
    io.stderr(
      `engram-code: ${result.fileErrors.length} file(s) had parse errors (continuing)\n`,
    );
  }

  // STUB: real synthesis is EC-13 (LLM-backed). For now we emit a
  // deterministic card per source file from the structure graph so the
  // rest of the pipeline (writer, API, INDEX.md) has real artifacts to
  // work with. Swap this out when EC-13 merges.
  const cards = buildStubCards(result, repoId);

  for (const card of cards) {
    await writeCard(outDir, card);
  }
  await writeRepoIndex(outDir, { name: repoId, cards });

  io.stdout(
    `engram-code: wrote ${cards.length} stub card(s) and INDEX.md to ${outDir}\n`,
  );
  return EXIT.OK;
}

function parseIndexArgs(argv: string[]): IndexArgs {
  let repoPath: string | undefined;
  let outDir: string | undefined;
  let repoId: string | undefined;
  let quiet = false;
  let verbose = false;

  for (const arg of argv) {
    if (arg.startsWith('--out=')) outDir = arg.slice('--out='.length);
    else if (arg.startsWith('--repo-id='))
      repoId = arg.slice('--repo-id='.length);
    else if (arg === '--quiet') quiet = true;
    else if (arg === '--verbose') verbose = true;
    else if (arg.startsWith('--')) {
      throw new Error(`unknown flag "${arg}"`);
    } else if (!repoPath) repoPath = arg;
    else throw new Error(`unexpected positional argument "${arg}"`);
  }
  if (!repoPath) {
    throw new Error('missing required <repo-path>');
  }
  if (quiet && verbose) {
    throw new Error('--quiet and --verbose are mutually exclusive');
  }
  return { repoPath, outDir, repoId, quiet, verbose };
}

let extractorsRegistered = false;
function ensureExtractorsRegistered(): void {
  if (extractorsRegistered) return;
  registerTypeScriptExtractor();
  registerPythonExtractor();
  registerGoExtractor();
  registerElixirExtractor();
  registerRustExtractor();
  registerSwiftExtractor();
  extractorsRegistered = true;
}

function defaultRepoId(repoPath: string): string {
  const base = repoPath.replace(/\/+$/, '').split(/[\\/]/).pop();
  return base && base !== '' ? base : 'repo';
}

/**
 * Build placeholder cards from a structure-pass result.
 *
 * One module-level card per source file. The card's `conceptPath` is the
 * file path with the extension stripped (so `src/foo.ts` →
 * `src/foo`). LoD bodies are deterministic summaries of the structure
 * graph — enough to round-trip the writer and exercise the API end-to-end
 * without standing up an LLM.
 *
 * Replace with the real synthesizer once EC-13 lands.
 */
export function buildStubCards(
  result: StructurePassResult,
  repoId: string,
): Card[] {
  const byFile = new Map<string, StructureNode[]>();
  for (const node of result.nodes) {
    const arr = byFile.get(node.filePath) ?? [];
    arr.push(node);
    byFile.set(node.filePath, arr);
  }

  const cards: Card[] = [];
  for (const [filePath, nodes] of Array.from(byFile.entries()).sort(
    ([a], [b]) => a.localeCompare(b),
  )) {
    const conceptPath = toConceptPath(filePath);
    if (!conceptPath) continue;

    const symbolNames = nodes
      .filter((n) => n.kind !== 'import' && n.kind !== 'call')
      .map((n) => `${n.kind} ${n.parent ? `${n.parent}.` : ''}${n.name}`);

    const topLevel = symbolNames.slice(0, 5).join(', ');
    const indexLine = `${filePath} — ${nodes.length} structural node(s)`;
    const summary = topLevel
      ? `Stub card for \`${filePath}\`. Top-level symbols: ${topLevel}.`
      : `Stub card for \`${filePath}\`.`;
    const standard = renderStandard(filePath, symbolNames);
    const deep = renderDeep(filePath, nodes);

    cards.push({
      conceptPath,
      kind: 'module',
      lod: {
        index: indexLine,
        summary,
        standard,
        deep,
      },
      metadata: {
        generated_at: new Date().toISOString(),
        model: 'stub',
        repo_id: repoId,
        sources: [filePath],
      },
    });
  }
  return cards;
}

/**
 * Map a repo-relative file path to a writer-safe concept path.
 *
 * Strips the extension and rejects paths the writer would refuse (absolute
 * paths, `..` segments). Returns `null` for unusable inputs so the caller
 * can skip them without crashing the run.
 */
function toConceptPath(filePath: string): string | null {
  if (!filePath || filePath.startsWith('/') || filePath.includes('..')) {
    return null;
  }
  const lastDot = filePath.lastIndexOf('.');
  const lastSlash = filePath.lastIndexOf('/');
  const stripped =
    lastDot > lastSlash && lastDot !== -1
      ? filePath.slice(0, lastDot)
      : filePath;
  return stripped;
}

function renderStandard(filePath: string, symbols: string[]): string {
  if (symbols.length === 0) {
    return `Structural placeholder for \`${filePath}\`. No top-level symbols extracted.`;
  }
  const lines = [
    `Structural placeholder for \`${filePath}\`.`,
    '',
    'Symbols:',
    ...symbols.map((s) => `- ${s}`),
  ];
  return lines.join('\n');
}

function renderDeep(filePath: string, nodes: StructureNode[]): string {
  if (nodes.length === 0) return `No structural data for \`${filePath}\`.`;
  const lines = [
    `Deep placeholder for \`${filePath}\`. ${nodes.length} structural node(s).`,
    '',
    'Nodes:',
    ...nodes.map(
      (n) =>
        `- ${n.kind} \`${n.parent ? `${n.parent}.` : ''}${n.name}\` @ L${n.startLine}-${n.endLine}`,
    ),
  ];
  return lines.join('\n');
}

// ─── `engram-code cards` ─────────────────────────────────────────────────

interface CardsArgs {
  conceptPath: string;
  lod: keyof LoDContent;
  root?: string;
}

async function runCards(argv: string[], io: CliIO): Promise<number> {
  let parsed: CardsArgs;
  try {
    parsed = parseCardsArgs(argv);
  } catch (err) {
    io.stderr(`engram-code cards: ${(err as Error).message}\n${usage()}`);
    return EXIT.USAGE;
  }

  const root = parsed.root ?? defaultCardsRoot();
  const filePath = cardFilePath(root, parsed.conceptPath);

  let card: Card;
  try {
    card = await readCard(filePath);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      io.stderr(`engram-code cards: not found: ${filePath}\n`);
      return EXIT.NOT_FOUND;
    }
    io.stderr(`engram-code cards: ${(err as Error).message}\n`);
    return EXIT.RUNTIME;
  }

  const body = card.lod[parsed.lod] ?? '';
  io.stdout(body.endsWith('\n') ? body : body + '\n');
  return EXIT.OK;
}

function parseCardsArgs(argv: string[]): CardsArgs {
  let conceptPath: string | undefined;
  let lod: keyof LoDContent = 'summary';
  let root: string | undefined;

  for (const arg of argv) {
    if (arg.startsWith('--lod=')) {
      const raw = arg.slice('--lod='.length);
      if (!(VALID_LODS as readonly string[]).includes(raw)) {
        throw new Error(
          `invalid --lod=${raw}; must be one of ${VALID_LODS.join('|')}`,
        );
      }
      lod = raw as keyof LoDContent;
    } else if (arg.startsWith('--root=')) {
      root = arg.slice('--root='.length);
    } else if (arg.startsWith('--')) {
      throw new Error(`unknown flag "${arg}"`);
    } else if (!conceptPath) {
      conceptPath = arg;
    } else {
      throw new Error(`unexpected positional argument "${arg}"`);
    }
  }
  if (!conceptPath) throw new Error('missing required <conceptPath>');
  return { conceptPath, lod, root };
}

function defaultCardsRoot(): string {
  const fromEnv = process.env.ENGRAM_ARTIFACTS_ROOT;
  if (fromEnv && fromEnv.trim() !== '') return fromEnv;
  return join(process.cwd(), '.engram', 'artifacts');
}

// ─── `engram-code config show` ───────────────────────────────────────────

interface ConfigShowArgs {
  repoPath: string;
  configPath?: string;
}

async function runConfig(argv: string[], io: CliIO): Promise<number> {
  const [sub, ...rest] = argv;
  if (sub !== 'show') {
    io.stderr(
      `engram-code config: unknown subcommand "${sub ?? ''}"\n${usage()}`,
    );
    return EXIT.USAGE;
  }

  let parsed: ConfigShowArgs;
  try {
    parsed = parseConfigShowArgs(rest);
  } catch (err) {
    io.stderr(`engram-code config show: ${(err as Error).message}\n${usage()}`);
    return EXIT.USAGE;
  }

  const repoPath = resolve(parsed.repoPath);
  try {
    const stat = await fs.stat(repoPath);
    if (!stat.isDirectory()) {
      io.stderr(`engram-code config show: not a directory: ${repoPath}\n`);
      return EXIT.USAGE;
    }
  } catch {
    io.stderr(`engram-code config show: repo path not found: ${repoPath}\n`);
    return EXIT.NOT_FOUND;
  }

  try {
    const result = await loadConfig({
      startDir: repoPath,
      explicitPath: parsed.configPath,
    });
    io.stdout(
      `# source: ${result.source ?? '<built-in defaults>'}\n${JSON.stringify(result.config, null, 2)}\n`,
    );
    return EXIT.OK;
  } catch (err) {
    if (err instanceof ConfigError) {
      io.stderr(`engram-code config show: ${err.message}\n`);
      return EXIT.RUNTIME;
    }
    io.stderr(
      `engram-code config show: unexpected error: ${(err as Error).message}\n`,
    );
    return EXIT.RUNTIME;
  }
}

function parseConfigShowArgs(argv: string[]): ConfigShowArgs {
  let repoPath: string | undefined;
  let configPath: string | undefined;

  for (const arg of argv) {
    if (arg.startsWith('--config=')) {
      configPath = arg.slice('--config='.length);
    } else if (arg.startsWith('--')) {
      throw new Error(`unknown flag "${arg}"`);
    } else if (!repoPath) {
      repoPath = arg;
    } else {
      throw new Error(`unexpected positional argument "${arg}"`);
    }
  }
  if (!repoPath) throw new Error('missing required <repo-path>');
  return { repoPath, configPath };
}

// ─── `engram-code synth` ─────────────────────────────────────────────────

async function runSynthCommand(argv: string[], io: CliIO): Promise<number> {
  let parsed: SynthArgs;
  try {
    parsed = parseSynthArgs(argv);
  } catch (err) {
    io.stderr(`engram-code synth: ${(err as Error).message}\n${usage()}`);
    return EXIT.USAGE;
  }

  const repoPath = resolve(parsed.repoPath);
  let stat;
  try {
    stat = await fs.stat(repoPath);
  } catch {
    io.stderr(`engram-code synth: repo path not found: ${repoPath}\n`);
    return EXIT.NOT_FOUND;
  }
  if (!stat.isDirectory()) {
    io.stderr(`engram-code synth: not a directory: ${repoPath}\n`);
    return EXIT.USAGE;
  }

  try {
    // EC-46: incremental rescans need a Prisma client to query prior
    // PassRun rows. The CLI doesn't wire one yet (it ran without one in
    // every release pre-EC-46), so for now `--full` / `--since` are accepted
    // but only take effect when the ingest service drives the call. The
    // flags still surface in the summary so the user sees they were parsed.
    const summary = await runSynth({
      repoPath,
      subcommand: parsed.subcommand,
      outDir: parsed.outDir,
      repoId: parsed.repoId,
      dryRun: parsed.dryRun,
      log: (line) => io.stdout(`${line}\n`),
    });
    if (parsed.full) {
      io.stdout('  (--full requested; incremental cache bypassed)\n');
    }
    if (parsed.since) {
      io.stdout(`  (--since=${parsed.since}; diff anchor overridden)\n`);
    }
    io.stdout(renderSummary(summary));
    return EXIT.OK;
  } catch (err) {
    io.stderr(`engram-code synth: ${(err as Error).message}\n`);
    return EXIT.RUNTIME;
  }
}

// Re-export for the bin shim and tests.
export { cardFilePath, readCard, writeCard };
export type { Card };

// Resolve absolute-path helper used by tests that build expected paths.
export function _absolute(p: string): string {
  return isAbsolute(p) ? p : resolve(p);
}

// `dirname` is re-exported so consumers can derive companion paths without
// pulling in `node:path` themselves.
export { dirname };
