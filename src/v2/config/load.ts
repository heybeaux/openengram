/**
 * Per-codebase config loader for `.engram/config.yaml` (EC-27).
 *
 * Resolution rules:
 *   - Walk up from the start directory looking for `.engram/config.yaml`.
 *   - Stop at the filesystem root, the user's home dir, or the first
 *     `.git` boundary above the start (whichever comes first).
 *   - If no file is found, return {@link DEFAULT_CONFIG}.
 *   - If a file is found, parse YAML, validate with zod, and deep-merge
 *     the user's overrides on top of {@link DEFAULT_CONFIG}.
 *
 * The loader is sync-friendly via `loadConfigFromString`; on-disk reads
 * are async. Both throw {@link ConfigError} on malformed YAML or schema
 * violations so the CLI can render a single clean error line.
 */

import { existsSync, promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';

import { DEFAULT_CONFIG } from './defaults';
import {
  EngramConfigSchema,
  type EngramConfig,
  type ResolvedEngramConfig,
} from './schema';

export const CONFIG_FILENAME = 'config.yaml';
export const CONFIG_DIRNAME = '.engram';
const CONFIG_RELPATH = join(CONFIG_DIRNAME, CONFIG_FILENAME);

export class ConfigError extends Error {
  constructor(
    message: string,
    public readonly path?: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'ConfigError';
  }
}

export interface LoadConfigResult {
  /** Fully-resolved config (defaults + overrides). */
  config: ResolvedEngramConfig;
  /**
   * Absolute path to the `.engram/config.yaml` we read, or `null` when no
   * file was found and the defaults were returned as-is.
   */
  source: string | null;
}

export interface LoadConfigOptions {
  /** Start directory for the upward walk. Defaults to `process.cwd()`. */
  startDir?: string;
  /**
   * Optional explicit config path. When set, skip the walk and read this
   * file directly. Errors when the file does not exist.
   */
  explicitPath?: string;
}

/**
 * Find the nearest `.engram/config.yaml` at or above `startDir`.
 *
 * Returns the absolute path on a hit or `null` when nothing was found
 * before the walk terminates. The walk stops at the filesystem root,
 * at the user's home directory, or one level above the first directory
 * containing a `.git` entry — whichever is closest.
 */
export function findConfigFile(startDir: string): string | null {
  let dir = resolve(startDir);
  const home = resolve(homedir());

  // Iterate with a generous bound — typical repos sit a few levels deep.
  // The walk inspects each directory for `.engram/config.yaml` and stops
  // once it crosses a `.git` boundary so a sibling app inside a monorepo
  // doesn't accidentally pick up the outer repo's config.
  for (let i = 0; i < 64; i += 1) {
    const candidate = join(dir, CONFIG_RELPATH);
    if (existsSync(candidate)) return candidate;

    // Hitting `.git` at this level means we've reached the repo root for
    // this codebase. Stop the walk — anything above belongs to a parent
    // checkout and shouldn't bleed into this run.
    if (existsSync(join(dir, '.git'))) return null;

    const parent = dirname(dir);
    if (parent === dir) return null;
    if (dir === home) return null;
    dir = parent;
  }
  return null;
}

/**
 * Resolve, parse, and merge `.engram/config.yaml` for the current run.
 *
 * Async because we do a real `fs.readFile`. Throws {@link ConfigError}
 * on YAML or schema problems; missing files are not an error.
 */
export async function loadConfig(
  opts: LoadConfigOptions = {},
): Promise<LoadConfigResult> {
  const startDir = opts.startDir ?? process.cwd();
  const explicit = opts.explicitPath ? resolve(opts.explicitPath) : null;

  let configPath: string | null;
  if (explicit) {
    if (!existsSync(explicit)) {
      throw new ConfigError(
        `engram-code: config file not found: ${explicit}`,
        explicit,
      );
    }
    configPath = explicit;
  } else {
    configPath = findConfigFile(startDir);
  }

  if (!configPath) {
    return { config: DEFAULT_CONFIG, source: null };
  }

  let raw: string;
  try {
    raw = await fs.readFile(configPath, 'utf8');
  } catch (err) {
    throw new ConfigError(
      `engram-code: failed to read ${configPath}: ${(err as Error).message}`,
      configPath,
      err,
    );
  }

  const resolved = loadConfigFromString(raw, configPath);
  return { config: resolved, source: configPath };
}

/**
 * Parse + validate a YAML string. Exposed so tests (and any future
 * `--config-string` path) can exercise the merger without disk I/O.
 */
export function loadConfigFromString(
  yamlText: string,
  sourceLabel?: string,
): ResolvedEngramConfig {
  // YAML `parse` returns `undefined` for an empty document. Treat that
  // the same as `{}` so an empty file is valid and resolves to defaults.
  let parsed: unknown;
  try {
    parsed = parseYaml(yamlText);
  } catch (err) {
    throw new ConfigError(
      `engram-code: malformed YAML${sourceLabel ? ` in ${sourceLabel}` : ''}: ${(err as Error).message}`,
      sourceLabel,
      err,
    );
  }
  if (parsed === undefined || parsed === null) parsed = {};
  if (typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new ConfigError(
      `engram-code: ${sourceLabel ?? 'config'} must contain a YAML mapping at the top level`,
      sourceLabel,
    );
  }

  const result = EngramConfigSchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `${i.path.join('.') || '<root>'}: ${i.message}`)
      .join('; ');
    throw new ConfigError(
      `engram-code: invalid config${sourceLabel ? ` (${sourceLabel})` : ''}: ${issues}`,
      sourceLabel,
    );
  }

  return mergeWithDefaults(result.data);
}

/**
 * Deep-merge user overrides on top of {@link DEFAULT_CONFIG}.
 *
 * Strings, numbers, and arrays replace the default wholesale. Nested
 * objects merge field-by-field so a user supplying only
 * `passes.contracts.model` keeps the default fallback + token caps.
 */
export function mergeWithDefaults(
  overrides: EngramConfig,
): ResolvedEngramConfig {
  const out: ResolvedEngramConfig = {
    passes: {
      intent: { ...DEFAULT_CONFIG.passes.intent, ...overrides.passes?.intent },
      contracts: {
        ...DEFAULT_CONFIG.passes.contracts,
        ...overrides.passes?.contracts,
      },
      gotchas: {
        ...DEFAULT_CONFIG.passes.gotchas,
        ...overrides.passes?.gotchas,
      },
      synthesis: {
        module: {
          ...DEFAULT_CONFIG.passes.synthesis.module,
          ...overrides.passes?.synthesis?.module,
        },
        subsystem: {
          ...DEFAULT_CONFIG.passes.synthesis.subsystem,
          ...overrides.passes?.synthesis?.subsystem,
        },
        repository: {
          ...DEFAULT_CONFIG.passes.synthesis.repository,
          ...overrides.passes?.synthesis?.repository,
        },
      },
    },
    budget: {
      ...DEFAULT_CONFIG.budget,
      ...overrides.budget,
    },
    observations: {
      ...DEFAULT_CONFIG.observations,
      ...overrides.observations,
    },
    scheduler: {
      enabled: overrides.scheduler?.enabled ?? DEFAULT_CONFIG.scheduler.enabled,
      cron: overrides.scheduler?.cron
        ? overrides.scheduler.cron.map((j) => ({ ...j }))
        : [...DEFAULT_CONFIG.scheduler.cron],
      webhook: {
        ...DEFAULT_CONFIG.scheduler.webhook,
        ...overrides.scheduler?.webhook,
      },
    },
    modules: {
      include: overrides.modules?.include ?? [
        ...DEFAULT_CONFIG.modules.include,
      ],
      exclude: overrides.modules?.exclude ?? [
        ...DEFAULT_CONFIG.modules.exclude,
      ],
    },
  };
  return out;
}
