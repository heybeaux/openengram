import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { DelegationContractService } from './delegation-contract.service';
import { FailurePatternService } from './failure-pattern.service';

export interface TaskCompletion {
  id: string;
  sessionKey: string;
  parentSessionKey?: string;
  agentId?: string;
  task: string;
  status: 'success' | 'failure' | 'timeout';
  durationMs: number;
  error?: string;
  metadata?: Record<string, any>;
  createdAt: string;
}

export interface LogTaskDto {
  sessionKey: string;
  parentSessionKey?: string;
  agentId?: string;
  task: string;
  status: 'success' | 'failure' | 'timeout';
  durationMs: number;
  error?: string;
  metadata?: Record<string, any>;
}

export interface QueryTasksDto {
  agentId?: string;
  status?: string;
  limit?: number;
  since?: string;
}

export interface RecallQuery {
  agentId?: string;
  task?: string;
  limit?: number;
}

const MAX_TASKS = 1000;

@Injectable()
export class DelegationTaskService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DelegationTaskService.name);
  private tasks = new Map<string, TaskCompletion>();
  /** Ordered list of task IDs for FIFO eviction */
  private taskOrder: string[] = [];

  constructor(
    private readonly prisma: PrismaService,
    private readonly contractService: DelegationContractService,
    private readonly failurePatternService: FailurePatternService,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      const rows = await this.prisma.identityTask.findMany({
        orderBy: { createdAt: 'asc' },
        take: MAX_TASKS,
      });
      for (const row of rows) {
        const task: TaskCompletion = {
          id: row.id,
          sessionKey: row.sessionKey,
          parentSessionKey: row.parentSessionKey ?? undefined,
          agentId: row.agentId ?? undefined,
          task: row.task,
          status: row.status as TaskCompletion['status'],
          durationMs: row.durationMs,
          error: row.error ?? undefined,
          metadata: (row.metadata as Record<string, any>) ?? undefined,
          createdAt: row.createdAt.toISOString(),
        };
        this.tasks.set(task.id, task);
        this.taskOrder.push(task.id);
      }
      if (this.tasks.size > 0) {
        this.logger.log(
          `Loaded ${this.tasks.size} delegation tasks from database`,
        );
      }
    } catch (err) {
      this.logger.warn(`Failed to load tasks from database: ${err}`);
    }
  }

  onModuleDestroy(): void {
    // No-op — all writes are persisted immediately
  }

  private persistTask(task: TaskCompletion): void {
    this.prisma.identityTask
      .create({
        data: {
          id: task.id,
          sessionKey: task.sessionKey,
          parentSessionKey: task.parentSessionKey ?? null,
          agentId: task.agentId ?? null,
          task: task.task,
          status: task.status,
          durationMs: task.durationMs,
          error: task.error ?? null,
          metadata: task.metadata ?? undefined,
          createdAt: new Date(task.createdAt),
        },
      })
      .catch((err) =>
        this.logger.warn(`Failed to persist task: ${err.message}`),
      );
  }

  private deleteTask(id: string): void {
    this.prisma.identityTask
      .delete({ where: { id } })
      .catch((err) =>
        this.logger.warn(`Failed to delete evicted task: ${err.message}`),
      );
  }

  logTask(dto: LogTaskDto): TaskCompletion {
    const task: TaskCompletion = {
      id: randomUUID(),
      sessionKey: dto.sessionKey,
      parentSessionKey: dto.parentSessionKey,
      agentId: dto.agentId,
      task: dto.task,
      status: dto.status,
      durationMs: dto.durationMs,
      error: dto.error,
      metadata: dto.metadata,
      createdAt: new Date().toISOString(),
    };

    this.tasks.set(task.id, task);
    this.taskOrder.push(task.id);

    // FIFO eviction
    while (this.taskOrder.length > MAX_TASKS) {
      const oldId = this.taskOrder.shift()!;
      this.tasks.delete(oldId);
      this.deleteTask(oldId);
    }

    // On failure, detect simple patterns
    if (task.status === 'failure' || task.status === 'timeout') {
      this.detectSimplePattern(task);
    }

    this.persistTask(task);
    return task;
  }

  private detectSimplePattern(current: TaskCompletion): void {
    const prefix = current.task.substring(0, 50);
    const recent = this.taskOrder
      .slice(-5)
      .map((id) => this.tasks.get(id)!)
      .filter(Boolean);

    const consecutiveFailures = recent.filter(
      (t) =>
        (t.status === 'failure' || t.status === 'timeout') &&
        t.task.substring(0, 50) === prefix,
    );

    if (consecutiveFailures.length >= 3) {
      this.logger.warn(
        `Detected repeated failure pattern: "${prefix}..." (${consecutiveFailures.length} consecutive failures)`,
      );
    }
  }

  getTasks(query: QueryTasksDto): { tasks: TaskCompletion[]; total: number } {
    let results = Array.from(this.tasks.values());

    if (query.agentId) {
      results = results.filter((t) => t.agentId === query.agentId);
    }
    if (query.status) {
      results = results.filter((t) => t.status === query.status);
    }
    if (query.since) {
      const sinceDate = new Date(query.since).getTime();
      results = results.filter(
        (t) => new Date(t.createdAt).getTime() >= sinceDate,
      );
    }

    const total = results.length;

    // Sort newest first
    results.sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );

    const limit = Math.min(query.limit ?? 20, 100);
    results = results.slice(0, limit);

    return { tasks: results, total };
  }

  getRecall(query: RecallQuery): {
    contracts: any[];
    tasks: TaskCompletion[];
    patterns: any[];
    summary: {
      totalTasks: number;
      successRate: number;
      avgDurationMs: number;
      commonFailures: string[];
    };
  } {
    const limit = query.limit ?? 5;

    // Contracts
    let contracts: any[] = [];
    try {
      if (query.agentId) {
        contracts = this.contractService
          .getByAgent(query.agentId)
          .slice(0, limit);
      } else {
        contracts = this.contractService.listAll().slice(0, limit);
      }
    } catch {
      // Contract service may not have data
    }

    // Tasks
    const { tasks } = this.getTasks({ agentId: query.agentId, limit });

    // Patterns
    let patterns: any[] = [];
    try {
      patterns = this.failurePatternService
        .getPatterns(query.agentId)
        .slice(0, limit);
    } catch {
      // Pattern service may not have data
    }

    // Summary — lazy compute over all tasks
    const allTasks = Array.from(this.tasks.values());
    const filtered = query.agentId
      ? allTasks.filter((t) => t.agentId === query.agentId)
      : allTasks;

    const totalTasks = filtered.length;
    const successes = filtered.filter((t) => t.status === 'success').length;
    const successRate = totalTasks > 0 ? successes / totalTasks : 0;
    const avgDurationMs =
      totalTasks > 0
        ? filtered.reduce((sum, t) => sum + t.durationMs, 0) / totalTasks
        : 0;

    // Common failures: count error messages
    const failureCounts = new Map<string, number>();
    filtered
      .filter((t) => t.status === 'failure' || t.status === 'timeout')
      .forEach((t) => {
        const key = t.error || t.status;
        failureCounts.set(key, (failureCounts.get(key) || 0) + 1);
      });
    const commonFailures = Array.from(failureCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([key]) => key);

    return {
      contracts,
      tasks,
      patterns,
      summary: { totalTasks, successRate, avgDurationMs, commonFailures },
    };
  }
}
