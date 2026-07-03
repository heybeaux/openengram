/**
 * Filesystem-backed cards repository (EC-28 Phase 2 / EC-39b multi-repo).
 *
 * Centralizes the on-disk read paths used by the v2 API controllers so the
 * map/search/subsystems endpoints don't each re-implement the conventions
 * defined by the markdown writer (EC-14). Once the Postgres `cards` table
 * is the source of truth, this is the single layer to swap.
 *
 * EC-39b: every read method now accepts an optional `repoId`. When set,
 * artifacts are resolved under `~/.engram-code/artifacts/<repoId>/`. When
 * omitted, falls back to the legacy single-repo behavior (env override or
 * `<cwd>/.engram/artifacts/`).
 */

import { Injectable, Logger } from '@nestjs/common';
import { promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import { join, relative, sep } from 'node:path';

import { cardFilePath, readCard } from '../../writers/markdown/writer';
import type { Card } from '../../writers/markdown/types';

/** Root used by the EC-39 ingest worker for per-repo artifacts. */
export function multiRepoArtifactsRoot(): string {
  return join(homedir(), '.engram-code', 'artifacts');
}

/** Validate a repoId for path safety. Only `[A-Za-z0-9._-]` allowed. */
export function isValidRepoId(repoId: string): boolean {
  return /^[A-Za-z0-9._-]+$/.test(repoId);
}

@Injectable()
export class CardsFsService {
  private readonly logger = new Logger(CardsFsService.name);

  /**
   * Resolve the configured artifacts root. When `repoId` is provided, scope
   * to `~/.engram-code/artifacts/<repoId>/`. Otherwise the legacy behavior:
   * env override > `<cwd>/.engram/artifacts`.
   */
  resolveArtifactsRoot(repoId?: string): string {
    if (repoId !== undefined && repoId !== '') {
      if (!isValidRepoId(repoId)) {
        throw new Error(`Invalid repoId: ${repoId}`);
      }
      return join(multiRepoArtifactsRoot(), repoId);
    }
    const fromEnv = process.env.ENGRAM_ARTIFACTS_ROOT;
    if (fromEnv && fromEnv.trim() !== '') return fromEnv;
    return join(process.cwd(), '.engram', 'artifacts');
  }

  /** Resolve the on-disk path for a card by concept path. */
  cardFilePath(conceptPath: string, repoId?: string): string {
    return cardFilePath(this.resolveArtifactsRoot(repoId), conceptPath);
  }

  /**
   * Enumerate every card under `<root>/cards/`. Returns concept paths only —
   * callers can `readOne` for the bodies when needed.
   *
   * Empty/missing root is a legitimate "no cards yet" state and returns `[]`.
   */
  async listConceptPaths(repoId?: string): Promise<string[]> {
    const cardsDir = join(this.resolveArtifactsRoot(repoId), 'cards');
    try {
      const paths = await walkMarkdown(cardsDir);
      paths.sort();
      return paths;
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
      this.logger.error(`Failed to list cards under ${cardsDir}`, err as Error);
      throw err;
    }
  }

  /**
   * Read one card by concept path. Returns `null` if the file does not exist
   * — callers decide between 404 and "skip" semantics.
   */
  async readOne(conceptPath: string, repoId?: string): Promise<Card | null> {
    try {
      return await readCard(this.cardFilePath(conceptPath, repoId));
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
  }

  /**
   * Read every card under the artifacts root. Convenient for in-memory
   * search/map operations on small repos. Cards that fail to parse are
   * logged and skipped rather than aborting the whole request.
   */
  async readAll(repoId?: string): Promise<Card[]> {
    const paths = await this.listConceptPaths(repoId);
    const out: Card[] = [];
    for (const conceptPath of paths) {
      try {
        const card = await readCard(this.cardFilePath(conceptPath, repoId));
        out.push(card);
      } catch (err) {
        this.logger.warn(
          `Skipping unreadable card ${conceptPath}: ${(err as Error).message}`,
        );
      }
    }
    return out;
  }

  /** Read every `<root>/subsystems/*.md` file as raw text. */
  async listSubsystemFiles(
    repoId?: string,
  ): Promise<Array<{ slug: string; raw: string }>> {
    const dir = join(this.resolveArtifactsRoot(repoId), 'subsystems');
    let entries: import('node:fs').Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw err;
    }
    const out: Array<{ slug: string; raw: string }> = [];
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
      const slug = entry.name.slice(0, -3);
      const raw = await fs.readFile(join(dir, entry.name), 'utf8');
      out.push({ slug, raw });
    }
    out.sort((a, b) => a.slug.localeCompare(b.slug));
    return out;
  }

  /**
   * List every repoId with at least one card on disk under the multi-repo
   * artifacts root. Useful for the dashboard "recent ingests" view to know
   * which repos are queryable.
   */
  async listRepoIds(): Promise<string[]> {
    const root = multiRepoArtifactsRoot();
    let entries: import('node:fs').Dirent[];
    try {
      entries = await fs.readdir(root, { withFileTypes: true });
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw err;
    }
    const out: string[] = [];
    for (const entry of entries) {
      if (entry.isDirectory() && isValidRepoId(entry.name)) {
        out.push(entry.name);
      }
    }
    out.sort();
    return out;
  }
}

async function walkMarkdown(rootDir: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(abs);
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        const rel = relative(rootDir, abs).split(sep).join('/');
        out.push(rel.slice(0, -3));
      }
    }
  }
  await walk(rootDir);
  return out;
}
