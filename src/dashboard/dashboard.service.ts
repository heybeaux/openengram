import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MemoryLayer } from '@prisma/client';
import { ListMemoriesDto } from './dto/list-memories.dto';

export interface StatsResponse {
  totalMemories: number;
  memoryTrend: number;
  totalUsers: number;
  userTrend: number;
  healthScore: number;
  memoryByLayer: Array<{ layer: string; count: number; percentage: number }>;
  apiRequests: Array<{ day: string; requests: number }>;
  recentActivity: Array<{ id: string; action: string; time: string }>;
}

export interface MemoriesListResponse {
  memories: any[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface UsersListResponse {
  users: Array<{
    id: string;
    externalId: string;
    memoryCount: number;
    lastActive: string;
    createdAt: string;
  }>;
}

export interface UserDetailResponse {
  id: string;
  externalId: string;
  memoryCount: number;
  memoriesByLayer: Record<string, number>;
  lastActive: string;
  createdAt: string;
}

@Injectable()
export class DashboardService {
  constructor(private prisma: PrismaService) {}

  /**
   * Get dashboard overview statistics
   */
  async getStats(agentId: string): Promise<StatsResponse> {
    const now = new Date();
    const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const twoWeeksAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

    // Get all users for this agent
    const users = await this.prisma.user.findMany({
      where: { agentId, deletedAt: null },
      select: { id: true },
    });
    const userIds = users.map(u => u.id);

    // Total memories
    const totalMemories = await this.prisma.memory.count({
      where: { userId: { in: userIds }, deletedAt: null },
    });

    // Memories from last week vs previous week (for trend)
    const memoriesLastWeek = await this.prisma.memory.count({
      where: {
        userId: { in: userIds },
        deletedAt: null,
        createdAt: { gte: oneWeekAgo },
      },
    });

    const memoriesPreviousWeek = await this.prisma.memory.count({
      where: {
        userId: { in: userIds },
        deletedAt: null,
        createdAt: { gte: twoWeeksAgo, lt: oneWeekAgo },
      },
    });

    const memoryTrend = memoriesPreviousWeek === 0 
      ? memoriesLastWeek 
      : Math.round(((memoriesLastWeek - memoriesPreviousWeek) / memoriesPreviousWeek) * 100);

    // Total users
    const totalUsers = users.length;

    // Users from last week vs previous week
    const usersLastWeek = await this.prisma.user.count({
      where: {
        agentId,
        deletedAt: null,
        createdAt: { gte: oneWeekAgo },
      },
    });

    const usersPreviousWeek = await this.prisma.user.count({
      where: {
        agentId,
        deletedAt: null,
        createdAt: { gte: twoWeeksAgo, lt: oneWeekAgo },
      },
    });

    const userTrend = usersPreviousWeek === 0 
      ? usersLastWeek 
      : Math.round(((usersLastWeek - usersPreviousWeek) / usersPreviousWeek) * 100);

    // Health score: % of memories that have extractions
    const memoriesWithExtraction = await this.prisma.memoryExtraction.count({
      where: {
        memory: { userId: { in: userIds }, deletedAt: null },
      },
    });
    const healthScore = totalMemories === 0 
      ? 100 
      : Math.round((memoriesWithExtraction / totalMemories) * 100);

    // Memory by layer
    const layerCounts = await this.prisma.memory.groupBy({
      by: ['layer'],
      where: { userId: { in: userIds }, deletedAt: null },
      _count: { id: true },
    });

    const memoryByLayer = Object.values(MemoryLayer).map(layer => {
      const found = layerCounts.find(lc => lc.layer === layer);
      const count = found?._count?.id ?? 0;
      return {
        layer,
        count,
        percentage: totalMemories === 0 ? 0 : Math.round((count / totalMemories) * 100),
      };
    });

    // API requests - placeholder data (we don't track API requests yet)
    const apiRequests = this.generatePlaceholderApiRequests();

    // Recent activity - get recent memories
    const recentMemories = await this.prisma.memory.findMany({
      where: { userId: { in: userIds }, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: { id: true, createdAt: true, source: true },
    });

    const recentActivity = recentMemories.map(m => ({
      id: m.id,
      action: `Memory created (${m.source})`,
      time: m.createdAt.toISOString(),
    }));

    return {
      totalMemories,
      memoryTrend,
      totalUsers,
      userTrend,
      healthScore,
      memoryByLayer,
      apiRequests,
      recentActivity,
    };
  }

  /**
   * List memories with pagination and filters
   */
  async listMemories(agentId: string, dto: ListMemoriesDto): Promise<MemoriesListResponse> {
    const page = Number(dto.page) || 1;
    const limit = Number(dto.limit) || 25;
    const { layer, userId } = dto;
    const skip = (page - 1) * limit;

    // Get user IDs for this agent
    const userFilter = userId 
      ? { id: userId }
      : { agentId, deletedAt: null };
    
    const users = await this.prisma.user.findMany({
      where: userFilter as any,
      select: { id: true },
    });
    const userIds = users.map(u => u.id);

    const where: any = {
      userId: { in: userIds },
      deletedAt: null,
    };

    if (layer) {
      where.layer = layer;
    }

    const [memories, total] = await Promise.all([
      this.prisma.memory.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: {
          extraction: true,
          user: { select: { externalId: true } },
        },
      }),
      this.prisma.memory.count({ where }),
    ]);

    return {
      memories,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * List all users with memory stats
   */
  async listUsers(agentId: string): Promise<UsersListResponse> {
    const users = await this.prisma.user.findMany({
      where: { agentId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      include: {
        _count: {
          select: { memories: true },
        },
        memories: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { createdAt: true },
        },
      },
    });

    return {
      users: users.map(u => ({
        id: u.id,
        externalId: u.externalId,
        memoryCount: u._count.memories,
        lastActive: u.memories[0]?.createdAt?.toISOString() ?? u.createdAt.toISOString(),
        createdAt: u.createdAt.toISOString(),
      })),
    };
  }

  /**
   * Get user detail with stats
   */
  async getUserDetail(userId: string): Promise<UserDetailResponse | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        memories: {
          where: { deletedAt: null },
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { createdAt: true },
        },
      },
    });

    if (!user || user.deletedAt) {
      return null;
    }

    // Get memory count by layer
    const layerCounts = await this.prisma.memory.groupBy({
      by: ['layer'],
      where: { userId, deletedAt: null },
      _count: { id: true },
    });

    const memoriesByLayer: Record<string, number> = {};
    let totalCount = 0;
    for (const lc of layerCounts) {
      memoriesByLayer[lc.layer] = lc._count.id;
      totalCount += lc._count.id;
    }

    return {
      id: user.id,
      externalId: user.externalId,
      memoryCount: totalCount,
      memoriesByLayer,
      lastActive: user.memories[0]?.createdAt?.toISOString() ?? user.createdAt.toISOString(),
      createdAt: user.createdAt.toISOString(),
    };
  }

  /**
   * Generate placeholder API request data for last 7 days
   */
  private generatePlaceholderApiRequests(): Array<{ day: string; requests: number }> {
    const result: Array<{ day: string; requests: number }> = [];
    const now = new Date();

    for (let i = 6; i >= 0; i--) {
      const date = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
      const dayStr = date.toISOString().split('T')[0];
      // Placeholder: random-ish number based on day
      const requests = Math.floor(100 + Math.random() * 200);
      result.push({ day: dayStr, requests });
    }

    return result;
  }
}
