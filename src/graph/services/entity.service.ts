import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { GraphEntity, GraphEntityType, Prisma } from '@prisma/client';
import {
  CreateEntityDto,
  UpdateEntityDto,
  ListEntitiesDto,
  EntityWithRelationships,
} from '../dto/entity.dto';

/**
 * EntityService - CRUD operations for graph entities
 *
 * Handles creation, retrieval, updating, and deletion of entities
 * in the semantic memory graph.
 */
@Injectable()
export class EntityService {
  private readonly logger = new Logger(EntityService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Create a new entity
   */
  async create(dto: CreateEntityDto): Promise<GraphEntity> {
    this.logger.debug(`Creating entity: ${dto.name} (${dto.type})`);

    const entity = await this.prisma.graphEntity.create({
      data: {
        userId: dto.userId,
        name: dto.name,
        type: dto.type,
        aliases: dto.aliases || [],
        description: dto.description,
        metadata: dto.metadata || {},
        firstSeenMemoryId: dto.firstSeenMemoryId,
      },
    });

    this.logger.log(`Created entity: ${entity.id} - ${entity.name}`);
    return entity;
  }

  /**
   * Find entity by ID
   */
  async findById(id: string): Promise<GraphEntity | null> {
    return this.prisma.graphEntity.findUnique({
      where: { id },
    });
  }

  /**
   * Find entity by ID or throw
   */
  async findByIdOrFail(id: string): Promise<GraphEntity> {
    const entity = await this.findById(id);
    if (!entity) {
      throw new NotFoundException(`Entity not found: ${id}`);
    }
    return entity;
  }

  /**
   * Find entity by name and type for a user
   */
  async findByName(
    userId: string,
    name: string,
    type?: GraphEntityType,
  ): Promise<GraphEntity | null> {
    if (type) {
      return this.prisma.graphEntity.findUnique({
        where: {
          userId_name_type: { userId, name, type },
        },
      });
    }

    // If no type specified, find first match
    return this.prisma.graphEntity.findFirst({
      where: {
        userId,
        name: { equals: name, mode: 'insensitive' },
      },
    });
  }

  /**
   * Find entity by alias
   */
  async findByAlias(
    userId: string,
    alias: string,
    type?: GraphEntityType,
  ): Promise<GraphEntity | null> {
    const where: Prisma.GraphEntityWhereInput = {
      userId,
      aliases: { has: alias.toLowerCase() },
    };
    if (type) {
      where.type = type;
    }

    return this.prisma.graphEntity.findFirst({ where });
  }

  /**
   * Find entity by name or alias (for resolution)
   */
  async findByNameOrAlias(
    userId: string,
    nameOrAlias: string,
    type?: GraphEntityType,
  ): Promise<GraphEntity | null> {
    // Try exact name match first
    let entity = await this.findByName(userId, nameOrAlias, type);
    if (entity) return entity;

    // Try alias match
    entity = await this.findByAlias(userId, nameOrAlias, type);
    return entity;
  }

  /**
   * List entities with optional filtering
   */
  async list(
    dto: ListEntitiesDto,
  ): Promise<{ entities: GraphEntity[]; total: number }> {
    const where: Prisma.GraphEntityWhereInput = {
      userId: Array.isArray(dto.userId) ? { in: dto.userId } : dto.userId,
    };

    if (dto.type) {
      where.type = dto.type;
    }

    if (dto.search) {
      where.OR = [
        { name: { contains: dto.search, mode: 'insensitive' } },
        { aliases: { hasSome: [dto.search.toLowerCase()] } },
        { description: { contains: dto.search, mode: 'insensitive' } },
      ];
    }

    // Sequential queries to avoid Prisma batch transaction issues
    // when called concurrently from the recall pipeline
    const entities = await this.prisma.graphEntity.findMany({
      where,
      orderBy: [{ mentionCount: 'desc' }, { name: 'asc' }],
      take: dto.limit || 50,
      skip: dto.offset || 0,
    });
    const total = await this.prisma.graphEntity.count({ where });

    return { entities, total };
  }

  /**
   * Get entity with all relationships
   */
  async getWithRelationships(id: string): Promise<EntityWithRelationships> {
    const entity = await this.prisma.graphEntity.findUnique({
      where: { id },
      include: {
        outgoingRelationships: {
          include: {
            targetEntity: {
              select: { id: true, name: true, type: true },
            },
          },
        },
        incomingRelationships: {
          include: {
            sourceEntity: {
              select: { id: true, name: true, type: true },
            },
          },
        },
      },
    });

    if (!entity) {
      throw new NotFoundException(`Entity not found: ${id}`);
    }

    return {
      entity: {
        id: entity.id,
        userId: entity.userId,
        name: entity.name,
        type: entity.type,
        aliases: entity.aliases,
        description: entity.description,
        metadata: entity.metadata as Record<string, any>,
        mentionCount: entity.mentionCount,
        createdAt: entity.createdAt,
        updatedAt: entity.updatedAt,
      },
      outgoingRelationships: entity.outgoingRelationships.map((r) => ({
        id: r.id,
        type: r.type,
        weight: r.weight,
        target: {
          id: r.targetEntity.id,
          name: r.targetEntity.name,
          type: r.targetEntity.type,
        },
      })),
      incomingRelationships: entity.incomingRelationships.map((r) => ({
        id: r.id,
        type: r.type,
        weight: r.weight,
        source: {
          id: r.sourceEntity.id,
          name: r.sourceEntity.name,
          type: r.sourceEntity.type,
        },
      })),
    };
  }

  /**
   * Update an entity
   */
  async update(id: string, dto: UpdateEntityDto): Promise<GraphEntity> {
    await this.findByIdOrFail(id);

    const data: Prisma.GraphEntityUpdateInput = {};

    if (dto.name !== undefined) data.name = dto.name;
    if (dto.type !== undefined) data.type = dto.type;
    if (dto.aliases !== undefined) data.aliases = dto.aliases;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.metadata !== undefined) data.metadata = dto.metadata;

    return this.prisma.graphEntity.update({
      where: { id },
      data,
    });
  }

  /**
   * Add aliases to an entity
   */
  async addAliases(id: string, newAliases: string[]): Promise<GraphEntity> {
    const entity = await this.findByIdOrFail(id);

    const normalizedNew = newAliases.map((a) => a.toLowerCase());
    const existingSet = new Set(entity.aliases.map((a) => a.toLowerCase()));
    const toAdd = normalizedNew.filter((a) => !existingSet.has(a));

    if (toAdd.length === 0) {
      return entity;
    }

    return this.prisma.graphEntity.update({
      where: { id },
      data: {
        aliases: { push: toAdd },
      },
    });
  }

  /**
   * Increment mention count
   */
  async incrementMentionCount(id: string): Promise<GraphEntity> {
    return this.prisma.graphEntity.update({
      where: { id },
      data: {
        mentionCount: { increment: 1 },
      },
    });
  }

  /**
   * Set embedding ID for an entity
   */
  async setEmbeddingId(id: string, embeddingId: string): Promise<GraphEntity> {
    return this.prisma.graphEntity.update({
      where: { id },
      data: { embeddingId },
    });
  }

  /**
   * Delete an entity and all related data
   */
  async delete(id: string): Promise<void> {
    await this.findByIdOrFail(id);

    // Delete cascades to relationships and mentions via foreign keys
    await this.prisma.graphEntity.delete({
      where: { id },
    });

    this.logger.log(`Deleted entity: ${id}`);
  }

  /**
   * Get top entities by mention count
   */
  async getTopEntities(
    userId: string,
    limit: number = 10,
    type?: GraphEntityType,
  ): Promise<GraphEntity[]> {
    const where: Prisma.GraphEntityWhereInput = { userId };
    if (type) where.type = type;

    return this.prisma.graphEntity.findMany({
      where,
      orderBy: { mentionCount: 'desc' },
      take: limit,
    });
  }

  /**
   * Get graph statistics for a user
   */
  async getStats(userId: string): Promise<{
    totalEntities: number;
    byType: Record<string, number>;
    totalRelationships: number;
    totalMentions: number;
  }> {
    const [totalEntities, byType, totalRelationships, totalMentions] =
      await Promise.all([
        this.prisma.graphEntity.count({ where: { userId } }),
        this.prisma.graphEntity.groupBy({
          by: ['type'],
          where: { userId },
          _count: { type: true },
        }),
        this.prisma.graphRelationship.count({ where: { userId } }),
        this.prisma.graphEntityMention.count({ where: { userId } }),
      ]);

    return {
      totalEntities,
      byType: Object.fromEntries(byType.map((b) => [b.type, b._count.type])),
      totalRelationships,
      totalMentions,
    };
  }
}
