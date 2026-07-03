/**
 * Thin wrapper around `git clone` for the ingest worker (EC-39a).
 *
 * Kept behind an interface so the integration test can swap a fake
 * implementation that lays down fixture files instead of hitting the
 * network. Classifies common failure modes (404 / private / too-large /
 * network) into a discriminated error so the controller can return
 * user-facing messages without re-parsing stderr.
 */

import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';

import type { IngestFailureKind } from './types';

export interface CloneAdapterOptions {
  cloneUrl: string;
  ref?: string;
  targetDir: string;
  /** Cap on cloned tree size in bytes. Default 500 MB. */
  maxBytes?: number;
  /** Cap on clone duration. Default 4 minutes. */
  timeoutMs?: number;
}

export class CloneError extends Error {
  constructor(
    public readonly kind: IngestFailureKind,
    message: string,
  ) {
    super(message);
    this.name = 'CloneError';
  }
}

export interface GitCloneAdapter {
  clone(opts: CloneAdapterOptions): Promise<void>;
}

const DEFAULT_MAX_BYTES = 500 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 4 * 60 * 1000;

/**
 * Production adapter. Spawns `git clone --depth=1 [--branch <ref>] <url>
 * <dir>` and inspects stderr/exit code to classify failures.
 */
export class RealGitCloneAdapter implements GitCloneAdapter {
  async clone(opts: CloneAdapterOptions): Promise<void> {
    const { cloneUrl, ref, targetDir } = opts;
    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    await fs.mkdir(targetDir, { recursive: true });

    const args = ['clone', '--depth=1', '--single-branch'];
    if (ref) args.push('--branch', ref);
    args.push(cloneUrl, targetDir);

    const { code, stderr } = await runGit(args, timeoutMs);
    if (code !== 0) {
      throw classifyCloneFailure(stderr || `git exited with code ${code}`);
    }

    await enforceSizeCap(targetDir, opts.maxBytes ?? DEFAULT_MAX_BYTES);
  }
}

function classifyCloneFailure(stderr: string): CloneError {
  const lower = stderr.toLowerCase();
  if (
    lower.includes('repository not found') ||
    lower.includes('could not read from remote repository') ||
    lower.includes('not found')
  ) {
    // GitHub returns "Repository not found" for both nonexistent and
    // private repos when unauthenticated. We can't tell them apart from
    // stderr alone — surface the ambiguous case as "private or missing".
    return new CloneError(
      'not-found',
      'Repository not found or private. Public repos only for now.',
    );
  }
  if (lower.includes('authentication failed') || lower.includes('terminal prompts disabled')) {
    return new CloneError('private', 'This repo appears to be private. Public repos only.');
  }
  if (
    lower.includes('could not resolve host') ||
    lower.includes('connection timed out') ||
    lower.includes('timed out')
  ) {
    return new CloneError('network', 'Network error reaching GitHub. Try again.');
  }
  if (lower.includes('disk') || lower.includes('no space')) {
    return new CloneError('storage', 'Out of disk space.');
  }
  return new CloneError(
    'network',
    `Clone failed: ${stderr.split('\n')[0] || 'unknown error'}`,
  );
}

async function runGit(
  args: string[],
  timeoutMs: number,
): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, {
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    });
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new CloneError('network', 'Clone timed out.'));
    }, timeoutMs);
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(new CloneError('network', err.message));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, stderr });
    });
  });
}

async function enforceSizeCap(dir: string, maxBytes: number): Promise<void> {
  const bytes = await dirSize(dir);
  if (bytes > maxBytes) {
    const mb = Math.round(bytes / (1024 * 1024));
    const capMb = Math.round(maxBytes / (1024 * 1024));
    throw new CloneError(
      'too-large',
      `Cloned repo is ${mb}MB; cap is ${capMb}MB.`,
    );
  }
}

async function dirSize(dir: string): Promise<number> {
  let total = 0;
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const abs = `${dir}/${entry.name}`;
    if (entry.isDirectory()) {
      total += await dirSize(abs);
    } else if (entry.isFile()) {
      const stat = await fs.stat(abs);
      total += stat.size;
    }
  }
  return total;
}
