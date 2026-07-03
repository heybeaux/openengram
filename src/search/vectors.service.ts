import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '@prisma/client';
import { EmbeddingModelId, EMBEDDING_MODELS } from './embeddings.service';

/**
 * Helper for pgvector operations.
 * Uses raw SQL since Prisma doesn't natively support pgvector operators.
 * 
 * NOTE: Column names are camelCase (Prisma default), table is snake_case via @@map
 */

export interface VectorSearchResult {
  id: string;
  projectId: string;
  filePath: string;
  lineStart: number;
  lineEnd: number;
  content: string;
  language: string;
  chunkType: string;
  name: string;
  parentName: string | null;
  dependencies: string[];
  checksum: string;
  createdAt: Date;
  distance: number; // cosine distance (lower = more similar)
}

export interface VectorSearchOptions {
  projectId?: string;
  language?: string;
  chunkType?: string;
  limit?: number;
}

export interface EnsembleSearchOptions extends VectorSearchOptions {
  models?: EmbeddingModelId[];
}

export interface ModelSearchResult {
  modelId: EmbeddingModelId;
  results: VectorSearchResult[];
}

@Injectable()
export class VectorsService {
  private readonly logger = new Logger(VectorsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Perform cosine similarity search using pgvector's <=> operator.
   * Uses the default 'embedding' column for backward compatibility.
   */
  async searchSimilar(
    queryVector: number[],
    options: VectorSearchOptions = {},
  ): Promise<VectorSearchResult[]> {
    return this.searchByModel(queryVector, 'bge-base', options);
  }

  /**
   * Perform cosine similarity search using a specific model's embedding column.
   */
  async searchByModel(
    queryVector: number[],
    modelId: EmbeddingModelId,
    options: VectorSearchOptions = {},
  ): Promise<VectorSearchResult[]> {
    const { projectId, language, chunkType, limit = 10 } = options;
    const columnName = EMBEDDING_MODELS[modelId].columnName;

    // Build dynamic WHERE clause
    const conditions: string[] = [`${columnName} IS NOT NULL`];
    const params: (string | number)[] = [];
    let paramIndex = 1;

    // Always include the vector as first parameter
    const vectorString = `[${queryVector.join(',')}]`;
    params.push(vectorString);
    paramIndex++;

    if (projectId) {
      conditions.push(`"projectId" = $${paramIndex}`);
      params.push(projectId);
      paramIndex++;
    }

    if (language) {
      conditions.push(`language = $${paramIndex}`);
      params.push(language);
      paramIndex++;
    }

    if (chunkType) {
      conditions.push(`"chunkType" = $${paramIndex}`);
      params.push(chunkType);
      paramIndex++;
    }

    params.push(limit);
    const limitParam = `$${paramIndex}`;

    const whereClause = `WHERE ${conditions.join(' AND ')}`;

    const query = `
      SELECT 
        id,
        "projectId",
        "filePath",
        "lineStart",
        "lineEnd",
        content,
        language,
        "chunkType",
        name,
        "parentName",
        dependencies,
        checksum,
        "createdAt",
        ${columnName} <=> $1::vector AS distance
      FROM code_chunks
      ${whereClause}
      ORDER BY distance ASC
      LIMIT ${limitParam};
    `;

    this.logger.debug(`Executing vector search on ${columnName} with ${params.length} params`);

    try {
      const results = await this.prisma.$queryRawUnsafe<VectorSearchResult[]>(
        query,
        ...params,
      );

      return results;
    } catch (error) {
      this.logger.error(`Vector search failed on ${columnName}`, error);
      throw error;
    }
  }

  /**
   * Perform ensemble search across multiple models.
   * Returns results from each model separately for RRF fusion.
   */
  async searchEnsemble(
    queryVectors: Record<EmbeddingModelId, number[]>,
    options: EnsembleSearchOptions = {},
  ): Promise<ModelSearchResult[]> {
    const models = options.models || (Object.keys(queryVectors) as EmbeddingModelId[]);
    const results: ModelSearchResult[] = [];

    // Query each model in parallel
    const promises = models.map(async (modelId) => {
      const vector = queryVectors[modelId];
      if (!vector) {
        this.logger.warn(`No query vector provided for model ${modelId}`);
        return { modelId, results: [] };
      }

      try {
        const modelResults = await this.searchByModel(vector, modelId, {
          ...options,
          limit: options.limit || 20, // Fetch more for RRF fusion
        });
        return { modelId, results: modelResults };
      } catch (error) {
        this.logger.error(`Ensemble search failed for model ${modelId}`, error);
        return { modelId, results: [] };
      }
    });

    const resolved = await Promise.all(promises);
    return resolved;
  }

  /**
   * Search within a specific project.
   */
  async searchByProject(
    queryVector: number[],
    projectId: string,
    limit: number = 10,
  ): Promise<VectorSearchResult[]> {
    const vectorString = `[${queryVector.join(',')}]`;

    const results = await this.prisma.$queryRaw<VectorSearchResult[]>`
      SELECT 
        id,
        "projectId",
        "filePath",
        "lineStart",
        "lineEnd",
        content,
        language,
        "chunkType",
        name,
        "parentName",
        dependencies,
        checksum,
        "createdAt",
        embedding <=> ${vectorString}::vector AS distance
      FROM code_chunks
      WHERE "projectId" = ${projectId}
      ORDER BY distance ASC
      LIMIT ${limit};
    `;

    return results;
  }

  /**
   * Search across all projects (global search).
   */
  async searchGlobal(
    queryVector: number[],
    limit: number = 10,
  ): Promise<VectorSearchResult[]> {
    const vectorString = `[${queryVector.join(',')}]`;

    const results = await this.prisma.$queryRaw<VectorSearchResult[]>`
      SELECT 
        id,
        "projectId",
        "filePath",
        "lineStart",
        "lineEnd",
        content,
        language,
        "chunkType",
        name,
        "parentName",
        dependencies,
        checksum,
        "createdAt",
        embedding <=> ${vectorString}::vector AS distance
      FROM code_chunks
      ORDER BY distance ASC
      LIMIT ${limit};
    `;

    return results;
  }

  /**
   * Get the nearest neighbors to an existing chunk (find similar code).
   */
  async findSimilarChunks(
    chunkId: string,
    limit: number = 5,
    excludeSameFile: boolean = true,
  ): Promise<VectorSearchResult[]> {
    const excludeClause = excludeSameFile
      ? `AND c2."filePath" != c1."filePath"`
      : '';

    const results = await this.prisma.$queryRaw<VectorSearchResult[]>`
      SELECT 
        c2.id,
        c2."projectId",
        c2."filePath",
        c2."lineStart",
        c2."lineEnd",
        c2.content,
        c2.language,
        c2."chunkType",
        c2.name,
        c2."parentName",
        c2.dependencies,
        c2.checksum,
        c2."createdAt",
        c1.embedding <=> c2.embedding AS distance
      FROM code_chunks c1
      CROSS JOIN code_chunks c2
      WHERE c1.id = ${chunkId}
        AND c2.id != ${chunkId}
        ${Prisma.raw(excludeClause)}
      ORDER BY distance ASC
      LIMIT ${limit};
    `;

    return results;
  }

  /**
   * Convert cosine distance to similarity score (0-1).
   */
  distanceToScore(distance: number): number {
    return Math.max(0, Math.min(1, 1 - distance));
  }

  /**
   * Check which embedding columns are populated for a project
   */
  async getPopulatedModels(projectId?: string): Promise<EmbeddingModelId[]> {
    const whereClause = projectId ? `WHERE "projectId" = '${projectId}'::uuid` : '';
    
    const result = await this.prisma.$queryRawUnsafe<
      Array<{
        has_bge: boolean;
        has_nomic: boolean;
        has_gte: boolean;
        has_minilm: boolean;
      }>
    >(`
      SELECT 
        COUNT(*) FILTER (WHERE embedding_bge IS NOT NULL) > 0 as has_bge,
        COUNT(*) FILTER (WHERE embedding_nomic IS NOT NULL) > 0 as has_nomic,
        COUNT(*) FILTER (WHERE embedding_gte IS NOT NULL) > 0 as has_gte,
        COUNT(*) FILTER (WHERE embedding_minilm IS NOT NULL) > 0 as has_minilm
      FROM code_chunks
      ${whereClause}
    `);

    const populated: EmbeddingModelId[] = [];
    if (result[0]?.has_bge) populated.push('bge-base');
    if (result[0]?.has_nomic) populated.push('nomic');
    if (result[0]?.has_gte) populated.push('gte-base');
    if (result[0]?.has_minilm) populated.push('minilm');

    return populated;
  }
}
