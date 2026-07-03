/**
 * Ingestion Store Service
 * Handles database persistence of code chunks with multi-model embeddings
 */

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ChunkWithEmbedding, ChunkWithMultiEmbedding } from './types';
import { randomUUID } from 'crypto';

/**
 * Validate that an embedding array contains actual numeric values
 * Type guard to narrow the type when embedding is valid
 */
function isValidEmbedding(embedding: number[] | undefined): embedding is number[] {
  if (!embedding || !Array.isArray(embedding) || embedding.length === 0) {
    return false;
  }
  // Check first few values are actual numbers (not undefined, null, NaN)
  return embedding.slice(0, 5).every(v => typeof v === 'number' && !isNaN(v));
}

export interface StoreResult {
  chunksStored: number;
  chunksDeleted: number;
  errors: string[];
}

@Injectable()
export class IngestionStoreService {
  private readonly logger = new Logger(IngestionStoreService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Store chunks with multi-model embeddings in the database
   * Uses raw SQL for vector insertion
   */
  async storeChunks(
    projectId: string,
    chunks: ChunkWithMultiEmbedding[] | ChunkWithEmbedding[],
    options?: { clearExisting?: boolean }
  ): Promise<StoreResult> {
    const errors: string[] = [];
    let chunksStored = 0;
    let chunksDeleted = 0;

    // Optionally clear existing chunks for full re-ingestion
    if (options?.clearExisting) {
      const deleted = await this.prisma.codeChunk.deleteMany({
        where: { projectId },
      });
      chunksDeleted = deleted.count;
      this.logger.log(`Cleared ${chunksDeleted} existing chunks for project ${projectId}`);
    }

    // Insert chunks in batches to avoid overwhelming the database
    const BATCH_SIZE = 50;
    for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
      const batch = chunks.slice(i, i + BATCH_SIZE);

      for (const chunk of batch) {
        try {
          const id = randomUUID();

          // Convert embedding arrays to PostgreSQL vector string format
          // Only use validated embeddings to avoid "[,,,]" invalid vector errors
          const primaryVectorString = isValidEmbedding(chunk.embedding)
            ? `[${chunk.embedding.join(',')}]`
            : null;

          // Check if this is a multi-embedding chunk
          const embeddings = 'embeddings' in chunk 
            ? (chunk as ChunkWithMultiEmbedding).embeddings 
            : null;

          // Build vector strings for each model (validated)
          const bgeEmb = embeddings?.['bge-base'];
          const bgeVector = isValidEmbedding(bgeEmb) ? `[${bgeEmb.join(',')}]` : null;
          
          const nomicEmb = embeddings?.['nomic'];
          const nomicVector = isValidEmbedding(nomicEmb) ? `[${nomicEmb.join(',')}]` : null;
          
          const gteEmb = embeddings?.['gte-base'];
          const gteVector = isValidEmbedding(gteEmb) ? `[${gteEmb.join(',')}]` : null;
          
          const minilmEmb = embeddings?.['minilm'];
          const minilmVector = isValidEmbedding(minilmEmb) ? `[${minilmEmb.join(',')}]` : null;
          
          // Skip chunks with no valid embeddings
          if (!primaryVectorString && !bgeVector) {
            errors.push(`Skipping chunk ${chunk.name || 'unnamed'} in ${chunk.filePath}: no valid embedding`);
            continue;
          }

          // Use raw SQL for vector insertion with all embedding columns
          // Need to use $executeRawUnsafe for dynamic vector values
          const sql = `
            INSERT INTO code_chunks (
              id, "projectId", "filePath", "lineStart", "lineEnd",
              content, language, "chunkType", name, "parentName",
              dependencies, embedding, embedding_bge, embedding_nomic,
              embedding_gte, embedding_minilm, "createdAt", checksum
            ) VALUES (
              $1::uuid,
              $2::uuid,
              $3,
              $4,
              $5,
              $6,
              $7,
              $8,
              $9,
              $10,
              $11,
              ${primaryVectorString ? `'${primaryVectorString}'::vector` : 'NULL'},
              ${bgeVector ? `'${bgeVector}'::vector` : 'NULL'},
              ${nomicVector ? `'${nomicVector}'::vector` : 'NULL'},
              ${gteVector ? `'${gteVector}'::vector` : 'NULL'},
              ${minilmVector ? `'${minilmVector}'::vector` : 'NULL'},
              NOW(),
              $12
            )
          `;

          await this.prisma.$executeRawUnsafe(
            sql,
            id,
            projectId,
            chunk.filePath,
            chunk.lineStart,
            chunk.lineEnd,
            chunk.content,
            chunk.language,
            chunk.chunkType,
            chunk.name,
            chunk.parentName || null,
            chunk.dependencies || [],
            chunk.checksum
          );

          chunksStored++;
        } catch (error) {
          const errMsg = `Failed to store chunk ${chunk.name} in ${chunk.filePath}: ${error instanceof Error ? error.message : error}`;
          this.logger.error(errMsg);
          errors.push(errMsg);
        }
      }

      // Log progress for large ingestions
      if (chunks.length > BATCH_SIZE) {
        this.logger.log(`Stored ${Math.min(i + BATCH_SIZE, chunks.length)}/${chunks.length} chunks`);
      }
    }

    return { chunksStored, chunksDeleted, errors };
  }

  /**
   * Update project's lastIngestedAt timestamp
   */
  async updateProjectTimestamp(projectId: string): Promise<void> {
    await this.prisma.project.update({
      where: { id: projectId },
      data: { lastIngestedAt: new Date() },
    });
  }

  /**
   * Get existing checksums for incremental ingestion
   */
  async getExistingChecksums(projectId: string): Promise<Map<string, string>> {
    const chunks = await this.prisma.codeChunk.findMany({
      where: { projectId },
      select: { filePath: true, checksum: true },
      distinct: ['filePath'],
    });

    return new Map(chunks.map((c) => [c.filePath, c.checksum]));
  }

  /**
   * Get stats about which embedding columns are populated
   */
  async getEmbeddingStats(projectId: string): Promise<Record<string, number>> {
    const result = await this.prisma.$queryRaw<
      Array<{
        embedding_count: bigint;
        bge_count: bigint;
        nomic_count: bigint;
        gte_count: bigint;
        minilm_count: bigint;
        total: bigint;
      }>
    >`
      SELECT 
        COUNT(*) FILTER (WHERE embedding IS NOT NULL) as embedding_count,
        COUNT(*) FILTER (WHERE embedding_bge IS NOT NULL) as bge_count,
        COUNT(*) FILTER (WHERE embedding_nomic IS NOT NULL) as nomic_count,
        COUNT(*) FILTER (WHERE embedding_gte IS NOT NULL) as gte_count,
        COUNT(*) FILTER (WHERE embedding_minilm IS NOT NULL) as minilm_count,
        COUNT(*) as total
      FROM code_chunks
      WHERE "projectId" = ${projectId}::uuid
    `;

    const stats = result[0];
    return {
      total: Number(stats.total),
      embedding: Number(stats.embedding_count),
      'bge-base': Number(stats.bge_count),
      nomic: Number(stats.nomic_count),
      'gte-base': Number(stats.gte_count),
      minilm: Number(stats.minilm_count),
    };
  }
}
