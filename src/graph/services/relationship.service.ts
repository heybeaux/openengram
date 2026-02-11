import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  GraphRelationship,
  GraphRelationshipType,
  Prisma,
} from '@prisma/client';
import {
  CreateRelationshipDto,
  UpdateRelationshipDto,
  ListRelationshipsDto,
  TraverseGraphDto,
  GraphTraversalResult,
} from '../dto/relationship.dto';

/**
 * Symmetric relationship types that should create inverse edges
 */
const SYMMETRIC_RELATIONSHIPS: GraphRelationshipType[] = [
  'SPOUSE_OF',
  'SIBLING_OF',
  'FRIEND_OF',
  'COLLEAGUE_OF',
  'RELATED_TO',
];

/**
 * RelationshipService - CRUD operations for graph relationships
 *
 * Handles creation, retrieval, updating, and deletion of relationships
 * (edges) between entities in the semantic memory graph.
 */
@Injectable()
export class RelationshipService {
  private readonly logger = new Logger(RelationshipService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Create a new relationship
   */
  async create(dto: CreateRelationshipDto): Promise<GraphRelationship> {
    // Prevent self-loops
    if (dto.sourceEntityId === dto.targetEntityId) {
      throw new BadRequestException(
        'Cannot create self-referential relationship',
      );
    }

    this.logger.debug(
      `Creating relationship: ${dto.sourceEntityId} --${dto.type}--> ${dto.targetEntityId}`,
    );

    const relationship = await this.prisma.graphRelationship.create({
      data: {
        userId: dto.userId,
        sourceEntityId: dto.sourceEntityId,
        targetEntityId: dto.targetEntityId,
        type: dto.type,
        label: dto.label,
        weight: dto.weight ?? 1.0,
        properties: dto.properties || {},
        sourceMemoryIds: dto.sourceMemoryIds || [],
        isInferred: dto.isInferred ?? false,
      },
    });

    // Create inverse relationship for symmetric types
    if (this.isSymmetric(dto.type)) {
      await this.createInverse(relationship);
    }

    this.logger.log(`Created relationship: ${relationship.id}`);
    return relationship;
  }

  /**
   * Create or update a relationship (upsert)
   */
  async upsert(
    dto: CreateRelationshipDto,
  ): Promise<{ relationship: GraphRelationship; created: boolean }> {
    // Prevent self-loops
    if (dto.sourceEntityId === dto.targetEntityId) {
      throw new BadRequestException(
        'Cannot create self-referential relationship',
      );
    }

    const existing = await this.prisma.graphRelationship.findUnique({
      where: {
        userId_sourceEntityId_targetEntityId_type: {
          userId: dto.userId,
          sourceEntityId: dto.sourceEntityId,
          targetEntityId: dto.targetEntityId,
          type: dto.type,
        },
      },
    });

    if (existing) {
      // Update existing: blend weight, add memory IDs
      const newMemoryIds = dto.sourceMemoryIds || [];
      const existingIds = existing.sourceMemoryIds;
      const combinedIds = [...new Set([...existingIds, ...newMemoryIds])];

      // Running average for weight
      const newWeight = existing.weight * 0.8 + (dto.weight ?? 1.0) * 0.2;

      const existingProps = (existing.properties as Record<string, any>) || {};
      const updated = await this.prisma.graphRelationship.update({
        where: { id: existing.id },
        data: {
          weight: newWeight,
          sourceMemoryIds: combinedIds,
          lastConfirmedAt: new Date(),
          properties: dto.properties
            ? { ...existingProps, ...dto.properties }
            : existingProps,
        },
      });

      return { relationship: updated, created: false };
    }

    const relationship = await this.create(dto);
    return { relationship, created: true };
  }

  /**
   * Create inverse relationship for symmetric types
   */
  private async createInverse(original: GraphRelationship): Promise<void> {
    const existing = await this.prisma.graphRelationship.findUnique({
      where: {
        userId_sourceEntityId_targetEntityId_type: {
          userId: original.userId,
          sourceEntityId: original.targetEntityId,
          targetEntityId: original.sourceEntityId,
          type: original.type,
        },
      },
    });

    if (!existing) {
      await this.prisma.graphRelationship.create({
        data: {
          userId: original.userId,
          sourceEntityId: original.targetEntityId,
          targetEntityId: original.sourceEntityId,
          type: original.type,
          label: original.label,
          weight: original.weight,
          properties: original.properties as Record<string, any>,
          sourceMemoryIds: original.sourceMemoryIds,
          isInferred: true,
        },
      });
    }
  }

  /**
   * Check if relationship type is symmetric
   */
  isSymmetric(type: GraphRelationshipType): boolean {
    return SYMMETRIC_RELATIONSHIPS.includes(type);
  }

  /**
   * Find relationship by ID
   */
  async findById(id: string): Promise<GraphRelationship | null> {
    return this.prisma.graphRelationship.findUnique({
      where: { id },
    });
  }

  /**
   * Find relationship by ID or throw
   */
  async findByIdOrFail(id: string): Promise<GraphRelationship> {
    const relationship = await this.findById(id);
    if (!relationship) {
      throw new NotFoundException(`Relationship not found: ${id}`);
    }
    return relationship;
  }

  /**
   * List relationships with filtering
   */
  async list(dto: ListRelationshipsDto): Promise<GraphRelationship[]> {
    const where: Prisma.GraphRelationshipWhereInput = {
      userId: dto.userId,
    };

    if (dto.entityId) {
      const direction = dto.direction || 'both';
      if (direction === 'outgoing') {
        where.sourceEntityId = dto.entityId;
      } else if (direction === 'incoming') {
        where.targetEntityId = dto.entityId;
      } else {
        where.OR = [
          { sourceEntityId: dto.entityId },
          { targetEntityId: dto.entityId },
        ];
      }
    }

    if (dto.type) {
      where.type = dto.type;
    }

    return this.prisma.graphRelationship.findMany({
      where,
      orderBy: { weight: 'desc' },
      take: dto.limit || 50,
      include: {
        sourceEntity: { select: { id: true, name: true, type: true } },
        targetEntity: { select: { id: true, name: true, type: true } },
      },
    });
  }

  /**
   * Get all relationships for an entity
   */
  async getForEntity(
    entityId: string,
    direction: 'outgoing' | 'incoming' | 'both' = 'both',
  ): Promise<GraphRelationship[]> {
    const where: Prisma.GraphRelationshipWhereInput = {};

    if (direction === 'outgoing') {
      where.sourceEntityId = entityId;
    } else if (direction === 'incoming') {
      where.targetEntityId = entityId;
    } else {
      where.OR = [{ sourceEntityId: entityId }, { targetEntityId: entityId }];
    }

    return this.prisma.graphRelationship.findMany({
      where,
      include: {
        sourceEntity: { select: { id: true, name: true, type: true } },
        targetEntity: { select: { id: true, name: true, type: true } },
      },
    });
  }

  /**
   * Update a relationship
   */
  async update(
    id: string,
    dto: UpdateRelationshipDto,
  ): Promise<GraphRelationship> {
    await this.findByIdOrFail(id);

    const data: Prisma.GraphRelationshipUpdateInput = {};

    if (dto.weight !== undefined) data.weight = dto.weight;
    if (dto.properties !== undefined) data.properties = dto.properties;
    if (dto.label !== undefined) data.label = dto.label;

    return this.prisma.graphRelationship.update({
      where: { id },
      data,
    });
  }

  /**
   * Add memory ID to a relationship
   */
  async addMemoryId(id: string, memoryId: string): Promise<GraphRelationship> {
    const relationship = await this.findByIdOrFail(id);
    const existingIds = relationship.sourceMemoryIds;

    if (existingIds.includes(memoryId)) {
      return relationship;
    }

    return this.prisma.graphRelationship.update({
      where: { id },
      data: {
        sourceMemoryIds: { push: memoryId },
        lastConfirmedAt: new Date(),
      },
    });
  }

  /**
   * Delete a relationship
   */
  async delete(id: string): Promise<void> {
    await this.findByIdOrFail(id);
    await this.prisma.graphRelationship.delete({
      where: { id },
    });
    this.logger.log(`Deleted relationship: ${id}`);
  }

  /**
   * Traverse the graph from a starting entity
   * Uses recursive CTE for efficient N-hop traversal
   */
  async traverse(dto: TraverseGraphDto): Promise<GraphTraversalResult> {
    const { startEntityId, maxDepth = 2, relationshipTypes, userId } = dto;

    // Verify start entity exists
    const startEntity = await this.prisma.graphEntity.findUnique({
      where: { id: startEntityId },
    });
    if (!startEntity) {
      throw new NotFoundException(`Start entity not found: ${startEntityId}`);
    }

    // Build the type filter for the query
    const typeFilter =
      relationshipTypes && relationshipTypes.length > 0
        ? `AND r.type = ANY(ARRAY[${relationshipTypes.map((t) => `'${t}'`).join(',')}]::"GraphRelationshipType"[])`
        : '';

    // Execute recursive CTE query
    const result = await this.prisma.$queryRaw<
      Array<{
        id: string;
        name: string;
        type: string;
        depth: number;
        rel_id: string | null;
        source_id: string | null;
        target_id: string | null;
        rel_type: string | null;
        weight: number | null;
      }>
    >`
      WITH RECURSIVE graph_traversal AS (
        -- Base case: starting entity
        SELECT 
          e.id,
          e.name,
          e.type::text,
          0 as depth,
          NULL::text as rel_id,
          NULL::text as source_id,
          NULL::text as target_id,
          NULL::text as rel_type,
          NULL::float as weight,
          ARRAY[e.id] as path
        FROM graph_entities e
        WHERE e.id = ${startEntityId}
        
        UNION ALL
        
        -- Recursive case: follow outgoing relationships
        SELECT 
          e.id,
          e.name,
          e.type::text,
          gt.depth + 1 as depth,
          r.id as rel_id,
          r.source_entity_id as source_id,
          r.target_entity_id as target_id,
          r.type::text as rel_type,
          r.weight,
          gt.path || e.id
        FROM graph_traversal gt
        JOIN graph_relationships r ON r.source_entity_id = gt.id
        JOIN graph_entities e ON e.id = r.target_entity_id
        WHERE 
          gt.depth < ${maxDepth}
          AND NOT e.id = ANY(gt.path)
          AND r.user_id = ${userId}
          ${Prisma.raw(typeFilter)}
      )
      SELECT DISTINCT ON (id) * FROM graph_traversal
      ORDER BY id, depth ASC
    `;

    // Separate nodes and edges
    const nodes = result.map((r) => ({
      id: r.id,
      name: r.name,
      type: r.type,
      depth: r.depth,
    }));

    const edges = result
      .filter((r) => r.rel_id !== null)
      .map((r) => ({
        id: r.rel_id!,
        sourceId: r.source_id!,
        targetId: r.target_id!,
        type: r.rel_type!,
        weight: r.weight!,
      }));

    return { nodes, edges };
  }

  /**
   * Find shortest path between two entities
   */
  async findPath(
    userId: string,
    fromEntityId: string,
    toEntityId: string,
    maxDepth: number = 4,
  ): Promise<Array<{ entityId: string; relationshipId: string | null }>> {
    // Use BFS via recursive CTE
    const result = await this.prisma.$queryRaw<
      Array<{
        path: string[];
        rel_path: (string | null)[];
      }>
    >`
      WITH RECURSIVE path_search AS (
        SELECT 
          ARRAY[${fromEntityId}] as path,
          ARRAY[]::text[] as rel_path,
          ${fromEntityId} as current
        
        UNION ALL
        
        SELECT 
          ps.path || r.target_entity_id,
          ps.rel_path || r.id,
          r.target_entity_id
        FROM path_search ps
        JOIN graph_relationships r ON r.source_entity_id = ps.current
        WHERE 
          array_length(ps.path, 1) <= ${maxDepth}
          AND NOT r.target_entity_id = ANY(ps.path)
          AND r.user_id = ${userId}
      )
      SELECT path, rel_path
      FROM path_search
      WHERE current = ${toEntityId}
      ORDER BY array_length(path, 1) ASC
      LIMIT 1
    `;

    if (result.length === 0) {
      return [];
    }

    const { path, rel_path } = result[0];
    return path.map((entityId, i) => ({
      entityId,
      relationshipId: rel_path[i - 1] || null,
    }));
  }
}
