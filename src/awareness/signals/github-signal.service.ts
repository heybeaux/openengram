import { Injectable, Logger } from '@nestjs/common';
import { Observation, SignalSource } from './signal.interface';
import { AwarenessConfig } from '../config/awareness.config';

/**
 * GitHub Signal Source — watches configured repos for development patterns.
 *
 * Detects:
 * - Recent commit activity and velocity shifts
 * - Open/stale PRs (open > N days)
 * - Recently closed issues (shipped work patterns)
 * - PR review bottlenecks
 *
 * Requires AWARENESS_GITHUB_TOKEN and AWARENESS_GITHUB_REPOS env vars.
 * Fails gracefully if not configured — the Waking Cycle continues without it.
 */
@Injectable()
export class GitHubSignalService implements SignalSource {
  readonly name = 'github';
  private readonly logger = new Logger(GitHubSignalService.name);

  private readonly token: string | undefined;
  private readonly repos: string[];
  private readonly apiBase = 'https://api.github.com';

  constructor() {
    this.token = process.env.AWARENESS_GITHUB_TOKEN;
    this.repos = (process.env.AWARENESS_GITHUB_REPOS ?? '')
      .split(',')
      .map(r => r.trim())
      .filter(Boolean);

    if (this.token && this.repos.length > 0) {
      this.logger.log(
        `GitHub signal source configured for ${this.repos.length} repo(s): ${this.repos.join(', ')}`,
      );
    } else {
      this.logger.log(
        'GitHub signal source not configured (set AWARENESS_GITHUB_TOKEN and AWARENESS_GITHUB_REPOS)',
      );
    }
  }

  async collect(
    checkpoint: Record<string, unknown> | null,
    budget: { maxQueries: number },
  ): Promise<{
    observations: Observation[];
    checkpoint: Record<string, unknown>;
  }> {
    // If not configured, return empty — don't break the cycle
    if (!this.token || this.repos.length === 0) {
      return {
        observations: [],
        checkpoint: checkpoint ?? {},
      };
    }

    const since = checkpoint?.lastCheckedAt
      ? new Date(checkpoint.lastCheckedAt as string)
      : new Date(Date.now() - 24 * 60 * 60 * 1000); // default: last 24h

    const observations: Observation[] = [];
    let queriesUsed = 0;

    for (const repo of this.repos) {
      if (queriesUsed >= budget.maxQueries - 2) break; // reserve budget

      try {
        // ── 1. Recent commits ─────────────────────────────────────────
        if (queriesUsed < budget.maxQueries) {
          const commits = await this.fetchJson<GitHubCommit[]>(
            `/repos/${repo}/commits?since=${since.toISOString()}&per_page=30`,
          );
          queriesUsed++;

          if (commits.length > 0) {
            const authors = [...new Set(commits.map(c => c.commit.author.name))];
            const messages = commits
              .slice(0, 10)
              .map(c => c.commit.message.split('\n')[0])
              .join('; ');

            observations.push({
              id: `github-commits-${repo}-${new Date().toISOString()}`,
              source: this.name,
              content: `${commits.length} commits to ${repo} since ${since.toISOString()}. Authors: ${authors.join(', ')}. Recent: ${messages}`,
              observedAt: new Date(),
              metadata: {
                repo,
                type: 'commits',
                count: commits.length,
                authors,
              },
            });
          }
        }

        // ── 2. Open PRs (detect staleness) ────────────────────────────
        if (queriesUsed < budget.maxQueries) {
          const prs = await this.fetchJson<GitHubPR[]>(
            `/repos/${repo}/pulls?state=open&sort=updated&direction=desc&per_page=10`,
          );
          queriesUsed++;

          const stalePRs = prs.filter(
            pr => Date.now() - new Date(pr.created_at).getTime() > 3 * 24 * 60 * 60 * 1000,
          );

          if (prs.length > 0) {
            const prSummary = prs
              .map(pr => {
                const ageDays = Math.round(
                  (Date.now() - new Date(pr.created_at).getTime()) / (24 * 60 * 60 * 1000),
                );
                return `#${pr.number} "${pr.title}" (${ageDays}d old, by ${pr.user.login})`;
              })
              .join('; ');

            observations.push({
              id: `github-prs-${repo}-${new Date().toISOString()}`,
              source: this.name,
              content: `${prs.length} open PRs on ${repo}${stalePRs.length > 0 ? ` (${stalePRs.length} stale >3d)` : ''}. ${prSummary}`,
              observedAt: new Date(),
              metadata: {
                repo,
                type: 'open_prs',
                count: prs.length,
                staleCount: stalePRs.length,
              },
            });
          }
        }

        // ── 3. Recently closed issues (shipped work) ──────────────────
        if (queriesUsed < budget.maxQueries) {
          const issues = await this.fetchJson<GitHubIssue[]>(
            `/repos/${repo}/issues?state=closed&since=${since.toISOString()}&per_page=10&sort=updated`,
          );
          queriesUsed++;

          // Filter out PRs (GitHub API returns PRs in issues endpoint)
          const realIssues = issues.filter(i => !i.pull_request);

          if (realIssues.length > 0) {
            const issueSummary = realIssues
              .slice(0, 5)
              .map(i => `#${i.number} "${i.title}"`)
              .join('; ');

            observations.push({
              id: `github-closed-issues-${repo}-${new Date().toISOString()}`,
              source: this.name,
              content: `${realIssues.length} issues closed on ${repo} since ${since.toISOString()}. ${issueSummary}`,
              observedAt: new Date(),
              metadata: {
                repo,
                type: 'closed_issues',
                count: realIssues.length,
              },
            });
          }
        }
      } catch (error) {
        this.logger.warn(`Failed to fetch GitHub data for ${repo}: ${error.message}`);
      }
    }

    this.logger.log(
      `Collected ${observations.length} observations from ${this.repos.length} repo(s) using ${queriesUsed} API calls`,
    );

    return {
      observations,
      checkpoint: {
        lastCheckedAt: new Date().toISOString(),
        queriesUsed,
        observationCount: observations.length,
      },
    };
  }

  /** Authenticated fetch against GitHub API. */
  private async fetchJson<T>(path: string): Promise<T> {
    const response = await fetch(`${this.apiBase}${path}`, {
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': 'engram-awareness',
      },
    });

    if (!response.ok) {
      throw new Error(`GitHub API ${response.status}: ${response.statusText}`);
    }

    return response.json() as Promise<T>;
  }
}

// ── Minimal GitHub API types ──────────────────────────────────────────────

interface GitHubCommit {
  sha: string;
  commit: {
    author: { name: string; date: string };
    message: string;
  };
}

interface GitHubPR {
  number: number;
  title: string;
  state: string;
  created_at: string;
  updated_at: string;
  user: { login: string };
  draft: boolean;
}

interface GitHubIssue {
  number: number;
  title: string;
  state: string;
  created_at: string;
  closed_at: string | null;
  pull_request?: unknown;
  labels: { name: string }[];
}
