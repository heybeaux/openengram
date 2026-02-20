import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  VectorProvider,
  VectorRecord,
  VectorSearchResult,
  VectorSearchOptions,
} from '../vector.interface';

/**
 * pgvector Provider
 *
 * Uses PostgreSQL's pgvector extension for vector storage.
 * Default provider - no external dependencies, runs locally.
 */
@Injectable()
export class PgVectorProvider implements VectorProvider {
  private readonly logger = new Logger(PgVectorProvider.name);
  readonly name = 'pgvector';
  private readonly searchModel: string;

  constructor(private prisma: PrismaService) {
    this.searchModel = process.env.VECTOR_SEARCH_MODEL || 'bge-base';
  }

  async upsert(record: VectorRecord): Promise<void> {
    const embeddingStr = `[${record.embedding.join(',')}]`;

    // Write to inline column for backward compat
    const updated = await this.prisma.$executeRawUnsafe(
      `
      UPDATE memories 
      SET embedding = $1::vector
      WHERE id = $2
    `,
      embeddingStr,
      record.id,
    );

    // Only write to memory_embeddings if this ID is a real memory
    // (HierarchyService passes pinecone-style IDs like "hierarchy_l0_xxx" which aren't memory IDs)
    if (updated > 0) {
      await this.prisma.$executeRawUnsafe(
        `
        INSERT INTO memory_embeddings (id, memory_id, model_id, dimensions, embedding, created_at, updated_at)
        VALUES (
          concat('cl', substr(md5(random()::text), 1, 23)),
          $2,
          $3,
          $4,
          $1::vector,
          NOW(),
          NOW()
        )
        ON CONFLICT (memory_id, model_id)
        DO UPDATE SET embedding = $1::vector, updated_at = NOW()
      `,
        embeddingStr,
        record.id,
        this.searchModel,
        record.embedding.length,
      );
    }
  }

  async upsertMany(records: VectorRecord[]): Promise<void> {
    for (const record of records) {
      await this.upsert(record);
    }
  }

  async search(
    embedding: number[],
    options: VectorSearchOptions,
  ): Promise<VectorSearchResult[]> {
    const embeddingStr = `[${embedding.join(',')}]`;
    const limit = options.limit || 10;

    // Build WHERE clause for the memories table filters
    const userIds = Array.isArray(options.userId)
      ? options.userId
      : [options.userId];
    // params[0] = embedding string ($1)
    // params[1] = search model ($2)
    const params: any[] = [embeddingStr, this.searchModel];
    let paramIndex = 3;

    // User ID filter
    let memoryWhereClause: string;
    if (userIds.length === 1) {
      memoryWhereClause = `m.user_id = $${paramIndex} AND m.deleted_at IS NULL`;
      params.push(userIds[0]);
      paramIndex++;
    } else {
      const userPlaceholders = userIds
        .map((_, i) => `$${paramIndex + i}`)
        .join(', ');
      memoryWhereClause = `m.user_id IN (${userPlaceholders}) AND m.deleted_at IS NULL`;
      params.push(...userIds);
      paramIndex += userIds.length;
    }

    if (options.filter?.layers && options.filter.layers.length > 0) {
      const layerPlaceholders = options.filter.layers
        .map((_, i) => `$${paramIndex + i}`)
        .join(', ');
      memoryWhereClause += ` AND m.layer IN (${layerPlaceholders})`;
      params.push(...options.filter.layers);
      paramIndex += options.filter.layers.length;
    }

    if (options.filter?.projectId) {
      memoryWhereClause += ` AND m.project_id = $${paramIndex}`;
      params.push(options.filter.projectId);
      paramIndex++;
    }

    // Pool filtering: JOIN on memory_pool_memberships to restrict results
    let poolJoinClause = '';
    if (options.filter?.poolIds && options.filter.poolIds.length > 0) {
      const poolPlaceholders = options.filter.poolIds
        .map((_, i) => `$${paramIndex + i}`)
        .join(', ');
      poolJoinClause = `JOIN memory_pool_memberships mpm ON mpm.memory_id = m.id AND mpm.pool_id IN (${poolPlaceholders})`;
      params.push(...options.filter.poolIds);
      paramIndex += options.filter.poolIds.length;
    }

    // DEBUG: log search params
    this.logger.log(
      `[PgVector] search: model=${this.searchModel}, userId=${Array.isArray(options.userId) ? options.userId.join(',') : options.userId}, embDim=${embedding.length}, limit=${limit}, params=${params.length}, poolFilter=${!!options.filter?.poolIds}`,
    );

    // Search ensemble embeddings first, fall back to inline column
    const results = await this.prisma.$queryRawUnsafe<
      Array<{ id: string; score: number }>
    >(
      `
      (
        SELECT 
          m.id,
          1 - (me.embedding <=> $1::vector) as score
        FROM memories m
        JOIN memory_embeddings me ON me.memory_id = m.id
        ${poolJoinClause}
        WHERE me.model_id = $2
          AND ${memoryWhereClause}
          AND me.embedding IS NOT NULL
        ORDER BY me.embedding <=> $1::vector
        LIMIT ${limit}
      )
      UNION ALL
      (
        SELECT
          m.id,
          1 - (m.embedding <=> $1::vector) as score
        FROM memories m
        ${poolJoinClause}
        WHERE ${memoryWhereClause}
          AND m.embedding IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM memory_embeddings me
            WHERE me.memory_id = m.id AND me.model_id = $2
          )
        ORDER BY m.embedding <=> $1::vector
        LIMIT ${limit}
      )
      ORDER BY score DESC
      LIMIT ${limit}
    `,
      ...params,
    );

    this.logger.log(
      `[PgVector] search results: ${results.length}`,
      results.slice(0, 3),
    );

    return results.map((r) => ({
      id: r.id,
      score: Number(r.score),
    }));
  }

  async delete(id: string): Promise<void> {
    await this.prisma.$executeRaw`
      UPDATE memories SET embedding = NULL WHERE id = ${id}
    `;
  }

  async deleteByUser(userId: string): Promise<void> {
    await this.prisma.$executeRaw`
      UPDATE memories SET embedding = NULL WHERE user_id = ${userId}
    `;
  }

  isConfigured(): boolean {
    // pgvector is always configured if Postgres is running
    return true;
  }
}
