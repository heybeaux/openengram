import { Injectable, Logger } from '@nestjs/common';
import { TaskCompletionService, TaskCompletion } from './task-completion.service';

export interface DomainTrust {
  domain: string;
  trustScore: number;
  totalTasks: number;
  successRate: number;
  avgDurationMs: number;
  lastTaskAt: Date | null;
  trend: 'improving' | 'declining' | 'stable';
}

export interface TrustProfile {
  agentId: string;
  overallTrust: number;
  domains: DomainTrust[];
  totalTasksCompleted: number;
  lastUpdatedAt: Date;
}

@Injectable()
export class TrustProfileService {
  private readonly logger = new Logger(TrustProfileService.name);

  // Recency half-life: tasks older than this many days contribute less
  private readonly HALF_LIFE_DAYS = 30;

  constructor(private taskCompletionService: TaskCompletionService) {}

  async getProfile(agentId: string): Promise<TrustProfile> {
    const completions =
      await this.taskCompletionService.getCompletionsByAgent(agentId);

    if (completions.length === 0) {
      return {
        agentId,
        overallTrust: 0,
        domains: [],
        totalTasksCompleted: 0,
        lastUpdatedAt: new Date(),
      };
    }

    // Group by domain
    const domainMap = new Map<string, TaskCompletion[]>();
    for (const c of completions) {
      const domain = c.domain || 'general';
      const list = domainMap.get(domain) || [];
      list.push(c);
      domainMap.set(domain, list);
    }

    const domains: DomainTrust[] = [];
    const now = Date.now();

    for (const [domain, tasks] of domainMap) {
      const domainTrust = this.calculateDomainTrust(tasks, now);
      domains.push({ domain, ...domainTrust });
    }

    // Overall trust is weighted average by task count
    const totalWeightedTrust = domains.reduce(
      (sum, d) => sum + d.trustScore * d.totalTasks,
      0,
    );
    const totalTasks = domains.reduce((sum, d) => sum + d.totalTasks, 0);
    const overallTrust = totalTasks > 0 ? totalWeightedTrust / totalTasks : 0;

    return {
      agentId,
      overallTrust: Math.round(overallTrust * 1000) / 1000,
      domains: domains.sort((a, b) => b.totalTasks - a.totalTasks),
      totalTasksCompleted: completions.length,
      lastUpdatedAt: new Date(),
    };
  }

  private calculateDomainTrust(
    tasks: TaskCompletion[],
    now: number,
  ): Omit<DomainTrust, 'domain'> {
    let weightedSuccess = 0;
    let totalWeight = 0;
    let totalDuration = 0;
    let lastTaskAt: Date | null = null;

    // Sort by date for trend detection
    const sorted = [...tasks].sort(
      (a, b) =>
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    );

    for (const task of sorted) {
      const ageMs = now - new Date(task.createdAt).getTime();
      const ageDays = ageMs / (1000 * 60 * 60 * 24);
      // Exponential decay: weight = 2^(-ageDays / halfLife)
      const weight = Math.pow(2, -ageDays / this.HALF_LIFE_DAYS);

      const success = task.outcome === 'success' ? 1 : task.outcome === 'partial' ? 0.5 : 0;
      weightedSuccess += success * weight;
      totalWeight += weight;
      totalDuration += task.durationMs;

      const taskDate = new Date(task.createdAt);
      if (!lastTaskAt || taskDate > lastTaskAt) {
        lastTaskAt = taskDate;
      }
    }

    const trustScore =
      totalWeight > 0
        ? Math.round((weightedSuccess / totalWeight) * 1000) / 1000
        : 0;

    // Trend: compare first half vs second half success rates
    const mid = Math.floor(sorted.length / 2);
    const trend = this.detectTrend(sorted, mid);

    return {
      trustScore,
      totalTasks: tasks.length,
      successRate:
        Math.round(
          (tasks.filter((t) => t.outcome === 'success').length / tasks.length) *
            1000,
        ) / 1000,
      avgDurationMs: Math.round(totalDuration / tasks.length),
      lastTaskAt,
      trend,
    };
  }

  private detectTrend(
    sorted: TaskCompletion[],
    mid: number,
  ): 'improving' | 'declining' | 'stable' {
    if (sorted.length < 4) return 'stable';

    const firstHalf = sorted.slice(0, mid);
    const secondHalf = sorted.slice(mid);

    const firstRate =
      firstHalf.filter((t) => t.outcome === 'success').length /
      firstHalf.length;
    const secondRate =
      secondHalf.filter((t) => t.outcome === 'success').length /
      secondHalf.length;

    const diff = secondRate - firstRate;
    if (diff > 0.1) return 'improving';
    if (diff < -0.1) return 'declining';
    return 'stable';
  }

  /**
   * Dream Cycle stage: recalculate all trust profiles.
   * Called nightly during the dream cycle.
   */
  async recalculateAllProfiles(): Promise<{
    agentsUpdated: number;
    errors: string[];
  }> {
    this.logger.log('Dream Cycle: recalculating trust profiles');

    // Get all distinct agent IDs from task completions
    const agents = await this.getDistinctAgents();
    let updated = 0;
    const errors: string[] = [];

    for (const agentId of agents) {
      try {
        await this.getProfile(agentId);
        updated++;
      } catch (e) {
        errors.push(`Failed to update profile for ${agentId}: ${e}`);
      }
    }

    this.logger.log(
      `Dream Cycle: updated ${updated} trust profiles, ${errors.length} errors`,
    );
    return { agentsUpdated: updated, errors };
  }

  /**
   * Get trust history for an agent over the specified number of days.
   * Returns daily trust snapshots with overall score and per-domain scores.
   */
  async getTrustHistory(
    agentId: string,
    days: number = 30,
  ): Promise<{ history: Array<{ date: string; overall: number; domains: Record<string, number> }> }> {
    const completions =
      await this.taskCompletionService.getCompletionsByAgent(agentId);

    const now = new Date();
    const history: Array<{ date: string; overall: number; domains: Record<string, number> }> = [];

    for (let i = days - 1; i >= 0; i--) {
      const date = new Date(now);
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split('T')[0];
      const cutoff = date.getTime() + 24 * 60 * 60 * 1000;

      // Filter completions up to this date
      const relevant = completions.filter(
        (c) => new Date(c.createdAt).getTime() < cutoff,
      );

      if (relevant.length === 0) {
        history.push({ date: dateStr, overall: 0, domains: {} });
        continue;
      }

      // Group by domain
      const domainMap = new Map<string, typeof relevant>();
      for (const c of relevant) {
        const domain = c.domain || 'general';
        const list = domainMap.get(domain) || [];
        list.push(c);
        domainMap.set(domain, list);
      }

      const domains: Record<string, number> = {};
      let totalWeighted = 0;
      let totalTasks = 0;

      for (const [domain, tasks] of domainMap) {
        const successCount = tasks.filter((t) => t.outcome === 'success').length;
        const partialCount = tasks.filter((t) => t.outcome === 'partial').length;
        const score = (successCount + partialCount * 0.5) / tasks.length;
        domains[domain] = Math.round(score * 1000) / 1000;
        totalWeighted += score * tasks.length;
        totalTasks += tasks.length;
      }

      const overall = totalTasks > 0 ? Math.round((totalWeighted / totalTasks) * 1000) / 1000 : 0;
      history.push({ date: dateStr, overall, domains });
    }

    return { history };
  }

  /**
   * Get trust profiles for multiple agents at once.
   */
  async getBulkProfiles(agentIds: string[]): Promise<{ profiles: TrustProfile[] }> {
    const profiles = await Promise.all(
      agentIds.map((id) => this.getProfile(id)),
    );
    return { profiles };
  }

  private async getDistinctAgents(): Promise<string[]> {
    try {
      const results = await this.taskCompletionService['prisma']
        .taskCompletion.findMany({
          select: { delegatedTo: true },
          distinct: ['delegatedTo'],
        });
      return results.map((r: any) => r.delegatedTo);
    } catch {
      return [];
    }
  }
}
