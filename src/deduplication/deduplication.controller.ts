import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  HttpException,
  HttpStatus,
  Headers,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery, ApiHeader } from '@nestjs/swagger';
import { DeduplicationService } from './deduplication.service';
import { ReviewService } from './review.service';
import { LineageService } from './lineage.service';
import {
  TriggerScanDto,
  ScanResponseDto,
  ListCandidatesQueryDto,
  ListCandidatesResponseDto,
  ApproveRequestDto,
  ApproveResponseDto,
  RejectRequestDto,
  RejectResponseDto,
  ManualMergeDto,
  MergeResponseDto,
  RollbackResponseDto,
  UpdateConfigDto,
  ConfigResponseDto,
  StatsResponseDto,
  SimilarMemoryDto,
  MergeEventDto,
} from './dto/deduplication.dto';

/**
 * Deduplication Controller
 *
 * API endpoints for memory deduplication:
 * - Batch scanning and incremental dedup
 * - Review queue management
 * - Manual merge operations
 * - Configuration and statistics
 */
@ApiTags('deduplication')
@Controller('v1/dedup')
export class DeduplicationController {
  constructor(
    private dedupService: DeduplicationService,
    private reviewService: ReviewService,
    private lineageService: LineageService,
  ) {}

  // ==========================================================================
  // Scan & Batch Operations
  // ==========================================================================

  /**
   * Trigger a batch deduplication scan
   */
  @Post('scan')
  @ApiOperation({ summary: 'Trigger batch deduplication scan' })
  @ApiHeader({ name: 'x-user-id', required: true, description: 'User ID' })
  @ApiResponse({ status: 200, type: ScanResponseDto })
  @ApiResponse({ status: 400, description: 'Deduplication disabled or job already running' })
  async scan(
    @Headers('x-user-id') userId: string,
    @Body() dto: TriggerScanDto,
  ): Promise<ScanResponseDto> {
    if (!userId) {
      throw new HttpException('x-user-id header required', HttpStatus.BAD_REQUEST);
    }

    try {
      return await this.dedupService.runBatchDedup(dto.userId || userId, {
        dryRun: dto.dryRun,
        minSimilarity: dto.minSimilarity,
        maxMemories: dto.maxMemories,
      });
    } catch (error) {
      throw new HttpException(
        error instanceof Error ? error.message : 'Failed to run batch dedup',
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  /**
   * Get batch job status
   */
  @Get('scan/:scanId')
  @ApiOperation({ summary: 'Get batch scan status' })
  @ApiResponse({ status: 200, type: ScanResponseDto })
  @ApiResponse({ status: 404, description: 'Scan not found' })
  getScanStatus(@Param('scanId') scanId: string): ScanResponseDto {
    const job = this.dedupService.getJobStatus(scanId);
    if (!job) {
      throw new HttpException(`Scan not found: ${scanId}`, HttpStatus.NOT_FOUND);
    }

    return {
      scanId: job.id,
      status: job.status,
      memoriesProcessed: job.memoriesProcessed,
      clustersFound: job.clustersFound,
      autoMerged: job.autoMerged,
      queuedForReview: job.queuedForReview,
      durationMs: job.completedAt
        ? job.completedAt.getTime() - job.startedAt.getTime()
        : Date.now() - job.startedAt.getTime(),
    };
  }

  // ==========================================================================
  // Review Queue
  // ==========================================================================

  /**
   * Get merge candidates pending review
   */
  @Get('candidates')
  @ApiOperation({ summary: 'List merge candidates' })
  @ApiHeader({ name: 'x-user-id', required: true, description: 'User ID' })
  @ApiResponse({ status: 200, type: ListCandidatesResponseDto })
  async getCandidates(
    @Headers('x-user-id') userId: string,
    @Query() query: ListCandidatesQueryDto,
  ): Promise<ListCandidatesResponseDto> {
    if (!userId) {
      throw new HttpException('x-user-id header required', HttpStatus.BAD_REQUEST);
    }

    return this.reviewService.getCandidates(query.userId || userId, {
      status: query.status,
      minSimilarity: query.minSimilarity,
      limit: query.limit,
      offset: query.offset,
    });
  }

  /**
   * Get a single candidate
   */
  @Get('candidates/:candidateId')
  @ApiOperation({ summary: 'Get merge candidate by ID' })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 404, description: 'Candidate not found' })
  async getCandidate(@Param('candidateId') candidateId: string) {
    const candidate = await this.reviewService.getCandidate(candidateId);
    if (!candidate) {
      throw new HttpException(`Candidate not found: ${candidateId}`, HttpStatus.NOT_FOUND);
    }
    return candidate;
  }

  /**
   * Approve a merge candidate
   */
  @Post('review/:candidateId/approve')
  @ApiOperation({ summary: 'Approve merge candidate' })
  @ApiHeader({ name: 'x-approver-id', required: false, description: 'Approver ID' })
  @ApiResponse({ status: 200, type: ApproveResponseDto })
  @ApiResponse({ status: 400, description: 'Invalid request' })
  @ApiResponse({ status: 404, description: 'Candidate not found' })
  async approve(
    @Param('candidateId') candidateId: string,
    @Body() dto: ApproveRequestDto,
    @Headers('x-approver-id') approverId?: string,
  ): Promise<ApproveResponseDto> {
    try {
      return await this.reviewService.approve(candidateId, dto, approverId);
    } catch (error) {
      if (error instanceof Error && error.message.includes('not found')) {
        throw new HttpException(error.message, HttpStatus.NOT_FOUND);
      }
      throw new HttpException(
        error instanceof Error ? error.message : 'Failed to approve',
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  /**
   * Reject a merge candidate
   */
  @Post('review/:candidateId/reject')
  @ApiOperation({ summary: 'Reject merge candidate' })
  @ApiHeader({ name: 'x-approver-id', required: false, description: 'Rejector ID' })
  @ApiResponse({ status: 200, type: RejectResponseDto })
  @ApiResponse({ status: 404, description: 'Candidate not found' })
  async reject(
    @Param('candidateId') candidateId: string,
    @Body() dto: RejectRequestDto,
    @Headers('x-approver-id') approverId?: string,
  ): Promise<RejectResponseDto> {
    try {
      return await this.reviewService.reject(candidateId, dto, approverId);
    } catch (error) {
      if (error instanceof Error && error.message.includes('not found')) {
        throw new HttpException(error.message, HttpStatus.NOT_FOUND);
      }
      throw new HttpException(
        error instanceof Error ? error.message : 'Failed to reject',
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  /**
   * Skip a merge candidate (will resurface later)
   */
  @Post('review/:candidateId/skip')
  @ApiOperation({ summary: 'Skip merge candidate' })
  @ApiQuery({ name: 'days', required: false, type: Number, description: 'Days to skip (default 7)' })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 404, description: 'Candidate not found' })
  async skip(
    @Param('candidateId') candidateId: string,
    @Query('days') days?: number,
  ): Promise<{ success: boolean; nextReviewAt: Date }> {
    try {
      return await this.reviewService.skip(candidateId, days);
    } catch (error) {
      if (error instanceof Error && error.message.includes('not found')) {
        throw new HttpException(error.message, HttpStatus.NOT_FOUND);
      }
      throw new HttpException(
        error instanceof Error ? error.message : 'Failed to skip',
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  // ==========================================================================
  // Manual Merge Operations
  // ==========================================================================

  /**
   * Manually trigger a merge
   */
  @Post('merge')
  @ApiOperation({ summary: 'Manually merge memories' })
  @ApiHeader({ name: 'x-user-id', required: true, description: 'User ID' })
  @ApiHeader({ name: 'x-approver-id', required: false, description: 'Approver ID' })
  @ApiResponse({ status: 200, type: MergeResponseDto })
  @ApiResponse({ status: 400, description: 'Invalid request' })
  async merge(
    @Headers('x-user-id') userId: string,
    @Body() dto: ManualMergeDto,
    @Headers('x-approver-id') approverId?: string,
  ): Promise<MergeResponseDto> {
    if (!userId) {
      throw new HttpException('x-user-id header required', HttpStatus.BAD_REQUEST);
    }

    try {
      return await this.dedupService.manualMerge(dto, userId, approverId);
    } catch (error) {
      throw new HttpException(
        error instanceof Error ? error.message : 'Failed to merge',
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  /**
   * Rollback a merge
   */
  @Post('merge/:mergeEventId/rollback')
  @ApiOperation({ summary: 'Rollback a merge' })
  @ApiResponse({ status: 200, type: RollbackResponseDto })
  @ApiResponse({ status: 400, description: 'Cannot rollback' })
  @ApiResponse({ status: 404, description: 'Merge event not found' })
  async rollback(@Param('mergeEventId') mergeEventId: string): Promise<RollbackResponseDto> {
    try {
      return await this.dedupService.rollback(mergeEventId);
    } catch (error) {
      if (error instanceof Error && error.message.includes('not found')) {
        throw new HttpException(error.message, HttpStatus.NOT_FOUND);
      }
      throw new HttpException(
        error instanceof Error ? error.message : 'Failed to rollback',
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  // ==========================================================================
  // Merge History & Lineage
  // ==========================================================================

  /**
   * Get merge history
   */
  @Get('history')
  @ApiOperation({ summary: 'Get merge history' })
  @ApiHeader({ name: 'x-user-id', required: true, description: 'User ID' })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'offset', required: false, type: Number })
  @ApiQuery({ name: 'survivorId', required: false, type: String })
  @ApiResponse({ status: 200 })
  async getHistory(
    @Headers('x-user-id') userId: string,
    @Query('limit') limit?: number,
    @Query('offset') offset?: number,
    @Query('survivorId') survivorId?: string,
  ): Promise<{ events: MergeEventDto[]; total: number }> {
    if (!userId) {
      throw new HttpException('x-user-id header required', HttpStatus.BAD_REQUEST);
    }

    return this.lineageService.getMergeHistory(userId, {
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
      survivorId,
    });
  }

  /**
   * Get merge event by ID
   */
  @Get('history/:mergeEventId')
  @ApiOperation({ summary: 'Get merge event details' })
  @ApiResponse({ status: 200, type: MergeEventDto })
  @ApiResponse({ status: 404, description: 'Merge event not found' })
  async getMergeEvent(@Param('mergeEventId') mergeEventId: string): Promise<MergeEventDto> {
    const event = await this.lineageService.getMergeEvent(mergeEventId);
    if (!event) {
      throw new HttpException(`Merge event not found: ${mergeEventId}`, HttpStatus.NOT_FOUND);
    }
    return event;
  }

  /**
   * Get lineage for a memory
   */
  @Get('lineage/:memoryId')
  @ApiOperation({ summary: 'Get memory lineage' })
  @ApiResponse({ status: 200 })
  async getLineage(@Param('memoryId') memoryId: string): Promise<{
    mergedFrom: string[];
    mergedInto: string | null;
    mergeEvents: MergeEventDto[];
  }> {
    return this.lineageService.getMemoryLineage(memoryId);
  }

  // ==========================================================================
  // Similar Memories
  // ==========================================================================

  /**
   * Find similar memories
   */
  @Get('similar/:memoryId')
  @ApiOperation({ summary: 'Find similar memories' })
  @ApiHeader({ name: 'x-user-id', required: true, description: 'User ID' })
  @ApiQuery({ name: 'topK', required: false, type: Number })
  @ApiQuery({ name: 'minSimilarity', required: false, type: Number })
  @ApiResponse({ status: 200, type: [SimilarMemoryDto] })
  async findSimilar(
    @Param('memoryId') memoryId: string,
    @Headers('x-user-id') userId: string,
    @Query('topK') topK?: number,
    @Query('minSimilarity') minSimilarity?: number,
  ): Promise<SimilarMemoryDto[]> {
    if (!userId) {
      throw new HttpException('x-user-id header required', HttpStatus.BAD_REQUEST);
    }

    return this.dedupService.findSimilar(memoryId, userId, {
      topK: topK ? Number(topK) : undefined,
      minSimilarity: minSimilarity ? Number(minSimilarity) : undefined,
    });
  }

  // ==========================================================================
  // Configuration
  // ==========================================================================

  /**
   * Get dedup configuration
   */
  @Get('config')
  @ApiOperation({ summary: 'Get deduplication configuration' })
  @ApiHeader({ name: 'x-user-id', required: true, description: 'User ID' })
  @ApiResponse({ status: 200, type: ConfigResponseDto })
  async getConfig(@Headers('x-user-id') userId: string): Promise<ConfigResponseDto> {
    if (!userId) {
      throw new HttpException('x-user-id header required', HttpStatus.BAD_REQUEST);
    }

    return this.dedupService.getConfig(userId);
  }

  /**
   * Update dedup configuration
   */
  @Patch('config')
  @ApiOperation({ summary: 'Update deduplication configuration' })
  @ApiHeader({ name: 'x-user-id', required: true, description: 'User ID' })
  @ApiResponse({ status: 200, type: ConfigResponseDto })
  async updateConfig(
    @Headers('x-user-id') userId: string,
    @Body() dto: UpdateConfigDto,
  ): Promise<ConfigResponseDto> {
    if (!userId) {
      throw new HttpException('x-user-id header required', HttpStatus.BAD_REQUEST);
    }

    return this.dedupService.updateConfig(userId, dto);
  }

  // ==========================================================================
  // Statistics
  // ==========================================================================

  /**
   * Get dedup statistics
   */
  @Get('stats')
  @ApiOperation({ summary: 'Get deduplication statistics' })
  @ApiHeader({ name: 'x-user-id', required: true, description: 'User ID' })
  @ApiResponse({ status: 200, type: StatsResponseDto })
  async getStats(@Headers('x-user-id') userId: string): Promise<StatsResponseDto> {
    if (!userId) {
      throw new HttpException('x-user-id header required', HttpStatus.BAD_REQUEST);
    }

    return this.dedupService.getStats(userId);
  }

  /**
   * Check if dedup is enabled
   */
  @Get('enabled')
  @ApiOperation({ summary: 'Check if deduplication is enabled' })
  @ApiResponse({ status: 200 })
  isEnabled(): { enabled: boolean; version: string } {
    return {
      enabled: this.dedupService.isEnabled(),
      version: '1.0.0',
    };
  }
}
