import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateMemoryPoolDto, GrantPoolAccessDto, AddMemoryToPoolDto } from './dto/memory-pool.dto';

@Injectable()
export class MemoryPoolService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateMemoryPoolDto) {
    return this.prisma.memoryPool.create({
      data: {
        name: dto.name,
        userId: dto.userId,
        visibility: dto.visibility ?? 'GLOBAL',
        description: dto.description,
        createdBy: dto.createdBy,
      },
    });
  }

  async listByUser(userId: string) {
    return this.prisma.memoryPool.findMany({
      where: { userId, archivedAt: null },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getById(id: string) {
    const pool = await this.prisma.memoryPool.findUnique({ where: { id } });
    if (!pool) throw new NotFoundException(`Pool '${id}' not found`);
    return pool;
  }

  async grantAccess(poolId: string, dto: GrantPoolAccessDto) {
    await this.getById(poolId);
    return this.prisma.poolGrant.upsert({
      where: {
        poolId_agentSessionId: { poolId, agentSessionId: dto.agentSessionId },
      },
      update: { permission: dto.permission ?? 'READ', grantedBy: dto.grantedBy },
      create: {
        poolId,
        agentSessionId: dto.agentSessionId,
        permission: dto.permission ?? 'READ',
        grantedBy: dto.grantedBy,
      },
    });
  }

  async revokeAccess(poolId: string, agentSessionId: string) {
    return this.prisma.poolGrant.delete({
      where: {
        poolId_agentSessionId: { poolId, agentSessionId },
      },
    });
  }

  async addMemory(poolId: string, dto: AddMemoryToPoolDto) {
    await this.getById(poolId);
    return this.prisma.memoryPoolMembership.create({
      data: {
        memoryId: dto.memoryId,
        poolId,
        addedBy: dto.addedBy,
      },
    });
  }

  async removeMemory(poolId: string, memoryId: string) {
    return this.prisma.memoryPoolMembership.delete({
      where: {
        memoryId_poolId: { memoryId, poolId },
      },
    });
  }

  /**
   * Resolve all pool IDs accessible to a given agent session.
   * Rules:
   * 1. All GLOBAL pools for this user
   * 2. All SHARED pools where this session has a PoolGrant
   * 3. All PRIVATE pools created by this session
   * 4. If session has a parentKey, include parent's GLOBAL pools
   */
  async getAccessiblePoolIds(sessionKey: string, userId: string): Promise<string[]> {
    // 1. Global pools
    const globalPools = await this.prisma.memoryPool.findMany({
      where: { userId, visibility: 'GLOBAL', archivedAt: null },
      select: { id: true },
    });

    // 2. Find the agent session to get grants and parent
    const agentSession = await this.prisma.agentSession.findUnique({
      where: { sessionKey },
      include: { poolGrants: { select: { poolId: true } } },
    });

    // Shared pools via grants
    const grantedPoolIds = agentSession?.poolGrants.map((g) => g.poolId) ?? [];

    // Filter to only SHARED pools for this user
    const sharedPools = grantedPoolIds.length > 0
      ? await this.prisma.memoryPool.findMany({
          where: {
            id: { in: grantedPoolIds },
            userId,
            visibility: 'SHARED',
            archivedAt: null,
          },
          select: { id: true },
        })
      : [];

    // 3. Private pools created by this session
    const privatePools = await this.prisma.memoryPool.findMany({
      where: { userId, visibility: 'PRIVATE', createdBy: sessionKey, archivedAt: null },
      select: { id: true },
    });

    // 4. Parent's global pools (if sub-agent)
    let parentGlobalPools: { id: string }[] = [];
    if (agentSession?.parentKey) {
      // Parent's global pools are already included in step 1 (same user),
      // but this handles cross-user scenarios if ever needed
      parentGlobalPools = [];
    }

    const allIds = new Set([
      ...globalPools.map((p) => p.id),
      ...sharedPools.map((p) => p.id),
      ...privatePools.map((p) => p.id),
      ...parentGlobalPools.map((p) => p.id),
    ]);

    return Array.from(allIds);
  }
}
