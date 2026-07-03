import { Injectable, Logger } from '@nestjs/common';
import { EmbeddingsService, EmbeddingModelId, EMBEDDING_MODELS } from './embeddings.service';
import { VectorsService, VectorSearchResult, VectorSearchOptions, ModelSearchResult } from './vectors.service';

/**
 * Main search service for semantic code search.
 * Takes natural language queries, generates embeddings,
 * and finds similar code chunks using pgvector.
 */

export interface SearchQuery {
  query: string;
  projectId?: string;
  language?: string;
  chunkType?: string;
  limit?: number;
}

export interface EnsembleSearchQuery extends SearchQuery {
  models?: EmbeddingModelId[];
}

export interface SearchResultChunk {
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
}

export interface SearchResult {
  chunk: SearchResultChunk;
  score: number;           // 0-1, higher = more similar
  distance: number;        // cosine distance (for debugging)
  highlights?: string[];   // keywords found in content
}

export interface SearchResponse {
  query: string;
  results: SearchResult[];
  totalFound: number;
  searchTimeMs: number;
}

export interface EnsembleSearchResult extends SearchResult {
  fusedScore: number;      // RRF fusion score
  modelRanks: Record<string, number>;  // Rank in each model's results
}

export interface EnsembleSearchResponse {
  query: string;
  results: EnsembleSearchResult[];
  totalFound: number;
  searchTimeMs: number;
  fusionMethod: 'rrf';
  modelsUsed: EmbeddingModelId[];
  perModelResults: Record<EmbeddingModelId, SearchResult[]>;
}

@Injectable()
export class SearchService {
  private readonly logger = new Logger(SearchService.name);

  // Keywords that are good indicators of relevance
  private readonly highlightPatterns: RegExp[] = [
    // Security patterns
    /without\s+sharing/gi,
    /with\s+sharing/gi,
    /Schema\.SObjectType/gi,
    /isAccessible\(\)/gi,
    /isCreateable\(\)/gi,
    /isUpdateable\(\)/gi,
    /isDeletable\(\)/gi,
    /stripInaccessible/gi,
    /CRUD/gi,
    /FLS/gi,
    
    // DML patterns
    /\binsert\b/gi,
    /\bupdate\b/gi,
    /\bdelete\b/gi,
    /\bupsert\b/gi,
    
    // Query patterns
    /\[SELECT\s+/gi,
    /Database\./gi,
    
    // Common patterns
    /async\s+/gi,
    /await\s+/gi,
    /@wire\(/gi,
    /@api\s+/gi,
    /LightningElement/gi,
  ];

  // RRF constant (standard value is 60)
  private readonly RRF_K = 60;

  constructor(
    private readonly embeddingsService: EmbeddingsService,
    private readonly vectorsService: VectorsService,
  ) {}

  /**
   * Perform semantic search over code chunks.
   * 
   * @param searchQuery - The search parameters
   * @returns Search response with ranked results
   */
  async search(searchQuery: SearchQuery): Promise<SearchResponse> {
    const startTime = Date.now();
    const { query, projectId, language, chunkType, limit = 10 } = searchQuery;

    this.logger.log(`Searching: "${query}" (project=${projectId || 'all'})`);

    // Generate embedding for the query
    const queryEmbedding = await this.embeddingsService.embed(query);

    // Search pgvector
    const options: VectorSearchOptions = {
      projectId,
      language,
      chunkType,
      limit,
    };

    const vectorResults = await this.vectorsService.searchSimilar(
      queryEmbedding,
      options,
    );

    // Transform results
    const results: SearchResult[] = vectorResults.map((vr) => ({
      chunk: {
        id: vr.id,
        projectId: vr.projectId,
        filePath: vr.filePath,
        lineStart: vr.lineStart,
        lineEnd: vr.lineEnd,
        content: vr.content,
        language: vr.language,
        chunkType: vr.chunkType,
        name: vr.name,
        parentName: vr.parentName,
        dependencies: vr.dependencies,
      },
      score: this.vectorsService.distanceToScore(vr.distance),
      distance: vr.distance,
      highlights: this.extractHighlights(vr.content, query),
    }));

    const searchTimeMs = Date.now() - startTime;

    this.logger.log(
      `Found ${results.length} results in ${searchTimeMs}ms (top score: ${results[0]?.score.toFixed(3) || 'N/A'})`,
    );

    return {
      query,
      results,
      totalFound: results.length,
      searchTimeMs,
    };
  }

  /**
   * Perform ensemble search using multiple embedding models.
   * Uses Reciprocal Rank Fusion (RRF) to combine results.
   */
  async searchEnsemble(searchQuery: EnsembleSearchQuery): Promise<EnsembleSearchResponse> {
    const startTime = Date.now();
    const { query, projectId, language, chunkType, limit = 10, models = ['bge-base', 'nomic'] } = searchQuery;

    this.logger.log(`Ensemble search: "${query}" with models [${models.join(', ')}]`);

    // Generate embeddings for query using all specified models
    const queryEmbeddings = await this.embeddingsService.embedMultiModel(query, models);

    // Search each model's embedding column
    const modelResults = await this.vectorsService.searchEnsemble(queryEmbeddings, {
      projectId,
      language,
      chunkType,
      limit: Math.max(limit * 2, 20), // Fetch more for better fusion
      models,
    });

    // Apply RRF fusion
    const fusedResults = this.applyRRFFusion(modelResults, limit);

    // Build per-model results for response
    const perModelResults: Record<EmbeddingModelId, SearchResult[]> = {} as any;
    for (const { modelId, results } of modelResults) {
      perModelResults[modelId] = results.slice(0, 5).map((vr) => ({
        chunk: this.vectorResultToChunk(vr),
        score: this.vectorsService.distanceToScore(vr.distance),
        distance: vr.distance,
        highlights: this.extractHighlights(vr.content, query),
      }));
    }

    const searchTimeMs = Date.now() - startTime;

    this.logger.log(
      `Ensemble search found ${fusedResults.length} results in ${searchTimeMs}ms (top fused score: ${fusedResults[0]?.fusedScore.toFixed(4) || 'N/A'})`,
    );

    return {
      query,
      results: fusedResults,
      totalFound: fusedResults.length,
      searchTimeMs,
      fusionMethod: 'rrf',
      modelsUsed: models,
      perModelResults,
    };
  }

  /**
   * Apply Reciprocal Rank Fusion (RRF) to combine results from multiple models.
   * RRF score = sum(1 / (k + rank + 1)) across all models
   * 
   * @param modelResults - Results from each model
   * @param limit - Maximum number of results to return
   * @returns Fused and ranked results
   */
  private applyRRFFusion(
    modelResults: ModelSearchResult[],
    limit: number,
  ): EnsembleSearchResult[] {
    // Map chunk ID to aggregated data
    const chunkScores = new Map<string, {
      chunk: VectorSearchResult;
      rrfScore: number;
      modelRanks: Record<string, number>;
      bestDistance: number;
    }>();

    // Process each model's results
    for (const { modelId, results } of modelResults) {
      results.forEach((result, rank) => {
        const chunkId = result.id;
        
        // Calculate RRF contribution from this model
        const rrfContribution = 1 / (this.RRF_K + rank + 1);

        if (chunkScores.has(chunkId)) {
          const existing = chunkScores.get(chunkId)!;
          existing.rrfScore += rrfContribution;
          existing.modelRanks[modelId] = rank + 1;
          existing.bestDistance = Math.min(existing.bestDistance, result.distance);
        } else {
          chunkScores.set(chunkId, {
            chunk: result,
            rrfScore: rrfContribution,
            modelRanks: { [modelId]: rank + 1 },
            bestDistance: result.distance,
          });
        }
      });
    }

    // Sort by RRF score (descending) and take top results
    const sorted = Array.from(chunkScores.values())
      .sort((a, b) => b.rrfScore - a.rrfScore)
      .slice(0, limit);

    // Convert to EnsembleSearchResult format
    return sorted.map((item) => ({
      chunk: this.vectorResultToChunk(item.chunk),
      score: this.vectorsService.distanceToScore(item.bestDistance),
      distance: item.bestDistance,
      fusedScore: item.rrfScore,
      modelRanks: item.modelRanks,
      highlights: this.extractHighlights(item.chunk.content, ''),
    }));
  }

  /**
   * Convert VectorSearchResult to SearchResultChunk
   */
  private vectorResultToChunk(vr: VectorSearchResult): SearchResultChunk {
    return {
      id: vr.id,
      projectId: vr.projectId,
      filePath: vr.filePath,
      lineStart: vr.lineStart,
      lineEnd: vr.lineEnd,
      content: vr.content,
      language: vr.language,
      chunkType: vr.chunkType,
      name: vr.name,
      parentName: vr.parentName,
      dependencies: vr.dependencies,
    };
  }

  /**
   * Find similar code to an existing chunk.
   * Useful for finding duplicate or related code.
   */
  async findSimilar(
    chunkId: string,
    limit: number = 5,
  ): Promise<SearchResult[]> {
    const vectorResults = await this.vectorsService.findSimilarChunks(
      chunkId,
      limit,
    );

    return vectorResults.map((vr) => ({
      chunk: this.vectorResultToChunk(vr),
      score: this.vectorsService.distanceToScore(vr.distance),
      distance: vr.distance,
      highlights: [],
    }));
  }

  /**
   * Get available models for ensemble search
   */
  async getAvailableModels(projectId?: string): Promise<{
    all: EmbeddingModelId[];
    populated: EmbeddingModelId[];
  }> {
    const all = this.embeddingsService.getAvailableModels();
    const populated = await this.vectorsService.getPopulatedModels(projectId);
    return { all, populated };
  }

  /**
   * Extract relevant highlights from code content.
   * Returns matching patterns + query keywords found in the content.
   */
  private extractHighlights(content: string, query: string): string[] {
    const highlights = new Set<string>();

    // Find matching highlight patterns
    for (const pattern of this.highlightPatterns) {
      const matches = content.match(pattern);
      if (matches) {
        matches.forEach((m) => highlights.add(m.trim()));
      }
    }

    // Also check for query keywords in content
    if (query) {
      const queryWords = query
        .toLowerCase()
        .split(/\s+/)
        .filter((w) => w.length > 3); // ignore short words

      for (const word of queryWords) {
        const regex = new RegExp(`\\b${this.escapeRegex(word)}\\w*\\b`, 'gi');
        const matches = content.match(regex);
        if (matches) {
          matches.slice(0, 3).forEach((m) => highlights.add(m)); // max 3 per word
        }
      }
    }

    return Array.from(highlights).slice(0, 10); // max 10 highlights
  }

  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * Example queries for testing/documentation.
   */
  getExampleQueries(): string[] {
    return [
      // Security-focused queries
      'where is CRUD/FLS checked',
      'find classes using without sharing',
      'DML operations without security checks',
      'methods that insert or update records',
      'SOQL injection vulnerabilities',

      // Architecture queries  
      'authentication and authorization logic',
      'error handling patterns',
      'API integration methods',
      'trigger handlers',
      'batch job implementations',

      // LWC queries
      'wire service usage',
      'components with API properties',
      'event handling methods',
      'lightning element extensions',

      // General
      'utility functions',
      'test classes and methods',
      'data access layer',
      'service layer methods',
    ];
  }
}
