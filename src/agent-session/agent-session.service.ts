import { Injectable, NotFoundException, Inject, Optional, forwardRef } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateAgentSessionDto,
  UpdateAgentSessionDto,
} from './dto/agent-session.dto';
import { AgentSessionStatus } from '@prisma/client';
import { MemoryPoolService } from '../memory-pool/memory-pool.service';

@Injectable()
export class AgentSessionService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() @Inject(forwardRef(() => MemoryPoolService)) private readonly memoryPoolService?: MemoryPoolService,
  ) {}

  /**
   * Register or upsert an agent session.
   * When a label is provided and userId is given, auto-creates a SHARED pool
   * named "task:<label>" and grants WRITE to the sub-agent and READ to the parent.
   */
  async upsert(dto: CreateAgentSessionDto) {
    // Default token budget: 4000 for main sessions, 2000 for sub-agents
    const defaultBudget = dto.parentKey ? 2000 : 4000;
    const contextTokenBudget = dto.contextTokenBudget ?? defaultBudget;

    const session = await this.prisma.agentSession.upsert({
      where: { sessionKey: dto.sessionKey },
      update: {
        label: dto.label,
        taskDescription: dto.taskDescription,
        contextTokenBudget,
        status: 'ACTIVE',
        endedAt: null,
      },
      create: {
        sessionKey: dto.sessionKey,
        parentKey: dto.parentKey,
        label: dto.label,
        taskDescription: dto.taskDescription,
        contextTokenBudget,
      },
    });

    // Auto-pool creation when label and userId are provided
    let poolId: string | undefined;
    if (dto.label && dto.userId && this.memoryPoolService) {
      try {
        const poolName = `task:${dto.label}`;
        const pool = await this.memoryPoolService.findOrCreatePool({
          name: poolName,
          userId: dto.userId,
          visibility: 'SHARED',
          description: dto.taskDescription ?? `Task pool for ${dto.label}`,
          createdBy: dto.sessionKey,
        });
        poolId = pool.id;

        // Grant WRITE to the sub-agent
        await this.memoryPoolService.grantAccess(pool.id, {
          agentSessionId: session.id,
          permission: 'WRITE',
          grantedBy: dto.sessionKey,
        });

        // Grant READ to parent if parent exists
        if (dto.parentKey) {
          const parentSession = await this.findByKey(dto.parentKey);
          if (parentSession) {
            await this.memoryPoolService.grantAccess(pool.id, {
              agentSessionId: parentSession.id,
              permission: 'READ',
              grantedBy: dto.sessionKey,
            });
          }
        }

        // Grant READ to sub-agent on GLOBAL pool (if exists)
        const globalPool = await this.prisma.memoryPool.findFirst({
          where: { userId: dto.userId, name: 'global', visibility: 'GLOBAL', archivedAt: null },
        });
        if (globalPool) {
          await this.memoryPoolService.grantAccess(globalPool.id, {
            agentSessionId: session.id,
            permission: 'READ',
            grantedBy: dto.sessionKey,
          }).catch(() => {}); // Ignore if already granted
        }
      } catch (err) {
        console.error('[AgentSession] Auto-pool creation failed:', err);
      }
    }

    return { ...session, poolId };
  }

  async getByKey(sessionKey: string) {
    const session = await this.prisma.agentSession.findUnique({
      where: { sessionKey },
    });
    if (!session)
      throw new NotFoundException(`Agent session '${sessionKey}' not found`);
    return session;
  }

  async findByKey(sessionKey: string) {
    return this.prisma.agentSession.findUnique({
      where: { sessionKey },
    });
  }

  async updateStatus(sessionKey: string, dto: UpdateAgentSessionDto) {
    const session = await this.getByKey(sessionKey);
    const updated = await this.prisma.agentSession.update({
      where: { id: session.id },
      data: {
        ...dto,
        endedAt:
          dto.status === AgentSessionStatus.COMPLETED ||
          dto.status === AgentSessionStatus.TERMINATED
            ? new Date()
            : undefined,
      },
    });

    // On COMPLETED: promote high-scoring memories from task pool to global pool
    if (dto.status === AgentSessionStatus.COMPLETED && this.memoryPoolService) {
      await this.promoteHighScoringMemories(session, sessionKey).catch((err) =>
        console.error('[AgentSession] Memory promotion failed:', err),
      );
    }

    return updated;
  }

  /**
   * Promote memories with effectiveScore > 0.7 from a session's task pool to the GLOBAL pool.
   * Lower-scored memories remain only in the task pool.
   */
  private async promoteHighScoringMemories(
    session: { id: string; label?: string | null },
    sessionKey: string,
  ) {
    if (!session.label || !this.memoryPoolService) return;

    const poolName = `task:${session.label}`;

    // Find the task pool
    // We need the userId — look it up via pool createdBy or grants
    const taskPool = await this.prisma.memoryPool.findFirst({
      where: { name: poolName, createdBy: sessionKey, archivedAt: null },
      include: {
        memberships: {
          include: { memory: { select: { id: true, effectiveScore: true, userId: true } } },
        },
      },
    });

    if (!taskPool || taskPool.memberships.length === 0) return;

    const userId = taskPool.userId;
    const PROMOTION_THRESHOLD = 0.7;

    // Find or create global pool
    const globalPool = await this.memoryPoolService.findOrCreatePool({
      name: 'global',
      userId,
      visibility: 'GLOBAL',
      description: 'Global memory pool',
      createdBy: 'system',
    });

    // Promote high-scoring memories
    let promoted = 0;
    for (const membership of taskPool.memberships) {
      if (membership.memory.effectiveScore >= PROMOTION_THRESHOLD) {
        try {
          await this.prisma.memoryPoolMembership.upsert({
            where: {
              memoryId_poolId: {
                memoryId: membership.memory.id,
                poolId: globalPool.id,
              },
            },
            update: {},
            create: {
              memoryId: membership.memory.id,
              poolId: globalPool.id,
              addedBy: `promotion:${sessionKey}`,
            },
          });
          promoted++;
        } catch {
          // Ignore duplicates
        }
      }
    }

    console.log(
      `[AgentSession] Promoted ${promoted}/${taskPool.memberships.length} memories from ${poolName} to global`,
    );

    return { promoted, total: taskPool.memberships.length };
  }

  async listByParent(parentKey: string) {
    return this.prisma.agentSession.findMany({
      where: { parentKey },
      orderBy: { createdAt: 'desc' },
    });
  }

  async list(options?: { status?: AgentSessionStatus; limit?: number }) {
    return this.prisma.agentSession.findMany({
      where: options?.status ? { status: options.status } : undefined,
      orderBy: { createdAt: 'desc' },
      take: options?.limit ?? 50,
    });
  }
}
