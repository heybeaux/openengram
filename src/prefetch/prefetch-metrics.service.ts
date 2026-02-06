/**
 * Prefetch Metrics Service
 * 
 * Tracks precision, recall, and other metrics for prefetch effectiveness.
 * Provides insights for learning and optimization.
 */

import { Injectable } from '@nestjs/common';
import {
  TopicId,
  PrefetchFeedback,
  PrecisionRecallMetrics,
  PrefetchMetrics,
} from './prefetch.types';

interface FeedbackEntry {
  feedback: PrefetchFeedback;
  completed: boolean;
}

interface LatencyBucket {
  latencies: number[];
  maxSize: number;
}

@Injectable()
export class PrefetchMetricsService {
  // Feedback tracking
  private pendingFeedback: Map<string, FeedbackEntry> = new Map();
  private completedFeedback: PrefetchFeedback[] = [];
  private maxFeedbackHistory = 1000;
  
  // Latency tracking
  private latencyBuckets: Map<string, LatencyBucket> = new Map();
  
  // Counters
  private totalPrefetches = 0;
  private totalAccesses = 0;
  private cacheHits = 0;
  private cacheMisses = 0;
  private topicDetectionLatencies: number[] = [];
  
  // Memory pressure
  private memoryPressureLevel: 'normal' | 'warning' | 'critical' = 'normal';
  
  constructor() {
    // Initialize latency buckets
    this.latencyBuckets.set('prefetch', { latencies: [], maxSize: 100 });
    this.latencyBuckets.set('lookup', { latencies: [], maxSize: 100 });
    this.latencyBuckets.set('detection', { latencies: [], maxSize: 100 });
  }
  
  /**
   * Record a prefetch operation
   */
  recordPrefetch(
    prefetchId: string,
    userId: string,
    topic: TopicId,
    memoryId: string,
    topicConfidence: number,
    memoryScore: number,
  ): void {
    const key = `${prefetchId}:${memoryId}`;
    
    const feedback: PrefetchFeedback = {
      prefetchId,
      userId,
      topic,
      memoryId,
      prefetchedAt: Date.now(),
      wasAccessed: false,
      topicConfidence,
      memoryScore,
    };
    
    this.pendingFeedback.set(key, {
      feedback,
      completed: false,
    });
    
    this.totalPrefetches++;
    
    // Auto-complete after timeout (5 minutes)
    setTimeout(() => {
      this.completeFeedback(prefetchId, memoryId);
    }, 5 * 60 * 1000);
  }
  
  /**
   * Record that a prefetched memory was accessed
   */
  recordAccess(prefetchId: string, memoryId: string): void {
    const key = `${prefetchId}:${memoryId}`;
    const entry = this.pendingFeedback.get(key);
    
    if (entry && !entry.completed) {
      entry.feedback.wasAccessed = true;
      entry.feedback.accessedAt = Date.now();
      entry.feedback.accessLatencyMs = 
        entry.feedback.accessedAt - entry.feedback.prefetchedAt;
    }
    
    this.totalAccesses++;
  }
  
  /**
   * Record cache hit/miss
   */
  recordCacheResult(hit: boolean): void {
    if (hit) {
      this.cacheHits++;
    } else {
      this.cacheMisses++;
    }
  }
  
  /**
   * Record topic detection latency
   */
  recordDetectionLatency(latencyMs: number): void {
    this.addLatency('detection', latencyMs);
  }
  
  /**
   * Record prefetch latency
   */
  recordPrefetchLatency(latencyMs: number): void {
    this.addLatency('prefetch', latencyMs);
  }
  
  /**
   * Record lookup latency
   */
  recordLookupLatency(latencyMs: number): void {
    this.addLatency('lookup', latencyMs);
  }
  
  /**
   * Set memory pressure level
   */
  setMemoryPressure(level: 'normal' | 'warning' | 'critical'): void {
    this.memoryPressureLevel = level;
  }
  
  /**
   * Calculate precision/recall metrics
   */
  calculatePrecisionRecall(
    userId?: string,
    windowMs: number = 24 * 60 * 60 * 1000,
  ): PrecisionRecallMetrics {
    const since = Date.now() - windowMs;
    
    // Filter feedback by time and optionally user
    const relevantFeedback = this.completedFeedback.filter(f => {
      if (f.prefetchedAt < since) return false;
      if (userId && f.userId !== userId) return false;
      return true;
    });
    
    if (relevantFeedback.length === 0) {
      return {
        precision: 0,
        recall: 0,
        f1Score: 0,
        byTopic: {},
      };
    }
    
    // Calculate overall precision
    const prefetchedCount = relevantFeedback.length;
    const usedCount = relevantFeedback.filter(f => f.wasAccessed).length;
    const precision = prefetchedCount > 0 ? usedCount / prefetchedCount : 0;
    
    // For recall, we need to know total accessed memories
    // We use totalAccesses as a proxy
    const recall = this.totalAccesses > 0 ? usedCount / this.totalAccesses : 0;
    
    // F1 score
    const f1Score = precision + recall > 0
      ? 2 * (precision * recall) / (precision + recall)
      : 0;
    
    // Calculate by topic
    const byTopic: PrecisionRecallMetrics['byTopic'] = {};
    const topicGroups = new Map<TopicId, PrefetchFeedback[]>();
    
    for (const feedback of relevantFeedback) {
      if (!topicGroups.has(feedback.topic)) {
        topicGroups.set(feedback.topic, []);
      }
      topicGroups.get(feedback.topic)!.push(feedback);
    }
    
    for (const [topic, feedbacks] of topicGroups) {
      const topicPrefetched = feedbacks.length;
      const topicUsed = feedbacks.filter(f => f.wasAccessed).length;
      const topicPrecision = topicPrefetched > 0 ? topicUsed / topicPrefetched : 0;
      // We don't have per-topic recall without more data
      const topicRecall = topicPrecision; // Use precision as proxy
      const topicF1 = topicPrecision + topicRecall > 0
        ? 2 * (topicPrecision * topicRecall) / (topicPrecision + topicRecall)
        : 0;
      
      byTopic[topic] = {
        precision: topicPrecision,
        recall: topicRecall,
        f1Score: topicF1,
        sampleSize: topicPrefetched,
      };
    }
    
    return { precision, recall, f1Score, byTopic };
  }
  
  /**
   * Get overall prefetch metrics
   */
  getMetrics(): PrefetchMetrics {
    const totalCacheOps = this.cacheHits + this.cacheMisses;
    const pr = this.calculatePrecisionRecall();
    
    return {
      cacheHitRate: totalCacheOps > 0 ? this.cacheHits / totalCacheOps : 0,
      prefetchHitRate: this.totalPrefetches > 0
        ? this.completedFeedback.filter(f => f.wasAccessed).length / this.totalPrefetches
        : 0,
      avgLatencyMs: this.calculateAvgLatency('lookup'),
      p50LatencyMs: this.calculatePercentile('lookup', 50),
      p95LatencyMs: this.calculatePercentile('lookup', 95),
      prefetchPrecision: pr.precision,
      prefetchRecall: pr.recall,
      topicDetectionLatencyMs: this.calculateAvgLatency('detection'),
      totalPrefetches: this.totalPrefetches,
      totalAccesses: this.totalAccesses,
      memoryPressureLevel: this.memoryPressureLevel,
    };
  }
  
  /**
   * Get topic-specific metrics
   */
  getTopicMetrics(topic: TopicId): {
    precision: number;
    sampleSize: number;
    avgScore: number;
    avgLatencyMs: number;
  } {
    const topicFeedback = this.completedFeedback.filter(f => f.topic === topic);
    
    if (topicFeedback.length === 0) {
      return {
        precision: 0,
        sampleSize: 0,
        avgScore: 0,
        avgLatencyMs: 0,
      };
    }
    
    const usedCount = topicFeedback.filter(f => f.wasAccessed).length;
    const avgScore = topicFeedback.reduce((sum, f) => sum + f.memoryScore, 0) / topicFeedback.length;
    const latencies = topicFeedback
      .filter(f => f.accessLatencyMs !== undefined)
      .map(f => f.accessLatencyMs!);
    const avgLatencyMs = latencies.length > 0
      ? latencies.reduce((sum, l) => sum + l, 0) / latencies.length
      : 0;
    
    return {
      precision: usedCount / topicFeedback.length,
      sampleSize: topicFeedback.length,
      avgScore,
      avgLatencyMs,
    };
  }
  
  /**
   * Reset all metrics
   */
  reset(): void {
    this.pendingFeedback.clear();
    this.completedFeedback = [];
    this.totalPrefetches = 0;
    this.totalAccesses = 0;
    this.cacheHits = 0;
    this.cacheMisses = 0;
    
    for (const bucket of this.latencyBuckets.values()) {
      bucket.latencies = [];
    }
  }
  
  /**
   * Get feedback for learning
   */
  getFeedbackForLearning(
    minSamples: number = 50,
    days: number = 7,
  ): Map<TopicId, PrefetchFeedback[]> {
    const since = Date.now() - days * 24 * 60 * 60 * 1000;
    const byTopic = new Map<TopicId, PrefetchFeedback[]>();
    
    for (const feedback of this.completedFeedback) {
      if (feedback.prefetchedAt < since) continue;
      
      if (!byTopic.has(feedback.topic)) {
        byTopic.set(feedback.topic, []);
      }
      byTopic.get(feedback.topic)!.push(feedback);
    }
    
    // Filter to topics with enough samples
    for (const [topic, feedbacks] of byTopic) {
      if (feedbacks.length < minSamples) {
        byTopic.delete(topic);
      }
    }
    
    return byTopic;
  }
  
  // =========================================================================
  // Private Methods
  // =========================================================================
  
  /**
   * Complete feedback entry
   */
  private completeFeedback(prefetchId: string, memoryId: string): void {
    const key = `${prefetchId}:${memoryId}`;
    const entry = this.pendingFeedback.get(key);
    
    if (!entry || entry.completed) return;
    
    entry.completed = true;
    this.pendingFeedback.delete(key);
    
    // Store completed feedback
    this.completedFeedback.push(entry.feedback);
    
    // Trim history
    while (this.completedFeedback.length > this.maxFeedbackHistory) {
      this.completedFeedback.shift();
    }
  }
  
  /**
   * Add latency to bucket
   */
  private addLatency(bucket: string, latencyMs: number): void {
    const b = this.latencyBuckets.get(bucket);
    if (!b) return;
    
    b.latencies.push(latencyMs);
    
    // Trim to max size
    while (b.latencies.length > b.maxSize) {
      b.latencies.shift();
    }
  }
  
  /**
   * Calculate average latency for a bucket
   */
  private calculateAvgLatency(bucket: string): number {
    const b = this.latencyBuckets.get(bucket);
    if (!b || b.latencies.length === 0) return 0;
    
    return b.latencies.reduce((sum, l) => sum + l, 0) / b.latencies.length;
  }
  
  /**
   * Calculate percentile latency
   */
  private calculatePercentile(bucket: string, percentile: number): number {
    const b = this.latencyBuckets.get(bucket);
    if (!b || b.latencies.length === 0) return 0;
    
    const sorted = [...b.latencies].sort((a, b) => a - b);
    const index = Math.floor((percentile / 100) * sorted.length);
    return sorted[Math.min(index, sorted.length - 1)];
  }
}
