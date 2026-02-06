import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EmbeddingService } from '../memory/embedding.service';
import { SimilarMemoryDto } from './dto/deduplication.dto';

/**
 * Pairwise similarity between two memories
 */
export interface PairwiseSimilarity {
  memoryIdA: string;
  memoryIdB: string;
  similarity: number;
}

/**
 * Cluster of similar memories
 */
export interface MemoryCluster {
  id: string;
  memoryIds: string[];
  centroidMemoryId: string;
  avgSimilarity: number;
  minSimilarity: number;
}

/**
 * Similarity Service
 *
 * Handles embedding-based similarity computation for deduplication.
 * Uses the existing EmbeddingService for vector operations.
 */
@Injectable()
export class SimilarityService {
  constructor(
    private prisma: PrismaService,
    private embedding: EmbeddingService,
  ) {}

  /**
   * Compute cosine similarity between two normalized vectors
   */
  cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) {
      throw new Error(`Vector dimension mismatch: ${a.length} vs ${b.length}`);
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    normA = Math.sqrt(normA);
    normB = Math.sqrt(normB);

    if (normA === 0 || normB === 0) return 0;

    return dotProduct / (normA * normB);
  }

  /**
   * Normalize a vector to unit length
   */
  normalize(vec: number[]): number[] {
    const norm = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0));
    if (norm === 0) return vec;
    return vec.map((v) => v / norm);
  }

  /**
   * Find memories similar to a given memory
   */
  async findSimilarMemories(
    memoryId: string,
    userId: string,
    options: {
      topK?: number;
      minSimilarity?: number;
    } = {},
  ): Promise<SimilarMemoryDto[]> {
    const { topK = 10, minSimilarity = 0.85 } = options;

    // Get the memory content
    const memory = await this.prisma.memory.findUnique({
      where: { id: memoryId },
      select: { id: true, raw: true },
    });

    if (!memory) {
      throw new Error(`Memory not found: ${memoryId}`);
    }

    // Generate embedding for query
    const queryEmbedding = await this.embedding.generate(memory.raw);

    // Search for similar vectors
    const results = await this.embedding.search(
      userId,
      queryEmbedding,
      topK + 1, // +1 to account for self-match
    );

    // Filter out self and below threshold, fetch full memory details
    const similarIds = results
      .filter((r) => r.id !== memoryId && r.score >= minSimilarity)
      .slice(0, topK)
      .map((r) => ({ id: r.id, score: r.score }));

    if (similarIds.length === 0) return [];

    // Fetch memory details
    const memories = await this.prisma.memory.findMany({
      where: {
        id: { in: similarIds.map((s) => s.id) },
        deletedAt: null,
      },
      select: {
        id: true,
        raw: true,
        memoryType: true,
        createdAt: true,
      },
    });

    // Map scores to memories
    const scoreMap = new Map(similarIds.map((s) => [s.id, s.score]));

    return memories
      .map((m) => ({
        memoryId: m.id,
        similarity: scoreMap.get(m.id) ?? 0,
        content: m.raw,
        memoryType: m.memoryType ?? undefined,
        createdAt: m.createdAt,
      }))
      .sort((a, b) => b.similarity - a.similarity);
  }

  /**
   * Find similar memories for a new content (not yet stored)
   */
  async findSimilarForContent(
    content: string,
    userId: string,
    options: {
      topK?: number;
      minSimilarity?: number;
      excludeIds?: string[];
    } = {},
  ): Promise<SimilarMemoryDto[]> {
    const { topK = 10, minSimilarity = 0.85, excludeIds = [] } = options;

    // Generate embedding for query
    const queryEmbedding = await this.embedding.generate(content);

    // Search for similar vectors
    const results = await this.embedding.search(userId, queryEmbedding, topK + excludeIds.length);

    // Filter out excluded IDs and below threshold
    const similarIds = results
      .filter((r) => !excludeIds.includes(r.id) && r.score >= minSimilarity)
      .slice(0, topK)
      .map((r) => ({ id: r.id, score: r.score }));

    if (similarIds.length === 0) return [];

    // Fetch memory details
    const memories = await this.prisma.memory.findMany({
      where: {
        id: { in: similarIds.map((s) => s.id) },
        deletedAt: null,
      },
      select: {
        id: true,
        raw: true,
        memoryType: true,
        createdAt: true,
      },
    });

    // Map scores to memories
    const scoreMap = new Map(similarIds.map((s) => [s.id, s.score]));

    return memories
      .map((m) => ({
        memoryId: m.id,
        similarity: scoreMap.get(m.id) ?? 0,
        content: m.raw,
        memoryType: m.memoryType ?? undefined,
        createdAt: m.createdAt,
      }))
      .sort((a, b) => b.similarity - a.similarity);
  }

  /**
   * Compute pairwise similarities for batch deduplication
   */
  async computePairwiseSimilarity(
    userId: string,
    options: {
      minSimilarity?: number;
      maxMemories?: number;
    } = {},
  ): Promise<PairwiseSimilarity[]> {
    const { minSimilarity = 0.85, maxMemories = 5000 } = options;

    // Fetch all active memories for user
    const memories = await this.prisma.memory.findMany({
      where: {
        userId,
        deletedAt: null,
      },
      select: {
        id: true,
        raw: true,
      },
      take: maxMemories,
      orderBy: { createdAt: 'desc' },
    });

    const pairs: PairwiseSimilarity[] = [];
    const seenPairs = new Set<string>();

    // For each memory, find its similar neighbors
    for (const memory of memories) {
      const embedding = await this.embedding.generate(memory.raw);
      const results = await this.embedding.search(
        userId,
        embedding,
        50, // Check top 50 neighbors
      );

      for (const match of results) {
        if (match.id !== memory.id && match.score >= minSimilarity) {
          // Avoid duplicate pairs (A-B and B-A)
          const [first, second] = [memory.id, match.id].sort();
          const pairKey = `${first}:${second}`;

          if (!seenPairs.has(pairKey)) {
            seenPairs.add(pairKey);
            pairs.push({
              memoryIdA: first,
              memoryIdB: second,
              similarity: match.score,
            });
          }
        }
      }
    }

    return pairs.sort((a, b) => b.similarity - a.similarity);
  }

  /**
   * Cluster similar memories using union-find
   */
  clusterSimilarMemories(pairs: PairwiseSimilarity[], threshold: number = 0.85): MemoryCluster[] {
    // Union-Find data structure
    const parent = new Map<string, string>();

    const find = (x: string): string => {
      if (!parent.has(x)) parent.set(x, x);
      if (parent.get(x) !== x) {
        parent.set(x, find(parent.get(x)!));
      }
      return parent.get(x)!;
    };

    const union = (x: string, y: string): void => {
      const px = find(x);
      const py = find(y);
      if (px !== py) parent.set(px, py);
    };

    // Build clusters from pairs above threshold
    for (const pair of pairs) {
      if (pair.similarity >= threshold) {
        union(pair.memoryIdA, pair.memoryIdB);
      }
    }

    // Group by cluster root
    const clusterMap = new Map<string, string[]>();
    for (const id of parent.keys()) {
      const root = find(id);
      if (!clusterMap.has(root)) clusterMap.set(root, []);
      clusterMap.get(root)!.push(id);
    }

    // Build cluster objects (only clusters with 2+ members)
    const clusters: MemoryCluster[] = [];
    let clusterId = 0;

    for (const [_, members] of clusterMap.entries()) {
      if (members.length < 2) continue;

      // Compute cluster statistics
      const clusterPairs = pairs.filter(
        (p) => members.includes(p.memoryIdA) && members.includes(p.memoryIdB),
      );

      const similarities = clusterPairs.map((p) => p.similarity);
      const avgSimilarity = similarities.length > 0
        ? similarities.reduce((a, b) => a + b, 0) / similarities.length
        : 0;
      const minSimilarity = similarities.length > 0 ? Math.min(...similarities) : 0;

      // Select centroid (memory with highest average similarity to others)
      const centroid = this.selectCentroid(members, clusterPairs);

      clusters.push({
        id: `cluster_${++clusterId}`,
        memoryIds: members,
        centroidMemoryId: centroid,
        avgSimilarity,
        minSimilarity,
      });
    }

    return clusters.sort((a, b) => b.avgSimilarity - a.avgSimilarity);
  }

  /**
   * Select the centroid memory (most representative) from a cluster
   */
  private selectCentroid(memoryIds: string[], pairs: PairwiseSimilarity[]): string {
    const avgSimilarities = new Map<string, number>();

    for (const id of memoryIds) {
      const relatedPairs = pairs.filter((p) => p.memoryIdA === id || p.memoryIdB === id);
      const similarities = relatedPairs.map((p) => p.similarity);
      const avg = similarities.length > 0
        ? similarities.reduce((a, b) => a + b, 0) / similarities.length
        : 0;
      avgSimilarities.set(id, avg);
    }

    // Return memory with highest average similarity
    return Array.from(avgSimilarities.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? memoryIds[0];
  }
}
