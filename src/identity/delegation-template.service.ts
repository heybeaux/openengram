import { Injectable, Logger } from '@nestjs/common';
import { TaskCompletionService, TaskCompletion } from './task-completion.service';

export interface DelegationTemplate {
  suggestedAgent: string;
  confidence: number;
  estimatedDurationMs: number;
  suggestedDomain: string | null;
  similarPastTasks: {
    taskId: string;
    taskDescription: string;
    agent: string;
    outcome: string;
    durationMs: number;
    similarity: number;
  }[];
  decomposition: string[];
}

@Injectable()
export class DelegationTemplateService {
  private readonly logger = new Logger(DelegationTemplateService.name);

  constructor(private taskCompletionService: TaskCompletionService) {}

  async suggest(taskDescription: string): Promise<DelegationTemplate> {
    const similar = await this.taskCompletionService.findSimilar(
      taskDescription,
      20,
    );

    if (similar.length === 0) {
      return {
        suggestedAgent: '',
        confidence: 0,
        estimatedDurationMs: 0,
        suggestedDomain: null,
        similarPastTasks: [],
        decomposition: [],
      };
    }

    // Aggregate agent performance from similar tasks
    const agentStats = new Map<
      string,
      { successes: number; total: number; totalDuration: number; totalSimilarity: number }
    >();

    for (const task of similar) {
      const stats = agentStats.get(task.delegatedTo) || {
        successes: 0,
        total: 0,
        totalDuration: 0,
        totalSimilarity: 0,
      };
      stats.total++;
      stats.totalSimilarity += task.similarity;
      stats.totalDuration += task.durationMs;
      if (task.outcome === 'success') stats.successes++;
      agentStats.set(task.delegatedTo, stats);
    }

    // Find best agent weighted by success rate * similarity
    let bestAgent = '';
    let bestScore = -1;

    for (const [agent, stats] of agentStats) {
      const successRate = stats.successes / stats.total;
      const avgSimilarity = stats.totalSimilarity / stats.total;
      const score = successRate * avgSimilarity;
      if (score > bestScore) {
        bestScore = score;
        bestAgent = agent;
      }
    }

    const bestStats = agentStats.get(bestAgent)!;
    const estimatedDuration = Math.round(
      bestStats.totalDuration / bestStats.total,
    );

    // Extract common domain from similar tasks
    const domains = similar
      .filter((t) => t.domain)
      .map((t) => t.domain!);
    const domainCounts = new Map<string, number>();
    for (const d of domains) {
      domainCounts.set(d, (domainCounts.get(d) || 0) + 1);
    }
    let suggestedDomain: string | null = null;
    let maxDomainCount = 0;
    for (const [d, count] of domainCounts) {
      if (count > maxDomainCount) {
        maxDomainCount = count;
        suggestedDomain = d;
      }
    }

    // Extract decomposition hints from task descriptions
    const decomposition = this.extractDecompositionHints(similar);

    return {
      suggestedAgent: bestAgent,
      confidence: Math.min(bestScore, 1),
      estimatedDurationMs: estimatedDuration,
      suggestedDomain,
      similarPastTasks: similar.slice(0, 5).map((t) => ({
        taskId: t.taskId,
        taskDescription: t.taskDescription,
        agent: t.delegatedTo,
        outcome: t.outcome,
        durationMs: t.durationMs,
        similarity: t.similarity,
      })),
      decomposition,
    };
  }

  private extractDecompositionHints(
    tasks: (TaskCompletion & { similarity: number })[],
  ): string[] {
    // Group by domain or task pattern to suggest subtask decomposition
    const domainGroups = new Map<string, string[]>();
    for (const t of tasks) {
      const domain = t.domain || 'general';
      const group = domainGroups.get(domain) || [];
      group.push(t.taskDescription);
      domainGroups.set(domain, group);
    }

    // Suggest one step per domain found
    const hints: string[] = [];
    for (const [domain, descriptions] of domainGroups) {
      if (domain !== 'general') {
        hints.push(`${domain}: ${descriptions[0]}`);
      }
    }
    return hints.slice(0, 5);
  }
}
