import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EmbeddingService } from './embedding.service';
import { MemoryLayer } from '@prisma/client';

export interface ConsolidationResult {
  promoted: number;
  duplicatesRemoved: number;
  clustersFound: number;
  details: Array<{
    canonicalId: string;
    canonicalRaw: string;
    promotedToLayer: MemoryLayer;
    duplicateIds: string[];
  }>;
}

export interface MemoryCluster {
  memories: Array<{
    id: string;
    raw: string;
    createdAt: Date;
    extractionWhat: string | null;
    importanceScore: number;
  }>;
  averageSimilarity: number;
}

/**
 * ConsolidationService handles memory promotion and deduplication.
 * 
 * P5-003: Intelligent Layer Classification - Consolidation Component
 * 
 * Key Features:
 * - Finds recurring SESSION memories with 3+ similar occurrences
 * - Promotes the canonical version to IDENTITY layer
 * - Soft-deletes duplicates with consolidatedInto reference
 */
@Injectable()
export class ConsolidationService {
  // Minimum occurrences to consider promoting a pattern
  private readonly MIN_OCCURRENCES = 3;
  // Similarity threshold for clustering (0.85 = very similar)
  private readonly CLUSTERING_THRESHOLD = 0.85;

  constructor(
    private prisma: PrismaService,
    private embedding: EmbeddingService,
  ) {}

  /**
   * Find and promote recurring patterns from SESSION to IDENTITY layer.
   * 
   * Algorithm:
   * 1. Get all SESSION memories for the user
   * 2. Cluster them by semantic similarity
   * 3. For clusters with 3+ members:
   *    - Pick the most complete memory as canonical
   *    - Promote it to IDENTITY
   *    - Soft-delete others with consolidatedInto reference
   * 
   * @param userId - The user whose memories to consolidate
   * @param options - Configuration options
   */
  async promoteRecurringPatterns(
    userId: string,
    options: {
      dryRun?: boolean;
      minOccurrences?: number;
      similarityThreshold?: number;
    } = {},
  ): Promise<ConsolidationResult> {
    const {
      dryRun = false,
      minOccurrences = this.MIN_OCCURRENCES,
      similarityThreshold = this.CLUSTERING_THRESHOLD,
    } = options;

    console.log('[Consolidation] Starting promoteRecurringPatterns:', {
      userId,
      dryRun,
      minOccurrences,
      similarityThreshold,
    });

    const result: ConsolidationResult = {
      promoted: 0,
      duplicatesRemoved: 0,
      clustersFound: 0,
      details: [],
    };

    // 1. Fetch all SESSION memories for the user
    const sessionMemories = await this.prisma.memory.findMany({
      where: {
        userId,
        layer: MemoryLayer.SESSION,
        deletedAt: null,
        consolidatedInto: null, // Not already consolidated
      },
      include: {
        extraction: {
          select: { what: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    console.log('[Consolidation] Found SESSION memories:', sessionMemories.length);

    if (sessionMemories.length < minOccurrences) {
      console.log('[Consolidation] Not enough memories to consolidate');
      return result;
    }

    // 2. Cluster memories by semantic similarity
    const clusters = await this.clusterBySimilarity(
      sessionMemories.map(m => ({
        id: m.id,
        raw: m.raw,
        createdAt: m.createdAt,
        extractionWhat: m.extraction?.what ?? null,
        importanceScore: m.importanceScore,
      })),
      userId,
      similarityThreshold,
    );

    console.log('[Consolidation] Found clusters:', clusters.length);

    // 3. Process clusters with enough members
    for (const cluster of clusters) {
      if (cluster.memories.length >= minOccurrences) {
        result.clustersFound++;

        // Pick the most complete memory as canonical
        // Criteria: longest extraction.what > highest importance > most recent
        const canonical = this.selectCanonical(cluster.memories);
        const duplicates = cluster.memories.filter(m => m.id !== canonical.id);

        console.log('[Consolidation] Promoting cluster:', {
          canonicalId: canonical.id,
          canonicalRaw: canonical.raw.substring(0, 50),
          duplicateCount: duplicates.length,
          avgSimilarity: cluster.averageSimilarity.toFixed(3),
        });

        if (!dryRun) {
          // Promote canonical to IDENTITY
          await this.prisma.memory.update({
            where: { id: canonical.id },
            data: {
              layer: MemoryLayer.IDENTITY,
              importanceScore: Math.min(1.0, canonical.importanceScore + 0.2),
              consolidated: true,
              consolidatedAt: new Date(),
            },
          });

          // Soft-delete duplicates with consolidatedInto reference
          for (const dup of duplicates) {
            await this.prisma.memory.update({
              where: { id: dup.id },
              data: {
                consolidatedInto: canonical.id,
                deletedAt: new Date(),
              },
            });
          }
        }

        result.promoted++;
        result.duplicatesRemoved += duplicates.length;
        result.details.push({
          canonicalId: canonical.id,
          canonicalRaw: canonical.raw,
          promotedToLayer: MemoryLayer.IDENTITY,
          duplicateIds: duplicates.map(d => d.id),
        });
      }
    }

    console.log('[Consolidation] Complete:', {
      promoted: result.promoted,
      duplicatesRemoved: result.duplicatesRemoved,
      clustersFound: result.clustersFound,
      dryRun,
    });

    return result;
  }

  /**
   * Cluster memories by semantic similarity using embeddings.
   * Uses a greedy clustering approach.
   */
  private async clusterBySimilarity(
    memories: Array<{
      id: string;
      raw: string;
      createdAt: Date;
      extractionWhat: string | null;
      importanceScore: number;
    }>,
    userId: string,
    threshold: number,
  ): Promise<MemoryCluster[]> {
    if (memories.length === 0) return [];

    const clusters: MemoryCluster[] = [];
    const assigned = new Set<string>();

    // For each unassigned memory, find all similar memories
    for (const memory of memories) {
      if (assigned.has(memory.id)) continue;

      // Generate embedding for this memory
      let embedding: number[];
      try {
        embedding = await this.embedding.generate(memory.raw);
      } catch (error) {
        console.error(`[Consolidation] Failed to generate embedding for ${memory.id}:`, error);
        continue;
      }

      // Search for similar memories
      const similar = await this.embedding.search(userId, embedding, 20);

      // Filter to memories in our list that are above threshold
      const memoryIds = new Set(memories.map(m => m.id));
      const clusterMembers = similar
        .filter(s => memoryIds.has(s.id) && !assigned.has(s.id) && s.score >= threshold)
        .map(s => {
          const mem = memories.find(m => m.id === s.id)!;
          return { ...mem, score: s.score };
        });

      if (clusterMembers.length >= 1) {
        // Include the seed memory
        const seedMem = memories.find(m => m.id === memory.id)!;
        const allMembers = [
          { ...seedMem, score: 1.0 },
          ...clusterMembers.filter(m => m.id !== memory.id),
        ];

        // Mark all as assigned
        for (const member of allMembers) {
          assigned.add(member.id);
        }

        const avgSimilarity =
          allMembers.reduce((sum, m) => sum + m.score, 0) / allMembers.length;

        clusters.push({
          memories: allMembers.map(({ score, ...rest }) => rest),
          averageSimilarity: avgSimilarity,
        });
      }
    }

    return clusters;
  }

  /**
   * Select the canonical memory from a cluster.
   * Priority: longest extraction.what > highest importance > most recent
   */
  private selectCanonical(
    memories: Array<{
      id: string;
      raw: string;
      createdAt: Date;
      extractionWhat: string | null;
      importanceScore: number;
    }>,
  ): typeof memories[0] {
    return memories.sort((a, b) => {
      // 1. Prefer longer extraction.what (more complete)
      const whatLenA = a.extractionWhat?.length ?? 0;
      const whatLenB = b.extractionWhat?.length ?? 0;
      if (whatLenA !== whatLenB) return whatLenB - whatLenA;

      // 2. Prefer higher importance
      if (a.importanceScore !== b.importanceScore) {
        return b.importanceScore - a.importanceScore;
      }

      // 3. Prefer more recent (keep the latest version)
      return b.createdAt.getTime() - a.createdAt.getTime();
    })[0];
  }

  /**
   * Get consolidation statistics for a user.
   */
  async getStats(userId: string): Promise<{
    totalMemories: number;
    sessionMemories: number;
    identityMemories: number;
    projectMemories: number;
    consolidatedCount: number;
    potentialClusters: number;
  }> {
    const [total, session, identity, project, consolidated] = await Promise.all([
      this.prisma.memory.count({
        where: { userId, deletedAt: null },
      }),
      this.prisma.memory.count({
        where: { userId, layer: MemoryLayer.SESSION, deletedAt: null },
      }),
      this.prisma.memory.count({
        where: { userId, layer: MemoryLayer.IDENTITY, deletedAt: null },
      }),
      this.prisma.memory.count({
        where: { userId, layer: MemoryLayer.PROJECT, deletedAt: null },
      }),
      this.prisma.memory.count({
        where: { userId, consolidated: true },
      }),
    ]);

    // Rough estimate of potential clusters (dry run would be more accurate)
    const potentialClusters = Math.floor(session / this.MIN_OCCURRENCES);

    return {
      totalMemories: total,
      sessionMemories: session,
      identityMemories: identity,
      projectMemories: project,
      consolidatedCount: consolidated,
      potentialClusters,
    };
  }
}
