/**
 * EC-27 — unit tests for the per-codebase config loader.
 */

import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { DEFAULT_CONFIG } from './defaults';
import {
  ConfigError,
  findConfigFile,
  loadConfig,
  loadConfigFromString,
  mergeWithDefaults,
} from './load';
import { CONFIG_DIRNAME, CONFIG_FILENAME } from './load';

async function makeTempRepo(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'engram-config-'));
  // Mark as repo root so findConfigFile won't walk further up than this.
  await mkdir(join(dir, '.git'));
  return dir;
}

async function writeConfig(repoDir: string, body: string): Promise<string> {
  const cfgDir = join(repoDir, CONFIG_DIRNAME);
  await mkdir(cfgDir, { recursive: true });
  const file = join(cfgDir, CONFIG_FILENAME);
  await writeFile(file, body, 'utf8');
  return file;
}

describe('loadConfig', () => {
  let repoDir: string;
  const cleanup: string[] = [];

  beforeEach(async () => {
    repoDir = await makeTempRepo();
    cleanup.push(repoDir);
  });

  afterAll(async () => {
    for (const d of cleanup) {
      await rm(d, { recursive: true, force: true });
    }
  });

  it('returns DEFAULT_CONFIG and source=null when no file exists', async () => {
    const out = await loadConfig({ startDir: repoDir });
    expect(out.source).toBeNull();
    expect(out.config).toEqual(DEFAULT_CONFIG);
  });

  it('reads and validates a full config file', async () => {
    const file = await writeConfig(
      repoDir,
      [
        'passes:',
        '  intent:',
        '    model: anthropic/claude-haiku-4-5',
        '    fallback: google/gemini-2.5-pro',
        '    maxInputTokens: 12000',
        '    maxOutputTokens: 1500',
        '  contracts:',
        '    model: anthropic/claude-opus-4-7',
        '  gotchas:',
        '    maxLLMCalls: 5',
        '  synthesis:',
        '    repository:',
        '      model: anthropic/claude-opus-4-7',
        'budget:',
        '  dailyTokenCap: 750000',
        '  perPassTokenCap: 80000',
        'modules:',
        '  include: ["src/**"]',
        '  exclude: ["src/legacy/**", "dist/**"]',
        '',
      ].join('\n'),
    );

    const out = await loadConfig({ startDir: repoDir });
    expect(out.source).toBe(file);
    expect(out.config.passes.intent).toEqual({
      model: 'anthropic/claude-haiku-4-5',
      fallback: 'google/gemini-2.5-pro',
      maxInputTokens: 12000,
      maxOutputTokens: 1500,
    });
    // Partial overrides keep the rest of the defaults.
    expect(out.config.passes.contracts.model).toBe('anthropic/claude-opus-4-7');
    expect(out.config.passes.contracts.fallback).toBe(
      DEFAULT_CONFIG.passes.contracts.fallback,
    );
    expect(out.config.passes.gotchas.maxLLMCalls).toBe(5);
    expect(out.config.passes.gotchas.model).toBe(
      DEFAULT_CONFIG.passes.gotchas.model,
    );
    expect(out.config.passes.synthesis.repository.model).toBe(
      'anthropic/claude-opus-4-7',
    );
    expect(out.config.budget).toEqual({
      dailyTokenCap: 750000,
      perPassTokenCap: 80000,
    });
    expect(out.config.modules).toEqual({
      include: ['src/**'],
      exclude: ['src/legacy/**', 'dist/**'],
    });
  });

  it('treats an empty file as an empty mapping', async () => {
    const file = await writeConfig(repoDir, '');
    const out = await loadConfig({ startDir: repoDir });
    expect(out.source).toBe(file);
    expect(out.config).toEqual(DEFAULT_CONFIG);
  });

  it('throws ConfigError on malformed YAML', async () => {
    await writeConfig(repoDir, 'passes: [unterminated\n');
    await expect(loadConfig({ startDir: repoDir })).rejects.toBeInstanceOf(
      ConfigError,
    );
    await expect(loadConfig({ startDir: repoDir })).rejects.toThrow(
      /malformed YAML/,
    );
  });

  it('throws ConfigError when top-level is not a mapping', async () => {
    await writeConfig(repoDir, '- this\n- is\n- a\n- list\n');
    await expect(loadConfig({ startDir: repoDir })).rejects.toThrow(
      /YAML mapping/,
    );
  });

  it('rejects unknown fields (strict schema)', async () => {
    await writeConfig(repoDir, 'passes:\n  intent:\n    bogus: yes\n');
    await expect(loadConfig({ startDir: repoDir })).rejects.toThrow(
      /invalid config/,
    );
  });

  it('rejects negative or zero token caps', async () => {
    await writeConfig(repoDir, 'budget:\n  dailyTokenCap: 0\n');
    await expect(loadConfig({ startDir: repoDir })).rejects.toThrow(
      /invalid config/,
    );
  });

  it('walks up from a nested CWD to find the config', async () => {
    const file = await writeConfig(
      repoDir,
      'passes:\n  intent:\n    model: x/y\n',
    );
    const nested = join(repoDir, 'src', 'v2', 'passes', 'intent');
    await mkdir(nested, { recursive: true });
    const out = await loadConfig({ startDir: nested });
    expect(out.source).toBe(file);
    expect(out.config.passes.intent.model).toBe('x/y');
  });

  it('stops at the first .git boundary and ignores configs above it', async () => {
    // Outer repo has a config; inner repo (nested .git) should ignore it.
    await writeConfig(repoDir, 'passes:\n  intent:\n    model: outer/model\n');
    const inner = join(repoDir, 'apps', 'inner');
    await mkdir(join(inner, '.git'), { recursive: true });
    const out = await loadConfig({ startDir: inner });
    expect(out.source).toBeNull();
    expect(out.config).toEqual(DEFAULT_CONFIG);
  });

  it('honors an explicit path override', async () => {
    const file = await writeConfig(
      repoDir,
      'passes:\n  intent:\n    model: explicit/model\n',
    );
    const out = await loadConfig({
      startDir: '/tmp', // would otherwise miss
      explicitPath: file,
    });
    expect(out.source).toBe(file);
    expect(out.config.passes.intent.model).toBe('explicit/model');
  });

  it('throws when an explicit path is missing', async () => {
    await expect(
      loadConfig({ explicitPath: join(repoDir, 'nope.yaml') }),
    ).rejects.toThrow(/config file not found/);
  });
});

describe('findConfigFile', () => {
  it('returns null when nothing is found before the walk terminates', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'engram-config-empty-'));
    await mkdir(join(dir, '.git'));
    try {
      expect(findConfigFile(dir)).toBeNull();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('loadConfigFromString', () => {
  it('merges partial overrides with defaults', () => {
    const merged = loadConfigFromString(
      'passes:\n  intent:\n    model: foo/bar\n',
    );
    expect(merged.passes.intent.model).toBe('foo/bar');
    expect(merged.passes.intent.fallback).toBe(
      DEFAULT_CONFIG.passes.intent.fallback,
    );
    expect(merged.modules).toEqual(DEFAULT_CONFIG.modules);
  });

  it('treats undefined parse result the same as empty mapping', () => {
    const merged = loadConfigFromString('# just a comment\n');
    expect(merged).toEqual(DEFAULT_CONFIG);
  });
});

describe('mergeWithDefaults', () => {
  it('produces a deep clone independent of DEFAULT_CONFIG', () => {
    const merged = mergeWithDefaults({});
    expect(merged).toEqual(DEFAULT_CONFIG);
    merged.modules.exclude.push('extra/**');
    expect(DEFAULT_CONFIG.modules.exclude).not.toContain('extra/**');
  });

  it('replaces include/exclude arrays wholesale when provided', () => {
    const merged = mergeWithDefaults({
      modules: { include: ['lib/**'] },
    });
    expect(merged.modules.include).toEqual(['lib/**']);
    expect(merged.modules.exclude).toEqual(DEFAULT_CONFIG.modules.exclude);
  });
});
