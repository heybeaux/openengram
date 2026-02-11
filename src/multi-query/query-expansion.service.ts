import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LLMService } from '../llm/llm.service';
import {
  SYNONYM_GROUPS,
  RELATED_CONCEPTS,
  DEFAULT_PERSON_EXPANSIONS,
  PATTERN_RULES,
  deduplicateSimilarQueries,
} from './expansion-rules';
import { ExpansionStrategy } from './dto/multi-query.dto';

/**
 * Query expansion result with metadata
 */
export interface QueryExpansionResult {
  original: string;
  variants: string[];
  sources: Record<string, 'original' | 'rules' | 'llm'>;
  timings: {
    rulesMs: number;
    llmMs: number;
    totalMs: number;
  };
  llmUsed: boolean;
}

/**
 * Configuration for query expansion
 */
export interface ExpansionConfig {
  strategy: ExpansionStrategy;
  maxVariants: number;
  llm: {
    enabled: boolean;
    fallbackOnly: boolean;
    timeoutMs: number;
    temperature?: number;
  };
  rules: {
    enabled: boolean;
    useSynonyms: boolean;
    usePatterns: boolean;
    useRelatedConcepts: boolean;
  };
}

const DEFAULT_CONFIG: ExpansionConfig = {
  strategy: ExpansionStrategy.HYBRID,
  maxVariants: 7,
  llm: {
    enabled: true,
    fallbackOnly: true,
    timeoutMs: 2000,
    temperature: 0.8,
  },
  rules: {
    enabled: true,
    useSynonyms: true,
    usePatterns: true,
    useRelatedConcepts: true,
  },
};

/**
 * Query Expansion Service
 *
 * Generates semantic variants of a search query using:
 * - Rule-based expansion (synonyms, patterns, related concepts)
 * - Optional LLM-powered expansion for creative variants
 */
@Injectable()
export class QueryExpansionService {
  // Person-specific expansions (can be populated dynamically)
  private personExpansions: Map<string, string[]> = new Map();

  constructor(
    private config: ConfigService,
    private llm: LLMService,
  ) {
    // Initialize with default person expansions
    for (const [name, expansions] of Object.entries(
      DEFAULT_PERSON_EXPANSIONS,
    )) {
      this.personExpansions.set(name.toLowerCase(), expansions);
    }
  }

  /**
   * Register custom person expansions (e.g., from entity service)
   */
  registerPersonExpansions(name: string, expansions: string[]): void {
    this.personExpansions.set(name.toLowerCase(), expansions);
  }

  /**
   * Expand a query into semantic variants
   */
  async expand(
    query: string,
    config: Partial<ExpansionConfig> = {},
  ): Promise<QueryExpansionResult> {
    const finalConfig = this.mergeConfig(config);
    const startTime = Date.now();
    const timings = { rulesMs: 0, llmMs: 0, totalMs: 0 };

    const variants: string[] = [query]; // Always include original
    const sources: Record<string, 'original' | 'rules' | 'llm'> = {
      [query]: 'original',
    };
    let llmUsed = false;

    // 1. Rule-based expansion
    if (
      finalConfig.rules.enabled &&
      finalConfig.strategy !== ExpansionStrategy.LLM
    ) {
      const rulesStart = Date.now();
      const ruleVariants = this.expandWithRules(query, finalConfig);
      timings.rulesMs = Date.now() - rulesStart;

      for (const v of ruleVariants) {
        if (
          !variants.includes(v) &&
          variants.length < finalConfig.maxVariants
        ) {
          variants.push(v);
          sources[v] = 'rules';
        }
      }
    }

    // 2. LLM expansion (if enabled and strategy requires it)
    const shouldUseLLM =
      finalConfig.llm.enabled &&
      (finalConfig.strategy === ExpansionStrategy.LLM ||
        (finalConfig.strategy === ExpansionStrategy.HYBRID &&
          (!finalConfig.llm.fallbackOnly || variants.length < 4)));

    if (shouldUseLLM && variants.length < finalConfig.maxVariants) {
      const llmStart = Date.now();
      try {
        const llmVariants = await this.expandWithLLM(query, finalConfig);
        timings.llmMs = Date.now() - llmStart;
        llmUsed = true;

        for (const v of llmVariants) {
          if (
            !variants.includes(v) &&
            variants.length < finalConfig.maxVariants
          ) {
            variants.push(v);
            sources[v] = 'llm';
          }
        }
      } catch (error) {
        console.warn(
          '[QueryExpansion] LLM expansion failed, using rules only:',
          error instanceof Error ? error.message : 'Unknown error',
        );
        timings.llmMs = Date.now() - llmStart;
      }
    }

    // 3. Deduplicate similar variants
    const deduplicatedVariants = deduplicateSimilarQueries(variants);

    // Rebuild sources for deduplicated variants
    const finalSources: Record<string, 'original' | 'rules' | 'llm'> = {};
    for (const v of deduplicatedVariants) {
      finalSources[v] = sources[v] || 'rules';
    }

    timings.totalMs = Date.now() - startTime;

    return {
      original: query,
      variants: deduplicatedVariants,
      sources: finalSources,
      timings,
      llmUsed,
    };
  }

  /**
   * Rule-based query expansion
   */
  expandWithRules(query: string, config: ExpansionConfig): string[] {
    const variants: Set<string> = new Set();

    // 1. Apply pattern rules
    if (config.rules.usePatterns) {
      for (const rule of PATTERN_RULES) {
        const match = query.match(rule.pattern);
        if (match) {
          const patternVariants = rule.transform(match, query);
          patternVariants.forEach((v) => variants.add(v));
        }
      }
    }

    // 2. Apply synonym substitution
    if (config.rules.useSynonyms) {
      const words = query.toLowerCase().split(/\s+/);
      for (const word of words) {
        const synonyms = SYNONYM_GROUPS[word];
        if (synonyms) {
          // Add up to 2 synonym variants per word
          for (const synonym of synonyms.slice(0, 2)) {
            const variant = query.replace(
              new RegExp(`\\b${word}\\b`, 'gi'),
              synonym,
            );
            variants.add(variant);
          }
        }
      }
    }

    // 3. Apply related concept expansion
    if (config.rules.useRelatedConcepts) {
      const words = query.toLowerCase().split(/\s+/);
      for (const word of words) {
        const related = RELATED_CONCEPTS[word];
        if (related) {
          // Add related concept queries
          for (const concept of related.slice(0, 2)) {
            variants.add(`${query} ${concept}`);
          }
        }
      }
    }

    // 4. Apply person expansions
    for (const [name, expansions] of this.personExpansions) {
      if (query.toLowerCase().includes(name)) {
        for (const expansion of expansions.slice(0, 1)) {
          variants.add(query.replace(new RegExp(name, 'gi'), expansion));
        }
      }
    }

    return Array.from(variants);
  }

  /**
   * LLM-powered query expansion
   */
  async expandWithLLM(
    query: string,
    config: ExpansionConfig,
  ): Promise<string[]> {
    const numVariants = Math.min(config.maxVariants - 1, 6); // Leave room for original

    const systemPrompt = `You are a semantic search query expansion assistant. Generate alternative search queries that would help find relevant memories in a personal memory system.

Rules:
1. Generate ${numVariants} semantic variants of the input query
2. Use synonyms, related concepts, and reformulations
3. Include one inverse/negative query when appropriate (e.g., "dislikes" for "likes")
4. Keep queries concise (3-10 words each)
5. Maintain the original intent while exploring different angles
6. Output ONLY a JSON array of strings, no other text

Do not include explanations, just the JSON array.`;

    const userPrompt = `Generate ${numVariants} search query variants for:
"${query}"

Example format:
["variant 1", "variant 2", "variant 3"]`;

    // Use timeout wrapper
    const timeoutPromise = new Promise<string[]>((_, reject) => {
      setTimeout(() => reject(new Error('LLM timeout')), config.llm.timeoutMs);
    });

    const llmPromise = this.llm.json<string[]>(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      undefined,
      { temperature: config.llm.temperature },
    );

    const variants = await Promise.race([llmPromise, timeoutPromise]);

    // Validate response is an array of strings
    if (
      Array.isArray(variants) &&
      variants.every((v) => typeof v === 'string')
    ) {
      return variants.filter((v) => v.length > 0 && v.length < 100);
    }

    console.warn(
      '[QueryExpansion] LLM returned invalid format:',
      typeof variants,
    );
    return [];
  }

  /**
   * Merge user config with defaults
   */
  private mergeConfig(config: Partial<ExpansionConfig>): ExpansionConfig {
    return {
      strategy: config.strategy ?? DEFAULT_CONFIG.strategy,
      maxVariants: config.maxVariants ?? DEFAULT_CONFIG.maxVariants,
      llm: {
        ...DEFAULT_CONFIG.llm,
        ...config.llm,
      },
      rules: {
        ...DEFAULT_CONFIG.rules,
        ...config.rules,
      },
    };
  }
}
