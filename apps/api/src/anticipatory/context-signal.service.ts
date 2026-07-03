import { Injectable, Logger, Optional } from '@nestjs/common';
import { EntityService } from '../graph/services/entity.service';
import { ContextSignals } from './strategies/strategy.interface';

/**
 * Context Signal Extractor
 *
 * Extracts signals from a recall query and environment without making
 * database queries (except entity name lookup, which is cached).
 * Target: <10ms total.
 */
@Injectable()
export class ContextSignalService {
  private readonly logger = new Logger(ContextSignalService.name);

  /**
   * Cache of known entity names per user, refreshed periodically.
   * Key: userId, Value: Set of lowercase entity names/aliases.
   */
  private entityNameCache = new Map<
    string,
    { names: Map<string, string>; expiresAt: number }
  >();
  private static readonly CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

  constructor(@Optional() private readonly entityService?: EntityService) {}

  /**
   * Extract context signals from a recall query.
   * Pure computation + optional cached entity lookup. No heavy DB work.
   */
  async extract(
    query: string,
    userId: string,
    excludeMemoryIds: Set<string>,
  ): Promise<ContextSignals> {
    const now = new Date();

    // Detect entities mentioned in the query
    const entities = await this.detectEntities(query, userId);

    // Detect topics from keywords (lightweight, no embedding)
    const topics = this.detectTopics(query);

    return {
      query,
      userId,
      entities,
      topics,
      hourOfDay: now.getHours(),
      dayOfWeek: now.getDay(),
      excludeMemoryIds,
    };
  }

  /**
   * Detect entity names in the query by matching against known entities.
   * Uses a per-user cache to avoid DB lookups on every recall.
   */
  private async detectEntities(
    query: string,
    userId: string,
  ): Promise<string[]> {
    if (!this.entityService) return [];

    const nameMap = await this.getEntityNames(userId);
    if (nameMap.size === 0) return [];

    const queryLower = query.toLowerCase();
    const detected: string[] = [];

    for (const [lowerName, canonicalName] of nameMap) {
      // Word boundary matching to avoid false positives
      // e.g., "ram" shouldn't match in "program"
      const regex = new RegExp(`\\b${escapeRegExp(lowerName)}\\b`, 'i');
      if (regex.test(queryLower)) {
        detected.push(canonicalName);
      }
    }

    return detected;
  }

  /**
   * Get cached entity names for a user, refreshing if stale.
   */
  private async getEntityNames(userId: string): Promise<Map<string, string>> {
    const cached = this.entityNameCache.get(userId);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.names;
    }

    try {
      const { entities } = await this.entityService!.list({
        userId,
        limit: 200,
        offset: 0,
      });

      const names = new Map<string, string>();
      for (const entity of entities) {
        // Map lowercase name → canonical name
        names.set(entity.name.toLowerCase(), entity.name);
        // Also map aliases
        for (const alias of entity.aliases || []) {
          names.set(alias.toLowerCase(), entity.name);
        }
      }

      this.entityNameCache.set(userId, {
        names,
        expiresAt: Date.now() + ContextSignalService.CACHE_TTL_MS,
      });

      this.logger.log(`Loaded ${names.size} entity names for user ${userId}`);
      return names;
    } catch (err) {
      this.logger.warn(
        `Failed to load entity names for user ${userId}: ${(err as Error).message}`,
      );
      return new Map();
    }
  }

  /**
   * Lightweight keyword-based topic detection.
   * Mirrors the prefetch TopicDetectionService keyword layer but stripped
   * down for speed — no embedding classification.
   */
  private detectTopics(query: string): string[] {
    const lower = query.toLowerCase();
    const topics: string[] = [];

    // Simplified topic rules — main categories only
    const rules: Array<{ topic: string; patterns: RegExp[] }> = [
      {
        topic: 'family',
        patterns: [
          /\bfamily\b/,
          /\bwife\b/,
          /\bhusband\b/,
          /\bkids?\b/,
          /\bchildren\b/,
          /\bson\b/,
          /\bdaughter\b/,
          /\bpet\b/,
          /\bdog\b/,
        ],
      },
      {
        topic: 'health',
        patterns: [
          /\bhealth\b/,
          /\bmedic\w*\b/,
          /\bdoctor\b/,
          /\bsick\b/,
          /\bmeds?\b/,
          /\bprescription\b/,
        ],
      },
      {
        topic: 'projects',
        patterns: [
          /\bproject\b/,
          /\bfeature\b/,
          /\bbuild\b/,
          /\bship\b/,
          /\bdeploy\b/,
          /\brelease\b/,
          /\blaunch\b/,
        ],
      },
      {
        topic: 'technical',
        patterns: [
          /\bdatabase\b/,
          /\bapi\b/,
          /\bbug\b/,
          /\berror\b/,
          /\bcode\b/,
          /\bmigrat\w*\b/,
          /\bserver\b/,
          /\binfra\w*\b/,
        ],
      },
      {
        topic: 'schedule',
        patterns: [
          /\bmeeting\b/,
          /\bcalendar\b/,
          /\bschedule\b/,
          /\bdeadline\b/,
          /\btomorrow\b/,
          /\btoday\b/,
        ],
      },
      {
        topic: 'work',
        patterns: [
          /\bjob\b/,
          /\bclient\b/,
          /\bfreelance\b/,
          /\bcontract\b/,
          /\binvoice\b/,
        ],
      },
    ];

    for (const rule of rules) {
      if (rule.patterns.some((p) => p.test(lower))) {
        topics.push(rule.topic);
      }
    }

    return topics;
  }

  /**
   * Clear the entity name cache (e.g., after graph mutations).
   */
  clearCache(userId?: string): void {
    if (userId) {
      this.entityNameCache.delete(userId);
    } else {
      this.entityNameCache.clear();
    }
  }
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
