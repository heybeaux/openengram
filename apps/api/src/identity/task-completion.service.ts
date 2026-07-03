import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EmbeddingService } from '../embedding/embedding.service';
import {
  CreateTaskCompletionDto,
  QueryTaskCompletionsDto,
} from './dto/task-completion.dto';

export interface TaskCompletion {
  id: string;
  taskId: string;
  delegatedTo: string;
  delegatedBy: string;
  taskDescription: string;
  domain: string | null;
  outcome: string;
  durationMs: number;
  qualitySignals: Record<string, any>;
  metadata: Record<string, any>;
  createdAt: Date;
}

@Injectable()
export class TaskCompletionService {
  private readonly logger = new Logger(TaskCompletionService.name);

  constructor(
    private prisma: PrismaService,
    private embeddingService: EmbeddingService,
  ) {}

  async create(dto: CreateTaskCompletionDto): Promise<TaskCompletion> {
    // Store as a memory with type TASK_COMPLETION and structured metadata
    const content = `Task completion: ${dto.taskDescription} | delegated to ${dto.delegatedTo} by ${dto.delegatedBy} | outcome: ${dto.outcome} | duration: ${dto.durationMs}ms`;

    let embedding: number[] | undefined;
    try {
      embedding = await this.embeddingService.embedOne(dto.taskDescription);
    } catch (e) {
      this.logger.warn('Failed to generate embedding for task completion', e);
    }

    const record = await this.prisma.taskCompletion.create({
      data: {
        taskId: dto.taskId,
        delegatedTo: dto.delegatedTo,
        delegatedBy: dto.delegatedBy,
        taskDescription: dto.taskDescription,
        domain: dto.domain || null,
        outcome: dto.outcome,
        durationMs: dto.durationMs,
        qualitySignals: dto.qualitySignals || {},
        metadata: dto.metadata || {},
        embeddingText: content,
      },
    });

    // Store embedding in vector DB if available
    if (embedding) {
      try {
        await this.prisma.$executeRawUnsafe(
          `UPDATE task_completions SET embedding = $1::vector WHERE id = $2`,
          `[${embedding.join(',')}]`,
          record.id,
        );
      } catch (e) {
        this.logger.warn('Failed to store embedding vector', e);
      }
    }

    return record as TaskCompletion;
  }

  async query(dto: QueryTaskCompletionsDto): Promise<TaskCompletion[]> {
    const where: any = {};
    if (dto.agentId) {
      where.OR = [{ delegatedTo: dto.agentId }, { delegatedBy: dto.agentId }];
    }
    if (dto.taskId) {
      where.taskId = dto.taskId;
    }

    const records = await this.prisma.taskCompletion.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: dto.limit || 50,
      skip: dto.offset || 0,
    });

    return records as TaskCompletion[];
  }

  async findSimilar(
    taskDescription: string,
    limit = 10,
  ): Promise<(TaskCompletion & { similarity: number })[]> {
    let embedding: number[];
    try {
      embedding = await this.embeddingService.embedOne(taskDescription);
    } catch (e) {
      this.logger.warn('Embedding failed, falling back to text search');
      return this.fallbackTextSearch(taskDescription, limit);
    }

    try {
      const results = await this.prisma.$queryRawUnsafe<
        (TaskCompletion & { similarity: number })[]
      >(
        `SELECT *, 1 - (embedding <=> $1::vector) as similarity
         FROM task_completions
         WHERE embedding IS NOT NULL
         ORDER BY embedding <=> $1::vector
         LIMIT $2`,
        `[${embedding.join(',')}]`,
        limit,
      );
      return results;
    } catch (e) {
      this.logger.warn('Vector search failed, falling back to text search');
      return this.fallbackTextSearch(taskDescription, limit);
    }
  }

  private async fallbackTextSearch(
    taskDescription: string,
    limit: number,
  ): Promise<(TaskCompletion & { similarity: number })[]> {
    const records = await this.prisma.taskCompletion.findMany({
      where: {
        taskDescription: {
          contains: taskDescription.split(' ').slice(0, 3).join(' '),
          mode: 'insensitive',
        },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return records.map((r) => ({ ...r, similarity: 0.5 })) as any;
  }

  async getCompletionsByAgent(
    agentId: string,
    domain?: string,
  ): Promise<TaskCompletion[]> {
    const where: any = { delegatedTo: agentId };
    if (domain) {
      where.domain = domain;
    }
    return this.prisma.taskCompletion.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    }) as any;
  }
}
