import { Injectable } from '@nestjs/common';
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
  readonly name = 'pgvector';

  constructor(private prisma: PrismaService) {}

  async upsert(record: VectorRecord): Promise<void> {
    const embeddingStr = `[${record.embedding.join(',')}]`;
    
    await this.prisma.$executeRawUnsafe(`
      UPDATE memories 
      SET embedding = $1::vector
      WHERE id = $2
    `, embeddingStr, record.id);
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

    // Build WHERE clause
    let whereClause = `user_id = $2 AND embedding IS NOT NULL AND deleted_at IS NULL`;
    const params: any[] = [embeddingStr, options.userId];
    let paramIndex = 3;

    if (options.filter?.layers && options.filter.layers.length > 0) {
      const layerPlaceholders = options.filter.layers.map((_, i) => `$${paramIndex + i}`).join(', ');
      whereClause += ` AND layer IN (${layerPlaceholders})`;
      params.push(...options.filter.layers);
      paramIndex += options.filter.layers.length;
    }

    if (options.filter?.projectId) {
      whereClause += ` AND project_id = $${paramIndex}`;
      params.push(options.filter.projectId);
    }

    // Use cosine distance for similarity (1 - distance = similarity)
    const results = await this.prisma.$queryRawUnsafe<
      Array<{ id: string; score: number }>
    >(`
      SELECT 
        id,
        1 - (embedding <=> $1::vector) as score
      FROM memories
      WHERE ${whereClause}
      ORDER BY embedding <=> $1::vector
      LIMIT ${limit}
    `, ...params);

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
