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
  Req,
  Res,
  HttpCode,
  HttpStatus,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  MemoryService,
  MemoryWithExtraction,
  QueryResult,
  ContextResult,
} from './memory.service';
import {
  BackfillService,
  BackfillResult,
  UserIdentityBackfillResult,
} from './backfill.service';
import {
  ConsolidationService,
  ConsolidationResult,
} from './consolidation.service';
import { CreateMemoryDto, CreateMemoryBatchDto } from './dto/create-memory.dto';
import {
  ExportQueryDto,
  ImportMemoriesDto,
  ImportResult,
} from './dto/export-import.dto';
import { QueryMemoryDto, LoadContextDto } from './dto/query-memory.dto';
import { UpdateMemoryDto } from './dto/update-memory.dto';
import { ContextualRecallService } from './contextual-recall.service';
import {
  ContextualRecallDto,
  ContextualRecallResponseDto,
} from './dto/contextual-recall.dto';
import { ApiKeyOrJwtGuard } from '../common/guards/api-key-or-jwt.guard';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { UserId } from '../common/decorators/user-id.decorator';
import { RateLimitGuard } from '../rate-limit/rate-limit.guard';
import { RateLimit } from '../rate-limit/rate-limit.decorator';
import { SanitizeInterceptor } from '../common/interceptors/sanitize.interceptor';
import { AdminGuard } from '../common/guards/admin.guard';
import { PrismaService } from '../prisma/prisma.service';

@ApiTags('memories')
@Controller('v1')
@UseGuards(ApiKeyOrJwtGuard, RateLimitGuard)
@UseInterceptors(SanitizeInterceptor)
export class MemoryController {
  constructor(
    private readonly memoryService: MemoryService,
    private readonly backfillService: BackfillService,
    private readonly consolidationService: ConsolidationService,
    private readonly contextualRecallService: ContextualRecallService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Resolve user IDs for account-wide search when using instance keys.
   * If agentId is provided, scopes to that agent's users only.
   */
  private async resolveAccountUserIds(
    req: any,
    agentId?: string,
  ): Promise<string[] | null> {
    if (!req.accountId) return null;

    const where: any = {};
    if (agentId) {
      where.agentId = agentId;
    } else {
      where.agent = { accountId: req.accountId, deletedAt: null };
    }

    const users = await this.prisma.user.findMany({
      where,
      select: { id: true },
    });
    return users.map((u) => u.id);
  }

  // =========================================================================
  // MEMORY CRUD
  // =========================================================================

  /**
   * POST /v1/memories
   * Create a single memory
   */
  @Post('memories')
  @ApiOperation({
    summary: 'Create a memory',
    description:
      'Store a single memory with automatic extraction and embedding.',
  })
  @ApiResponse({ status: 201, description: 'Memory created successfully.' })
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
  @ApiOperation({
    summary: 'Create memories in batch',
    description:
      'Import multiple memories at once (e.g., conversation history).',
  })
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
  @ApiOperation({
    summary: 'Search memories',
    description:
      'Semantic search across memories using natural language queries.',
  })
  @ApiTags('search')
  @RateLimit(60)
  async recall(
    @UserId() userId: string,
    @Body() dto: QueryMemoryDto,
    @Req() req: any,
    @Query('agentId') agentId?: string,
  ): Promise<QueryResult> {
    const accountUserIds = await this.resolveAccountUserIds(req, agentId);
    return this.memoryService.recall(accountUserIds || userId, dto);
  }

  /**
   * POST /v1/memories/search
   * Alias for /v1/memories/query
   */
  @Post('memories/search')
  @ApiOperation({ summary: 'Search memories (alias for /query)' })
  @ApiTags('search')
  @RateLimit(60)
  async search(
    @UserId() userId: string,
    @Body() dto: QueryMemoryDto,
    @Req() req: any,
    @Query('agentId') agentId?: string,
  ): Promise<QueryResult> {
    const accountUserIds = await this.resolveAccountUserIds(req, agentId);
    return this.memoryService.recall(accountUserIds || userId, dto);
  }

  /**
   * GET /v1/memories/search
   * GET alias for search
   */
  @Get('memories/search')
  @ApiOperation({ summary: 'Search memories (GET alias)' })
  @ApiTags('search')
  @RateLimit(60)
  async searchGet(
    @UserId() userId: string,
    @Query() dto: QueryMemoryDto,
    @Req() req: any,
    @Query('agentId') agentId?: string,
  ): Promise<QueryResult> {
    const accountUserIds = await this.resolveAccountUserIds(req, agentId);
    return this.memoryService.recall(accountUserIds || userId, dto);
  }

  /**
   * POST /v1/recall
   * Alias for /v1/memories/query — semantic search for memories
   */
  @Post('recall')
  @ApiOperation({ summary: 'Recall memories (alias for /memories/query)' })
  @ApiTags('search')
  @RateLimit(60)
  async recallAlias(
    @UserId() userId: string,
    @Body() dto: QueryMemoryDto,
    @Req() req: any,
    @Query('agentId') agentId?: string,
  ): Promise<QueryResult> {
    const accountUserIds = await this.resolveAccountUserIds(req, agentId);
    return this.memoryService.recall(accountUserIds || userId, dto);
  }

  /**
   * POST /v1/recall/contextual
   * Mid-conversation contextual recall with topic shift detection.
   * Returns relevant memories only when a topic shift is detected.
   */
  @Post('recall/contextual')
  async contextualRecall(
    @UserId() userId: string,
    @Body() dto: ContextualRecallDto,
    @Req() req: any,
    @Query('agentId') agentId?: string,
  ): Promise<ContextualRecallResponseDto> {
    const accountUserIds = await this.resolveAccountUserIds(req, agentId);
    return this.contextualRecallService.recall(accountUserIds || userId, dto);
  }

  // =========================================================================
  // EXPORT / IMPORT (HEY-55)
  // =========================================================================

  /**
   * GET /v1/memories
   * List memories with pagination and optional filters
   */
  @Get('memories')
  @ApiOperation({
    summary: 'List memories',
    description:
      'List memories with pagination, ordered by newest first. Supports layer and userId filters.',
  })
  async listMemories(
    @Req() req: any,
    @UserId() userId: string,
    @Query('limit') limitStr?: string,
    @Query('offset') offsetStr?: string,
    @Query('layer') layer?: string,
    @Query('userId') filterUserId?: string,
  ): Promise<{
    memories: any[];
    total: number;
    limit: number;
    offset: number;
  }> {
    const limit = Math.min(
      Math.max(parseInt(limitStr || '25', 10) || 25, 1),
      100,
    );
    const offset = Math.max(parseInt(offsetStr || '0', 10) || 0, 0);

    const accountUserIds = await this.resolveAccountUserIds(req);
    const userIds = accountUserIds || [userId];

    const where: any = {
      deletedAt: null,
      userId:
        filterUserId && userIds.includes(filterUserId)
          ? filterUserId
          : { in: userIds },
    };

    if (layer) {
      where.layer = layer;
    }

    const [memories, total] = await Promise.all([
      this.prisma.memory.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: offset,
        take: limit,
        include: { extraction: true },
      }),
      this.prisma.memory.count({ where }),
    ]);

    return { memories, total, limit, offset };
  }

  /**
   * GET /v1/users
   * List all users under the authenticated account
   */
  @Get('users')
  @ApiOperation({
    summary: 'List users',
    description: 'List all users under the authenticated account.',
  })
  async listUsers(
    @Req() req: any,
    @UserId() userId: string,
  ): Promise<{
    users: Array<{
      id: string;
      externalId: string;
      displayName: string | null;
      agentId: string;
      createdAt: Date;
    }>;
  }> {
    const accountUserIds = await this.resolveAccountUserIds(req);

    const where: any = {
      deletedAt: null,
    };

    if (accountUserIds) {
      where.id = { in: accountUserIds };
    } else {
      where.id = userId;
    }

    const users = await this.prisma.user.findMany({
      where,
      select: {
        id: true,
        externalId: true,
        displayName: true,
        agentId: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    return { users };
  }

  /**
   * GET /v1/memories/export
   * Export all user memories as JSON or NDJSON for migration.
   */
  @Get('memories/export')
  @RateLimit(5)
  @ApiOperation({
    summary: 'Export all memories',
    description:
      'Export all memories as a downloadable JSON or NDJSON file for migration.',
  })
  async exportMemories(
    @UserId() userId: string,
    @Query() query: ExportQueryDto,
    @Res() res: Response,
  ): Promise<void> {
    const memories = await this.memoryService.exportMemories(userId);
    const format = query.format || 'json';
    const date = new Date().toISOString().split('T')[0];
    const ext = format === 'ndjson' ? 'ndjson' : 'json';

    res.setHeader(
      'Content-Disposition',
      `attachment; filename="engram-export-${date}.${ext}"`,
    );

    if (format === 'ndjson') {
      res.setHeader('Content-Type', 'application/x-ndjson');
      for (const memory of memories) {
        res.write(JSON.stringify(memory) + '\n');
      }
      res.end();
    } else {
      res.setHeader('Content-Type', 'application/json');
      res.json(memories);
    }
  }

  /**
   * POST /v1/memories/import
   * Import memories with dedup and plan limit enforcement.
   */
  @Post('memories/import')
  @ApiOperation({
    summary: 'Import memories',
    description:
      'Import memories from an export file. Deduplicates and respects plan limits.',
  })
  async importMemories(
    @UserId() userId: string,
    @Body() dto: ImportMemoriesDto,
  ): Promise<ImportResult> {
    return this.memoryService.importMemories(userId, dto.memories);
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
    @Query('includeAgent') includeAgent?: string,
  ): Promise<{
    nodes: any[];
    edges: any[];
    entities: any[];
    stats?: { human: number; agent: number };
  }> {
    return this.memoryService.getGraphData(
      userId,
      limit ? parseInt(limit, 10) : 500,
      includeAgent === 'true',
    );
  }

  /**
   * GET /v1/memories/:id
   * Get a single memory by ID
   */
  @Get('memories/:id')
  @ApiOperation({ summary: 'Get a memory by ID' })
  async getMemory(
    @UserId() userId: string,
    @Param('id') id: string,
  ): Promise<MemoryWithExtraction | null> {
    return this.memoryService.getById(id, userId);
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
  @ApiOperation({
    summary: 'Update a memory',
    description:
      'Edit content, layer, importance, or extraction fields. Triggers re-embedding if content changes.',
  })
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
  @ApiOperation({
    summary: 'Delete a memory',
    description: 'Soft-delete a memory by ID.',
  })
  @ApiResponse({ status: 204, description: 'Memory deleted.' })
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteMemory(
    @UserId() userId: string,
    @Param('id') id: string,
  ): Promise<void> {
    return this.memoryService.delete(id, userId);
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
  async markUsed(
    @UserId() userId: string,
    @Param('id') id: string,
  ): Promise<void> {
    return this.memoryService.markUsed(id, userId);
  }

  /**
   * POST /v1/memories/:id/helpful
   * Mark a memory as helpful (explicit feedback)
   */
  @Post('memories/:id/helpful')
  @HttpCode(HttpStatus.NO_CONTENT)
  async markHelpful(
    @UserId() userId: string,
    @Param('id') id: string,
  ): Promise<void> {
    // TODO: Implement feedback service
    return;
  }

  /**
  // NOTE: POST /v1/memories/:id/correct moved to CorrectionController

  // =========================================================================
  // CONTEXT
  // =========================================================================

  /**
   * POST /v1/context
   * Load context for session start
   */
  @Post('context')
  @ApiOperation({
    summary: 'Load context',
    description: 'Load relevant context for an agent session bootstrap.',
  })
  @ApiTags('context')
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
  @UseGuards(AdminGuard)
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
  @UseGuards(AdminGuard)
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
  @UseGuards(AdminGuard)
  async backfillUserIdentity(
    @Body()
    body: {
      userId: string;
      actualName: string;
      dryRun?: boolean;
      batchSize?: number;
    },
  ): Promise<UserIdentityBackfillResult> {
    const { userId, actualName, dryRun = false, batchSize = 1000 } = body;
    return this.backfillService.backfillUserIdentity(userId, actualName, {
      dryRun,
      batchSize,
    });
  }

  /**
   * GET /v1/backfill/user-identity/lookup
   * Find users by externalId pattern (e.g., 'beaux')
   */
  @Get('backfill/user-identity/lookup')
  @UseGuards(AdminGuard)
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
      similarityThreshold: similarityThreshold
        ? parseFloat(similarityThreshold)
        : undefined,
    });
  }

  /**
   * GET /v1/consolidate/stats
   * Get consolidation statistics for the current user.
   */
  @Get('consolidate/stats')
  async getConsolidationStats(@UserId() userId: string): Promise<{
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
