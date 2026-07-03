import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LLMService } from '../llm/llm.service';

export interface ClusteringRunOptions {
  userId?: string;
  eps?: number; // DBSCAN epsilon (cosine distance threshold)
  minPoints?: number; // DBSCAN minimum cluster size
  dryRun?: boolean;
  modelId?: string; // Which embedding model to use for distances
}

export interface ClusteringRunResult {
  clustersCreated: number;
  memoriesClustered: number;
  memoriesTotal: number;
  noisePoints: number;
  dryRun: boolean;
  durationMs: number;
}

export interface ClusterSummary {
  id: string;
  label: string;
  description: string | null;
  memberCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface ClusterDetail extends ClusterSummary {
  members: Array<{
    id: string;
    raw: string;
    effectiveScore: number;
    memoryType: string | null;
    createdAt: Date;
  }>;
}

@Injectable()
export class ClusteringService {
  private readonly logger = new Logger(ClusteringService.name);

  constructor(
    private prisma: PrismaService,
    private llm: LLMService,
  ) {}

  /**
   * Run DBSCAN clustering on memory embeddings using pgvector cosine distances.
   *
   * Algorithm:
   * 1. Fetch all active memories with ensemble embeddings
   * 2. For each unvisited point, find neighbors within eps cosine distance
   * 3. If neighbors >= minPoints, form a cluster and expand
   * 4. Label clusters using top keywords via LLM
   * 5. Store cluster assignments
   */
  async run(options: ClusteringRunOptions = {}): Promise<ClusteringRunResult> {
    const startTime = Date.now();
    const eps = options.eps ?? 0.35; // cosine distance threshold
    const minPoints = options.minPoints ?? 3;
    const dryRun = options.dryRun ?? false;
    const modelId = options.modelId ?? 'bge-base';

    // Resolve userId
    const userId = options.userId;
    if (!userId) {
      const users = await this.prisma.memory.findMany({
        where: { deletedAt: null },
        select: { userId: true },
        distinct: ['userId'],
      });
      if (users.length === 0) {
        return {
          clustersCreated: 0,
          memoriesClustered: 0,
          memoriesTotal: 0,
          noisePoints: 0,
          dryRun,
          durationMs: Date.now() - startTime,
        };
      }
      // Run for all users, return last result
      let lastResult: ClusteringRunResult | undefined;
      for (const user of users) {
        lastResult = await this.run({ ...options, userId: user.userId });
      }
      return lastResult!;
    }

    this.logger.log(
      `Starting DBSCAN clustering for user ${userId} (eps=${eps}, minPoints=${minPoints}, model=${modelId})`,
    );

    // Fetch memory IDs that have embeddings for the chosen model
    const memoryRows = await this.prisma.$queryRawUnsafe<
      Array<{ memory_id: string }>
    >(
      `SELECT me.memory_id 
       FROM memory_embeddings me
       JOIN memories m ON m.id = me.memory_id
       WHERE m.user_id = $1 
         AND m.deleted_at IS NULL 
         AND m.archived_reason IS NULL
         AND me.model_id = $2
         AND me.embedding IS NOT NULL
       ORDER BY m.created_at DESC`,
      userId,
      modelId,
    );

    const memoryIds = memoryRows.map((r) => r.memory_id);
    const totalMemories = memoryIds.length;

    if (totalMemories < minPoints) {
      this.logger.log(
        `Not enough memories with embeddings (${totalMemories} < ${minPoints})`,
      );
      return {
        clustersCreated: 0,
        memoriesClustered: 0,
        memoriesTotal: totalMemories,
        noisePoints: totalMemories,
        dryRun,
        durationMs: Date.now() - startTime,
      };
    }

    // Batch-fetch all embeddings once to avoid O(n²) DB queries
    const embeddingRows = await this.prisma.$queryRawUnsafe<
      Array<{ memory_id: string; embedding: string }>
    >(
      `SELECT memory_id, embedding::text
       FROM memory_embeddings
       WHERE memory_id = ANY($1::text[])
         AND model_id = $2
         AND embedding IS NOT NULL`,
      memoryIds,
      modelId,
    );

    // Parse embeddings into a map of memoryId -> float array
    const embeddingMap = new Map<string, number[]>();
    for (const row of embeddingRows) {
      const vec = row.embedding.replace(/[[\]]/g, '').split(',').map(Number);
      embeddingMap.set(row.memory_id, vec);
    }

    // Pre-compute neighbor lists in-memory using cosine distance
    const neighborCache = new Map<string, string[]>();
    const idsWithEmbeddings = memoryIds.filter((id) => embeddingMap.has(id));

    for (const memoryId of idsWithEmbeddings) {
      const neighbors: string[] = [];
      const vecA = embeddingMap.get(memoryId)!;
      for (const candidateId of idsWithEmbeddings) {
        if (candidateId === memoryId) continue;
        const vecB = embeddingMap.get(candidateId)!;
        const dist = this.cosineDistance(vecA, vecB);
        if (dist <= eps) {
          neighbors.push(candidateId);
        }
      }
      neighborCache.set(memoryId, neighbors);
    }

    // DBSCAN using pre-computed in-memory neighbors
    const visited = new Set<string>();
    const clusterAssignments = new Map<string, number>(); // memoryId -> clusterId
    let nextClusterId = 0;

    for (const memoryId of idsWithEmbeddings) {
      if (visited.has(memoryId)) continue;
      visited.add(memoryId);

      const neighbors = neighborCache.get(memoryId) || [];

      if (neighbors.length < minPoints) {
        // Noise point
        continue;
      }

      // Start new cluster
      const clusterId = nextClusterId++;
      clusterAssignments.set(memoryId, clusterId);

      // Expand cluster
      const queue = [...neighbors];
      const queued = new Set(neighbors);

      while (queue.length > 0) {
        const currentId = queue.shift()!;

        if (!visited.has(currentId)) {
          visited.add(currentId);
          const currentNeighbors = neighborCache.get(currentId) || [];

          if (currentNeighbors.length >= minPoints) {
            for (const n of currentNeighbors) {
              if (!queued.has(n)) {
                queue.push(n);
                queued.add(n);
              }
            }
          }
        }

        if (!clusterAssignments.has(currentId)) {
          clusterAssignments.set(currentId, clusterId);
        }
      }
    }

    // Group memories by cluster
    const clusters = new Map<number, string[]>();
    for (const [memId, clustId] of clusterAssignments) {
      if (!clusters.has(clustId)) clusters.set(clustId, []);
      clusters.get(clustId)!.push(memId);
    }

    const noisePoints = totalMemories - clusterAssignments.size;
    this.logger.log(
      `DBSCAN found ${clusters.size} clusters, ${noisePoints} noise points`,
    );

    if (dryRun) {
      return {
        clustersCreated: clusters.size,
        memoriesClustered: clusterAssignments.size,
        memoriesTotal: totalMemories,
        noisePoints,
        dryRun: true,
        durationMs: Date.now() - startTime,
      };
    }

    // Clear old cluster assignments for this user
    await this.prisma.$executeRawUnsafe(
      `UPDATE memories SET cluster_id = NULL WHERE user_id = $1 AND cluster_id IS NOT NULL`,
      userId,
    );

    // Delete old clusters (orphaned)
    await this.prisma.$executeRawUnsafe(
      `DELETE FROM memory_clusters WHERE id NOT IN (SELECT DISTINCT cluster_id FROM memories WHERE cluster_id IS NOT NULL) OR id IN (
        SELECT mc.id FROM memory_clusters mc 
        JOIN memories m ON m.cluster_id = mc.id 
        WHERE m.user_id = $1
        GROUP BY mc.id
      )`,
      userId,
    );

    // Also clean up any clusters that no longer have members
    await this.prisma.$executeRawUnsafe(
      `DELETE FROM memory_clusters WHERE member_count = 0`,
    );

    // Create clusters with labels
    let clustersCreated = 0;
    for (const [clustId, memberIds] of clusters) {
      // Fetch memory texts for labeling
      const memories = await this.prisma.memory.findMany({
        where: { id: { in: memberIds } },
        select: { id: true, raw: true },
      });

      const label = await this.generateClusterLabel(memories.map((m) => m.raw));

      // Compute centroid embedding (average of member embeddings)
      const centroidResult = await this.prisma.$queryRawUnsafe<
        Array<{ centroid: string }>
      >(
        `SELECT avg(me.embedding)::text as centroid
         FROM memory_embeddings me
         WHERE me.memory_id = ANY($1::text[])
           AND me.model_id = $2`,
        memberIds,
        modelId,
      );

      const centroidEmbedding = centroidResult[0]?.centroid;

      // Create cluster record via raw SQL (since Prisma doesn't know the model yet)
      const clusterId = `clust_${Date.now()}_${clustId}`;
      await this.prisma.$executeRawUnsafe(
        `INSERT INTO memory_clusters (id, label, description, member_count, centroid_embedding, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5::vector, NOW(), NOW())`,
        clusterId,
        label.label,
        label.description,
        memberIds.length,
        centroidEmbedding,
      );

      // Update memories with cluster assignment
      await this.prisma.$executeRawUnsafe(
        `UPDATE memories SET cluster_id = $1 WHERE id = ANY($2::text[])`,
        clusterId,
        memberIds,
      );

      clustersCreated++;
    }

    return {
      clustersCreated,
      memoriesClustered: clusterAssignments.size,
      memoriesTotal: totalMemories,
      noisePoints,
      dryRun: false,
      durationMs: Date.now() - startTime,
    };
  }

  /**
   * Compute cosine distance between two vectors.
   * Cosine distance = 1 - cosine_similarity
   */
  private cosineDistance(a: number[], b: number[]): number {
    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    if (denom === 0) return 1;
    return 1 - dot / denom;
  }

  /**
   * Generate a human-readable label for a cluster using LLM
   */
  private async generateClusterLabel(
    texts: string[],
  ): Promise<{ label: string; description: string }> {
    const sample = texts
      .slice(0, 10)
      .map((t, i) => `${i + 1}. ${t}`)
      .join('\n');

    try {
      const result = await this.llm.json<{
        label: string;
        description: string;
      }>(
        [
          {
            role: 'system',
            content: `You are labeling a cluster of related memories. Generate a short label (2-5 words) and a one-sentence description. Respond with JSON: { "label": "short label", "description": "one sentence description" }`,
          },
          {
            role: 'user',
            content: `Memories in this cluster:\n${sample}`,
          },
        ],
        undefined,
        { temperature: 0.2 },
      );

      return {
        label: result.label || 'Unlabeled Cluster',
        description: result.description || '',
      };
    } catch {
      // Fallback: extract common words
      const words = texts.join(' ').toLowerCase().split(/\s+/);
      const freq = new Map<string, number>();
      const stopWords = new Set([
        'the',
        'a',
        'an',
        'is',
        'are',
        'was',
        'were',
        'to',
        'of',
        'in',
        'for',
        'and',
        'or',
        'that',
        'this',
        'with',
        'on',
        'at',
        'by',
        'from',
      ]);
      for (const w of words) {
        if (w.length > 3 && !stopWords.has(w)) {
          freq.set(w, (freq.get(w) || 0) + 1);
        }
      }
      const topWords = Array.from(freq.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([w]) => w);

      return {
        label: topWords.join(' ') || 'Unlabeled Cluster',
        description: `Cluster of ${texts.length} related memories`,
      };
    }
  }

  /**
   * List all clusters with member counts
   */
  async listClusters(): Promise<ClusterSummary[]> {
    const clusters = await this.prisma.$queryRawUnsafe<
      Array<{
        id: string;
        label: string;
        description: string | null;
        member_count: number;
        created_at: Date;
        updated_at: Date;
      }>
    >(
      `SELECT id, label, description, member_count, created_at, updated_at
       FROM memory_clusters
       ORDER BY member_count DESC`,
    );

    return clusters.map((c) => ({
      id: c.id,
      label: c.label,
      description: c.description,
      memberCount: Number(c.member_count),
      createdAt: c.created_at,
      updatedAt: c.updated_at,
    }));
  }

  /**
   * Get a cluster with its member memories
   */
  async getCluster(clusterId: string): Promise<ClusterDetail | null> {
    const clusterRows = await this.prisma.$queryRawUnsafe<
      Array<{
        id: string;
        label: string;
        description: string | null;
        member_count: number;
        created_at: Date;
        updated_at: Date;
      }>
    >(
      `SELECT id, label, description, member_count, created_at, updated_at
       FROM memory_clusters WHERE id = $1`,
      clusterId,
    );

    if (clusterRows.length === 0) return null;

    const cluster = clusterRows[0];

    const members = await this.prisma.$queryRawUnsafe<
      Array<{
        id: string;
        raw: string;
        effective_score: number;
        memory_type: string | null;
        created_at: Date;
      }>
    >(
      `SELECT id, raw, effective_score, memory_type, created_at
       FROM memories WHERE cluster_id = $1 AND deleted_at IS NULL
       ORDER BY effective_score DESC`,
      clusterId,
    );

    return {
      id: cluster.id,
      label: cluster.label,
      description: cluster.description,
      memberCount: Number(cluster.member_count),
      createdAt: cluster.created_at,
      updatedAt: cluster.updated_at,
      members: members.map((m) => ({
        id: m.id,
        raw: m.raw,
        effectiveScore: Number(m.effective_score),
        memoryType: m.memory_type,
        createdAt: m.created_at,
      })),
    };
  }
}
