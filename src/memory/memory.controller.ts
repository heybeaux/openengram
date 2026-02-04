import {
  Controller,
  Post,
  Get,
  Patch,
  Delete,
  Body,
  Param,
  Headers,
  Query,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { MemoryService, MemoryWithExtraction, QueryResult, ContextResult } from './memory.service';
import { BackfillService, BackfillResult, UserIdentityBackfillResult } from './backfill.service';
import { ConsolidationService, ConsolidationResult } from './consolidation.service';
import { CreateMemoryDto, CreateMemoryBatchDto } from './dto/create-memory.dto';
import { QueryMemoryDto, LoadContextDto } from './dto/query-memory.dto';
import { UpdateMemoryDto, CorrectMemoryDto } from './dto/update-memory.dto';
import { ApiKeyGuard } from '../common/guards/api-key.guard';
import { UserId } from '../common/decorators/user-id.decorator';

@Controller('v1')
@UseGuards(ApiKeyGuard)
export class MemoryController {
  constructor(
    private readonly memoryService: MemoryService,
    private readonly backfillService: BackfillService,
    private readonly consolidationService: ConsolidationService,
  ) {}

  // =========================================================================
  // MEMORY CRUD
  // =========================================================================

  /**
   * POST /v1/memories
   * Create a single memory
   */
  @Post('memories')
  async remember(
    @UserId() userId: string,
    @Body() dto: CreateMemoryDto,
  ): Promise<MemoryWithExtraction> {
    return this.memoryService.remember(userId, dto);
  }

  /**
   * POST /v1/memories/batch
   * Create multiple memories (for conversation import)
   */
  @Post('memories/batch')
  async rememberAll(
    @UserId() userId: string,
    @Body() dto: CreateMemoryBatchDto,
  ): Promise<{ created: number; failed: number }> {
    return this.memoryService.rememberAll(userId, dto);
  }

  /**
   * POST /v1/memories/query
   * Semantic search for memories
   */
  @Post('memories/query')
  async recall(
    @UserId() userId: string,
    @Body() dto: QueryMemoryDto,
  ): Promise<QueryResult> {
    return this.memoryService.recall(userId, dto);
  }

  /**
   * GET /v1/memories/graph
   * Get memory graph data for visualization
   * NOTE: Must be defined before /memories/:id to avoid route collision
   */
  @Get('memories/graph')
  async getGraph(
    @UserId() userId: string,
    @Query('limit') limit?: string,
  ): Promise<{
    nodes: any[];
    edges: any[];
    entities: any[];
  }> {
    return this.memoryService.getGraphData(userId, limit ? parseInt(limit, 10) : 500);
  }

  /**
   * GET /v1/memories/:id
   * Get a single memory by ID
   */
  @Get('memories/:id')
  async getMemory(
    @Param('id') id: string,
  ): Promise<MemoryWithExtraction | null> {
    return this.memoryService.getById(id);
  }

  /**
   * PATCH /v1/memories/:id
   * Update an existing memory
   * 
   * P5-001: Memory Correction API
   * 
   * Allows direct editing of:
   * - raw: Memory content (triggers re-embedding)
   * - layer: IDENTITY, PROJECT, SESSION, TASK
   * - importance: Hint or explicit score
   * - extraction: 5W1H fields (who, what, when, where, why, how, topics)
   * 
   * Use this for typo fixes, layer promotions, or extraction corrections.
   * For factual corrections that should preserve history, use POST /:id/correct instead.
   */
  @Patch('memories/:id')
  async updateMemory(
    @UserId() userId: string,
    @Param('id') id: string,
    @Body() dto: UpdateMemoryDto,
  ): Promise<MemoryWithExtraction> {
    return this.memoryService.update(userId, id, dto);
  }

  /**
   * DELETE /v1/memories/:id
   * Soft delete a memory
   */
  @Delete('memories/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteMemory(@Param('id') id: string): Promise<void> {
    return this.memoryService.delete(id);
  }

  // =========================================================================
  // FEEDBACK
  // =========================================================================

  /**
   * POST /v1/memories/:id/used
   * Mark a memory as used (implicit feedback)
   */
  @Post('memories/:id/used')
  @HttpCode(HttpStatus.NO_CONTENT)
  async markUsed(@Param('id') id: string): Promise<void> {
    return this.memoryService.markUsed(id);
  }

  /**
   * POST /v1/memories/:id/helpful
   * Mark a memory as helpful (explicit feedback)
   */
  @Post('memories/:id/helpful')
  @HttpCode(HttpStatus.NO_CONTENT)
  async markHelpful(@Param('id') id: string): Promise<void> {
    // TODO: Implement feedback service
    return;
  }

  /**
   * POST /v1/memories/:id/correct
   * Correct a memory with contradiction tracking
   * 
   * P5-001: Memory Correction API
   * 
   * Creates a new "correction" memory that supersedes the original:
   * 1. Original memory is marked as superseded (preserved for history)
   * 2. New correction memory is created with CORRECTION source
   * 3. CONTRADICTS link is created between them
   * 
   * Use this when a memory contains incorrect information.
   * For simple typo fixes, use PATCH /:id instead.
   * 
   * @param correctedContent - The corrected content for the new memory
   * @param reason - Optional explanation of why this correction was made
   * @param layer - Optional override for the correction's layer
   * @param importanceHint - Optional override for the correction's importance
   */
  @Post('memories/:id/correct')
  async correct(
    @UserId() userId: string,
    @Param('id') id: string,
    @Body() dto: CorrectMemoryDto,
  ): Promise<MemoryWithExtraction> {
    return this.memoryService.correctMemory(userId, id, dto);
  }

  // =========================================================================
  // CONTEXT
  // =========================================================================

  /**
   * POST /v1/context
   * Load context for session start
   */
  @Post('context')
  async loadContext(
    @UserId() userId: string,
    @Body() dto: LoadContextDto,
  ): Promise<ContextResult> {
    return this.memoryService.loadContext(userId, dto);
  }

  // =========================================================================
  // BACKFILL (Admin)
  // =========================================================================

  /**
   * GET /v1/memories/backfill/status
   * Check how many memories need backfill
   */
  @Get('memories/backfill/status')
  async getBackfillStatus(): Promise<{ needsBackfill: number }> {
    const memories = await this.backfillService.findMemoriesNeedingBackfill();
    return { needsBackfill: memories.length };
  }

  /**
   * POST /v1/memories/backfill
   * Run backfill on memories with empty extraction data
   * @param dryRun - If 'true', only report what would be done
   * @param batchSize - Number of memories to process (default 50)
   */
  @Post('memories/backfill')
  async runBackfill(
    @Query('dryRun') dryRun?: string,
    @Query('batchSize') batchSize?: string,
  ): Promise<BackfillResult> {
    return this.backfillService.backfillExtractions({
      dryRun: dryRun === 'true',
      batchSize: batchSize ? parseInt(batchSize, 10) : 50,
      delayMs: 500, // 500ms delay between extractions to avoid rate limits
    });
  }

  /**
   * POST /v1/backfill/user-identity
   * Replace generic user references (user_xxx, User, the user) with actual name.
   * 
   * P5-002: User Identity Backfill
   * 
   * @param userId - The user's internal ID
   * @param actualName - The actual name to replace generic references with
   * @param dryRun - If 'true', only report what would be done
   * @param batchSize - Number of memories to process (default 1000)
   */
  @Post('backfill/user-identity')
  async backfillUserIdentity(
    @Body() body: { userId: string; actualName: string; dryRun?: boolean; batchSize?: number },
  ): Promise<UserIdentityBackfillResult> {
    const { userId, actualName, dryRun = false, batchSize = 1000 } = body;
    return this.backfillService.backfillUserIdentity(userId, actualName, { dryRun, batchSize });
  }

  /**
   * GET /v1/backfill/user-identity/lookup
   * Find users by externalId pattern (e.g., 'beaux')
   */
  @Get('backfill/user-identity/lookup')
  async lookupUserForBackfill(
    @Query('pattern') pattern: string,
  ): Promise<Array<{ id: string; externalId: string }>> {
    if (!pattern) {
      return [];
    }
    return this.backfillService.findUserByExternalIdPattern(pattern);
  }

  // =========================================================================
  // CONSOLIDATION (P5-003)
  // =========================================================================

  /**
   * POST /v1/consolidate
   * Trigger memory consolidation - promotes recurring SESSION patterns to IDENTITY.
   * 
   * P5-003: Intelligent Layer Classification - Consolidation Endpoint
   * 
   * This finds SESSION memories with 3+ similar occurrences and:
   * - Promotes the canonical (most complete) version to IDENTITY layer
   * - Soft-deletes duplicates with consolidatedInto reference
   * 
   * @param dryRun - If 'true', only report what would be done
   * @param minOccurrences - Minimum similar memories to trigger promotion (default 3)
   * @param similarityThreshold - Similarity threshold for clustering (default 0.85)
   */
  @Post('consolidate')
  async consolidate(
    @UserId() userId: string,
    @Query('dryRun') dryRun?: string,
    @Query('minOccurrences') minOccurrences?: string,
    @Query('similarityThreshold') similarityThreshold?: string,
  ): Promise<ConsolidationResult> {
    return this.consolidationService.promoteRecurringPatterns(userId, {
      dryRun: dryRun === 'true',
      minOccurrences: minOccurrences ? parseInt(minOccurrences, 10) : undefined,
      similarityThreshold: similarityThreshold ? parseFloat(similarityThreshold) : undefined,
    });
  }

  /**
   * GET /v1/consolidate/stats
   * Get consolidation statistics for the current user.
   */
  @Get('consolidate/stats')
  async getConsolidationStats(
    @UserId() userId: string,
  ): Promise<{
    totalMemories: number;
    sessionMemories: number;
    identityMemories: number;
    projectMemories: number;
    consolidatedCount: number;
    potentialClusters: number;
  }> {
    return this.consolidationService.getStats(userId);
  }
}
