/**
 * Topic Detection Service
 *
 * Detects conversation topics using keyword matching and optional
 * embedding-based classification. Fast (<10ms target).
 *
 * Topic prototypes and recent-topic history are persisted to Redis
 * (when available) so they survive restarts.
 */

import {
  Injectable,
  Optional,
  Inject,
  OnModuleInit,
  Logger,
} from '@nestjs/common';
import { EmbeddingService } from '../memory/embedding.service';
import {
  TopicId,
  TopicScore,
  TopicDetectionResult,
  TopicDetectionConfig,
  TopicPrototype,
  ConversationContext,
  TopicShift,
} from './prefetch.types';
import {
  KEYWORD_RULES,
  getTopicDefinition,
  getRelatedTopics,
  TOPIC_DEFINITIONS,
} from './topic-taxonomy';
import Redis from 'ioredis';
import { REDIS_CLIENT } from './prefetch-cache.service';

const PROTO_PREFIX = 'topic:proto:';
const RECENT_PREFIX = 'topic:recent:';
const RECENT_TTL_SEC = 3600; // 1 hour

/**
 * Default configuration for topic detection
 */
export const DEFAULT_DETECTION_CONFIG: TopicDetectionConfig = {
  layerWeights: {
    keyword: 1.0, // Full weight when embedding is disabled
    embedding: 0.0,
  },
  minConfidence: 0.3,
  maxTopics: 3,
  contextWindowSize: 5,
  enableEmbeddingClassification: false, // Disabled by default for speed
};

@Injectable()
export class TopicDetectionService implements OnModuleInit {
  private readonly logger = new Logger(TopicDetectionService.name);
  private config: TopicDetectionConfig;
  private prototypes: Map<TopicId, TopicPrototype> = new Map();
  private recentTopics: Map<string, TopicScore[][]> = new Map(); // userId -> history

  constructor(
    @Optional() private embeddingService?: EmbeddingService,
    @Optional() @Inject(REDIS_CLIENT) private readonly redis?: Redis,
  ) {
    this.config = { ...DEFAULT_DETECTION_CONFIG };
  }

  async onModuleInit(): Promise<void> {
    if (!this.redis) return;
    try {
      await this.hydratePrototypesFromRedis();
      await this.hydrateRecentTopicsFromRedis();
    } catch (err) {
      this.logger.warn('Failed to hydrate topic data from Redis', err);
    }
  }

  /**
   * Configure the detection service
   */
  configure(config: Partial<TopicDetectionConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get current configuration
   */
  getConfig(): TopicDetectionConfig {
    return { ...this.config };
  }

  /**
   * Initialize topic prototypes from embeddings
   * Call this at service start if embedding-based detection is enabled
   */
  async initializePrototypes(): Promise<void> {
    if (!this.config.enableEmbeddingClassification || !this.embeddingService) {
      return;
    }

    for (const topic of TOPIC_DEFINITIONS) {
      try {
        const embedding = await this.embeddingService.generate(
          topic.prototypeQuery,
        );
        this.prototypes.set(topic.id, {
          topic: topic.id,
          embedding,
          threshold: 0.5,
        });
      } catch (error) {
        this.logger.warn(
          `Failed to initialize prototype for topic ${topic.id}:`,
          error,
        );
      }
    }

    // Persist all prototypes to Redis
    this.persistAllPrototypesToRedis();
  }

  /**
   * Set a topic prototype embedding directly
   * Useful for testing or custom prototypes
   */
  setPrototype(
    topicId: TopicId,
    embedding: number[],
    threshold: number = 0.5,
  ): void {
    const proto: TopicPrototype = {
      topic: topicId,
      embedding,
      threshold,
    };
    this.prototypes.set(topicId, proto);
    this.persistPrototypeToRedis(topicId, proto);
  }

  /**
   * Detect topics from a message
   */
  async detect(
    message: string,
    context?: ConversationContext,
  ): Promise<TopicDetectionResult> {
    const startTime = Date.now();

    // Layer 1: Keyword matching (always runs, very fast)
    const keywordScores = this.matchKeywords(message);

    // Layer 2: Embedding-based classification (optional)
    let embeddingScores = new Map<TopicId, number>();
    if (
      this.config.enableEmbeddingClassification &&
      this.embeddingService &&
      this.prototypes.size > 0
    ) {
      embeddingScores = await this.classifyByEmbedding(message);
    }

    // Merge scores
    const mergedScores = this.mergeScores(keywordScores, embeddingScores);

    // Apply context smoothing if context provided
    if (context?.recentTopics && context.recentTopics.length > 0) {
      this.applyContextSmoothing(mergedScores, context.recentTopics);
    }

    // Convert to sorted array and filter
    const topics = this.rankAndFilterTopics(mergedScores);

    // Track for topic shift detection
    if (context?.userId) {
      this.trackTopics(context.userId, topics);
    }

    return {
      topics,
      processingTimeMs: Date.now() - startTime,
      layerBreakdown: {
        keyword: keywordScores,
        embedding: embeddingScores,
      },
    };
  }

  /**
   * Detect topic shift between recent topics and current
   */
  detectTopicShift(
    userId: string,
    currentTopics: TopicScore[],
  ): TopicShift | null {
    const history = this.recentTopics.get(userId);
    if (!history || history.length < 2) {
      return null;
    }

    // Get previous topics (average over history)
    const previousTopics = new Map<TopicId, number>();
    for (const messageTopics of history.slice(0, -1)) {
      for (const topic of messageTopics) {
        const current = previousTopics.get(topic.topic) || 0;
        previousTopics.set(topic.topic, current + topic.confidence);
      }
    }

    // Normalize
    for (const [topic, sum] of previousTopics) {
      previousTopics.set(topic, sum / (history.length - 1));
    }

    // Find departed and arrived topics
    const departedTopics: TopicId[] = [];
    const arrivedTopics: TopicId[] = [];
    const shiftThreshold = 0.4;

    for (const [topic, avgConfidence] of previousTopics) {
      const currentScore =
        currentTopics.find((t) => t.topic === topic)?.confidence || 0;
      if (avgConfidence - currentScore > shiftThreshold) {
        departedTopics.push(topic);
      }
    }

    for (const topic of currentTopics) {
      if (!previousTopics.has(topic.topic) && topic.confidence > 0.5) {
        arrivedTopics.push(topic.topic);
      }
    }

    if (departedTopics.length === 0 && arrivedTopics.length === 0) {
      return null;
    }

    return {
      departedTopics,
      arrivedTopics,
      confidence: Math.max(
        ...departedTopics.map(() => 0.7),
        ...arrivedTopics.map(() => 0.8),
        0.5,
      ),
    };
  }

  /**
   * Get predicted next topics based on current topics
   */
  predictNextTopics(currentTopics: TopicScore[]): TopicScore[] {
    const predicted: TopicScore[] = [];

    for (const topic of currentTopics) {
      const related = getRelatedTopics(topic.topic);
      for (const relatedTopic of related) {
        // Don't re-add current topics
        if (currentTopics.some((t) => t.topic === relatedTopic)) continue;
        if (predicted.some((p) => p.topic === relatedTopic)) continue;

        predicted.push({
          topic: relatedTopic,
          confidence: topic.confidence * 0.5,
          source: 'merged',
        });
      }
    }

    return predicted.sort((a, b) => b.confidence - a.confidence).slice(0, 3);
  }

  /**
   * Clear topic history for a user
   */
  clearHistory(userId: string): void {
    this.recentTopics.delete(userId);
    this.deleteRecentTopicsFromRedis(userId);
  }

  // =========================================================================
  // Private Methods
  // =========================================================================

  /**
   * Match keywords against message using compiled regex patterns
   */
  private matchKeywords(message: string): Map<TopicId, number> {
    const scores = new Map<TopicId, number>();

    for (const rule of KEYWORD_RULES) {
      let matchCount = 0;
      for (const pattern of rule.patterns) {
        // Test against original message since patterns have /i flag
        if (pattern.test(message)) {
          matchCount++;
        }
      }

      if (matchCount > 0) {
        // Diminishing returns for multiple matches
        const confidence = rule.weight * Math.min(matchCount / 2, 1);
        const existing = scores.get(rule.topic) || 0;
        scores.set(rule.topic, Math.max(existing, confidence));

        // If this is a child topic, also boost parent
        const topicDef = getTopicDefinition(rule.topic);
        if (topicDef?.parentId) {
          const parentScore = scores.get(topicDef.parentId) || 0;
          scores.set(
            topicDef.parentId,
            Math.max(parentScore, confidence * 0.7),
          );
        }
      }
    }

    return scores;
  }

  /**
   * Classify message by embedding similarity to topic prototypes
   */
  private async classifyByEmbedding(
    message: string,
  ): Promise<Map<TopicId, number>> {
    const scores = new Map<TopicId, number>();

    if (!this.embeddingService) {
      return scores;
    }

    try {
      const messageEmbedding = await this.embeddingService.generate(message);

      for (const [topicId, proto] of this.prototypes) {
        const similarity = this.cosineSimilarity(
          messageEmbedding,
          proto.embedding,
        );
        if (similarity >= proto.threshold) {
          scores.set(topicId, similarity);
        }
      }
    } catch (error) {
      this.logger.warn('Embedding classification failed:', error);
    }

    return scores;
  }

  /**
   * Merge scores from different layers
   */
  private mergeScores(
    keywordScores: Map<TopicId, number>,
    embeddingScores: Map<TopicId, number>,
  ): Map<TopicId, number> {
    const merged = new Map<TopicId, number>();
    const allTopics = new Set([
      ...keywordScores.keys(),
      ...embeddingScores.keys(),
    ]);

    // Calculate total weight to normalize if only one layer is active
    const totalWeight =
      this.config.layerWeights.keyword + this.config.layerWeights.embedding;
    const normalizer = totalWeight > 0 ? totalWeight : 1;

    for (const topic of allTopics) {
      const keywordScore = keywordScores.get(topic) || 0;
      const embeddingScore = embeddingScores.get(topic) || 0;

      // If embedding is disabled (weight 0), just use keyword score directly
      let mergedScore: number;
      if (
        this.config.layerWeights.embedding === 0 ||
        embeddingScores.size === 0
      ) {
        mergedScore = keywordScore;
      } else if (this.config.layerWeights.keyword === 0) {
        mergedScore = embeddingScore;
      } else {
        mergedScore =
          (keywordScore * this.config.layerWeights.keyword +
            embeddingScore * this.config.layerWeights.embedding) /
          normalizer;
      }

      if (mergedScore >= this.config.minConfidence) {
        merged.set(topic, mergedScore);
      }
    }

    return merged;
  }

  /**
   * Apply context smoothing - boost recent topics
   */
  private applyContextSmoothing(
    scores: Map<TopicId, number>,
    recentTopics: TopicScore[],
  ): void {
    // Recent topics get a 15% boost (topic persistence)
    for (const recent of recentTopics.slice(0, 3)) {
      const current = scores.get(recent.topic) || 0;
      if (current > 0) {
        scores.set(recent.topic, current * 1.15);
      } else if (recent.confidence > 0.7) {
        // Strong recent topic carries forward even without new signal
        scores.set(recent.topic, 0.2);
      }
    }
  }

  /**
   * Rank and filter topics
   */
  private rankAndFilterTopics(scores: Map<TopicId, number>): TopicScore[] {
    const topics: TopicScore[] = [];

    for (const [topic, confidence] of scores) {
      if (confidence >= this.config.minConfidence) {
        topics.push({
          topic,
          confidence,
          source: 'merged',
        });
      }
    }

    return topics
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, this.config.maxTopics);
  }

  /**
   * Track topics for history
   */
  private trackTopics(userId: string, topics: TopicScore[]): void {
    const history = this.recentTopics.get(userId) || [];
    history.push(topics);

    // Maintain window size
    while (history.length > this.config.contextWindowSize) {
      history.shift();
    }

    this.recentTopics.set(userId, history);
    this.persistRecentTopicsToRedis(userId, history);
  }

  /**
   * Calculate cosine similarity between two vectors
   */
  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) {
      throw new Error('Vectors must have same length');
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
    if (magnitude === 0) return 0;

    return dotProduct / magnitude;
  }

  // =========================================================================
  // Redis Persistence (fire-and-forget write-through)
  // =========================================================================

  private persistPrototypeToRedis(
    topicId: TopicId,
    proto: TopicPrototype,
  ): void {
    if (!this.redis) return;
    this.redis
      .set(PROTO_PREFIX + topicId, JSON.stringify(proto))
      .catch((err) => this.logger.warn('Redis prototype persist failed', err));
  }

  private persistAllPrototypesToRedis(): void {
    if (!this.redis) return;
    const pipeline = this.redis.pipeline();
    for (const [topicId, proto] of this.prototypes) {
      pipeline.set(PROTO_PREFIX + topicId, JSON.stringify(proto));
    }
    pipeline
      .exec()
      .catch((err) =>
        this.logger.warn('Redis prototype batch persist failed', err),
      );
  }

  private persistRecentTopicsToRedis(
    userId: string,
    history: TopicScore[][],
  ): void {
    if (!this.redis) return;
    this.redis
      .set(
        RECENT_PREFIX + userId,
        JSON.stringify(history),
        'EX',
        RECENT_TTL_SEC,
      )
      .catch((err) =>
        this.logger.warn('Redis recent topics persist failed', err),
      );
  }

  private deleteRecentTopicsFromRedis(userId: string): void {
    if (!this.redis) return;
    this.redis
      .del(RECENT_PREFIX + userId)
      .catch((err) =>
        this.logger.warn('Redis recent topics delete failed', err),
      );
  }

  private async hydratePrototypesFromRedis(): Promise<void> {
    if (!this.redis) return;
    const keys: string[] = [];
    const stream = this.redis.scanStream({
      match: PROTO_PREFIX + '*',
      count: 100,
    });

    await new Promise<void>((resolve, reject) => {
      stream.on('data', (batch: string[]) => keys.push(...batch));
      stream.on('end', resolve);
      stream.on('error', reject);
    });

    if (keys.length === 0) return;

    const pipeline = this.redis.pipeline();
    for (const key of keys) pipeline.get(key);
    const results = await pipeline.exec();
    if (!results) return;

    let count = 0;
    for (const [err, val] of results) {
      if (err || !val) continue;
      try {
        const proto: TopicPrototype = JSON.parse(val as string);
        this.prototypes.set(proto.topic, proto);
        count++;
      } catch {
        // skip
      }
    }
    this.logger.log(`Hydrated ${count} topic prototypes from Redis`);
  }

  private async hydrateRecentTopicsFromRedis(): Promise<void> {
    if (!this.redis) return;
    const keys: string[] = [];
    const stream = this.redis.scanStream({
      match: RECENT_PREFIX + '*',
      count: 100,
    });

    await new Promise<void>((resolve, reject) => {
      stream.on('data', (batch: string[]) => keys.push(...batch));
      stream.on('end', resolve);
      stream.on('error', reject);
    });

    if (keys.length === 0) return;

    const pipeline = this.redis.pipeline();
    for (const key of keys) pipeline.get(key);
    const results = await pipeline.exec();
    if (!results) return;

    let count = 0;
    for (let i = 0; i < keys.length; i++) {
      const [err, val] = results[i];
      if (err || !val) continue;
      try {
        const userId = keys[i].slice(RECENT_PREFIX.length);
        const history: TopicScore[][] = JSON.parse(val as string);
        this.recentTopics.set(userId, history);
        count++;
      } catch {
        // skip
      }
    }
    this.logger.log(`Hydrated ${count} user topic histories from Redis`);
  }
}
