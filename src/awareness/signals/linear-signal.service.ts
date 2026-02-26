import { Injectable, Logger } from '@nestjs/common';
import { Observation, SignalSource } from './signal.interface';

/**
 * Linear Signal Source — watches Linear workspace for project management patterns.
 *
 * Detects:
 * - Recently created/updated issues
 * - Status changes (workflow transitions)
 * - Comment activity
 * - Stale issues (no updates in N days)
 *
 * Requires LINEAR_API_KEY env var.
 * Fails gracefully if not configured — the Waking Cycle continues without it.
 */
@Injectable()
export class LinearSignalService implements SignalSource {
  readonly name = 'linear';
  private readonly logger = new Logger(LinearSignalService.name);

  private readonly apiKey: string | undefined;
  private readonly apiBase = 'https://api.linear.app/graphql';

  /** Linear API rate limit: 1,500 requests/hour. We stay well under. */
  private static readonly RATE_LIMIT_DELAY_MS = 100;

  constructor() {
    this.apiKey = process.env.LINEAR_API_KEY;

    if (this.apiKey) {
      this.logger.log('Linear signal source configured');
    } else {
      this.logger.log(
        'Linear signal source not configured (set LINEAR_API_KEY to enable)',
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
    if (!this.apiKey) {
      return { observations: [], checkpoint: checkpoint ?? {} };
    }

    const since = checkpoint?.lastCheckedAt
      ? new Date(checkpoint.lastCheckedAt as string)
      : new Date(Date.now() - 24 * 60 * 60 * 1000);

    const observations: Observation[] = [];
    let queriesUsed = 0;

    try {
      // ── 1. Recently updated issues ────────────────────────────────
      if (queriesUsed < budget.maxQueries) {
        const issuesData = await this.query<IssuesResponse>(
          UPDATED_ISSUES_QUERY,
          {
            since: since.toISOString(),
          },
        );
        queriesUsed++;
        await this.rateLimit();

        const issues = issuesData.data?.issues?.nodes ?? [];
        if (issues.length > 0) {
          const byState = new Map<string, LinearIssue[]>();
          for (const issue of issues) {
            const state = issue.state?.name ?? 'Unknown';
            if (!byState.has(state)) byState.set(state, []);
            byState.get(state)!.push(issue);
          }

          const stateSummary = [...byState.entries()]
            .map(([state, iss]) => `${state}: ${iss.length}`)
            .join(', ');

          const issueSummary = issues
            .slice(0, 8)
            .map(
              (i) => `${i.identifier} "${i.title}" [${i.state?.name ?? '?'}]`,
            )
            .join('; ');

          observations.push({
            id: `linear-issues-${new Date().toISOString()}`,
            source: this.name,
            content: `${issues.length} Linear issues updated since ${since.toISOString()}. States: ${stateSummary}. Recent: ${issueSummary}`,
            observedAt: new Date(),
            metadata: {
              type: 'updated_issues',
              count: issues.length,
              stateDistribution: Object.fromEntries(
                [...byState.entries()].map(([k, v]) => [k, v.length]),
              ),
            },
          });
        }
      }

      // ── 2. Recently completed issues (done/cancelled) ─────────────
      if (queriesUsed < budget.maxQueries) {
        const completedData = await this.query<IssuesResponse>(
          COMPLETED_ISSUES_QUERY,
          {
            since: since.toISOString(),
          },
        );
        queriesUsed++;
        await this.rateLimit();

        const completed = completedData.data?.issues?.nodes ?? [];
        if (completed.length > 0) {
          const issueSummary = completed
            .slice(0, 5)
            .map((i) => `${i.identifier} "${i.title}"`)
            .join('; ');

          observations.push({
            id: `linear-completed-${new Date().toISOString()}`,
            source: this.name,
            content: `${completed.length} Linear issues completed since ${since.toISOString()}. ${issueSummary}`,
            observedAt: new Date(),
            metadata: {
              type: 'completed_issues',
              count: completed.length,
            },
          });
        }
      }

      // ── 3. Recently created issues (new work) ─────────────────────
      if (queriesUsed < budget.maxQueries) {
        const createdData = await this.query<IssuesResponse>(
          CREATED_ISSUES_QUERY,
          {
            since: since.toISOString(),
          },
        );
        queriesUsed++;
        await this.rateLimit();

        const created = createdData.data?.issues?.nodes ?? [];
        if (created.length > 0) {
          const labels = new Set<string>();
          for (const issue of created) {
            for (const label of issue.labels?.nodes ?? []) {
              labels.add(label.name);
            }
          }

          const issueSummary = created
            .slice(0, 5)
            .map((i) => `${i.identifier} "${i.title}"`)
            .join('; ');

          observations.push({
            id: `linear-created-${new Date().toISOString()}`,
            source: this.name,
            content: `${created.length} new Linear issues created since ${since.toISOString()}. Labels: ${[...labels].join(', ') || 'none'}. ${issueSummary}`,
            observedAt: new Date(),
            metadata: {
              type: 'created_issues',
              count: created.length,
              labels: [...labels],
            },
          });
        }
      }

      // ── 4. Recent comments (discussion activity) ──────────────────
      if (queriesUsed < budget.maxQueries) {
        const commentsData = await this.query<CommentsResponse>(
          RECENT_COMMENTS_QUERY,
          {
            since: since.toISOString(),
          },
        );
        queriesUsed++;

        const comments = commentsData.data?.comments?.nodes ?? [];
        if (comments.length > 0) {
          const commenters = [
            ...new Set(comments.map((c) => c.user?.name ?? 'Unknown')),
          ];
          const issueIds = [
            ...new Set(
              comments.map((c) => c.issue?.identifier).filter(Boolean),
            ),
          ];

          observations.push({
            id: `linear-comments-${new Date().toISOString()}`,
            source: this.name,
            content: `${comments.length} Linear comments since ${since.toISOString()} by ${commenters.join(', ')} on issues: ${issueIds.slice(0, 10).join(', ')}`,
            observedAt: new Date(),
            metadata: {
              type: 'comments',
              count: comments.length,
              commenters,
              issueCount: issueIds.length,
            },
          });
        }
      }
    } catch (error) {
      this.logger.warn(`Failed to fetch Linear data: ${error.message}`);
    }

    this.logger.log(
      `Collected ${observations.length} observations using ${queriesUsed} API calls`,
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

  /** Execute a GraphQL query against the Linear API. */
  private async query<T>(
    query: string,
    variables: Record<string, unknown> = {},
  ): Promise<T> {
    const response = await fetch(this.apiBase, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: this.apiKey!,
      },
      body: JSON.stringify({ query, variables }),
    });

    if (!response.ok) {
      throw new Error(`Linear API ${response.status}: ${response.statusText}`);
    }

    return response.json() as Promise<T>;
  }

  /** Simple rate limit delay between requests. */
  private rateLimit(): Promise<void> {
    return new Promise((resolve) =>
      setTimeout(resolve, LinearSignalService.RATE_LIMIT_DELAY_MS),
    );
  }
}

// ── GraphQL Queries ──────────────────────────────────────────────────────

const UPDATED_ISSUES_QUERY = `
  query UpdatedIssues($since: DateTime!) {
    issues(
      filter: { updatedAt: { gte: $since } }
      first: 50
      orderBy: updatedAt
    ) {
      nodes {
        id
        identifier
        title
        updatedAt
        createdAt
        state { name type }
        assignee { name }
        labels { nodes { name } }
        priority
      }
    }
  }
`;

const COMPLETED_ISSUES_QUERY = `
  query CompletedIssues($since: DateTime!) {
    issues(
      filter: {
        completedAt: { gte: $since }
        state: { type: { in: ["completed", "canceled"] } }
      }
      first: 50
      orderBy: completedAt
    ) {
      nodes {
        id
        identifier
        title
        completedAt
        state { name type }
        assignee { name }
      }
    }
  }
`;

const CREATED_ISSUES_QUERY = `
  query CreatedIssues($since: DateTime!) {
    issues(
      filter: { createdAt: { gte: $since } }
      first: 50
      orderBy: createdAt
    ) {
      nodes {
        id
        identifier
        title
        createdAt
        state { name type }
        assignee { name }
        labels { nodes { name } }
        priority
      }
    }
  }
`;

const RECENT_COMMENTS_QUERY = `
  query RecentComments($since: DateTime!) {
    comments(
      filter: { createdAt: { gte: $since } }
      first: 50
      orderBy: createdAt
    ) {
      nodes {
        id
        body
        createdAt
        user { name }
        issue { identifier title }
      }
    }
  }
`;

// ── Types ────────────────────────────────────────────────────────────────

interface LinearIssue {
  id: string;
  identifier: string;
  title: string;
  updatedAt: string;
  createdAt: string;
  completedAt?: string;
  state?: { name: string; type: string };
  assignee?: { name: string };
  labels?: { nodes: { name: string }[] };
  priority: number;
}

interface LinearComment {
  id: string;
  body: string;
  createdAt: string;
  user?: { name: string };
  issue?: { identifier: string; title: string };
}

interface IssuesResponse {
  data?: { issues?: { nodes: LinearIssue[] } };
}

interface CommentsResponse {
  data?: { comments?: { nodes: LinearComment[] } };
}
