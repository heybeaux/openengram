import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  HttpException,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery } from '@nestjs/swagger';
import { ReembeddingService } from './reembedding.service';
import {
  TriggerReembeddingDto,
  ReembeddingJobDto,
  EnrichedMemoryPreviewDto,
} from './dto/reembedding.dto';
import { ApiKeyOrJwtGuard } from '../common/guards/api-key-or-jwt.guard';

/**
 * Re-embedding Controller
 *
 * API endpoints for triggering and monitoring re-embedding jobs.
 *
 * Endpoints:
 * - POST /v1/reembedding/run - Trigger a batch re-embedding job
 * - GET /v1/reembedding/status - Get current job status
 * - GET /v1/reembedding/status/:jobId - Get specific job status
 * - GET /v1/reembedding/jobs - List all jobs
 * - GET /v1/reembedding/preview/:memoryId - Preview enrichment for a memory
 * - POST /v1/reembedding/memory/:memoryId - Re-embed a single memory
 */
@ApiTags('reembedding')
@UseGuards(ApiKeyOrJwtGuard)
@Controller('v1/reembedding')
export class ReembeddingController {
  constructor(private reembeddingService: ReembeddingService) {}

  /**
   * Trigger a batch re-embedding job
   */
  @Post('run')
  @ApiOperation({ summary: 'Trigger batch re-embedding' })
  @ApiResponse({ status: 200, type: ReembeddingJobDto })
  @ApiResponse({
    status: 400,
    description: 'Re-embedding disabled or job already running',
  })
  async triggerReembedding(
    @Body() dto: TriggerReembeddingDto,
  ): Promise<ReembeddingJobDto> {
    try {
      return await this.reembeddingService.triggerReembedding(dto);
    } catch (error) {
      throw new HttpException(
        error instanceof Error
          ? error.message
          : 'Failed to trigger re-embedding',
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  /**
   * Get current job status
   */
  @Get('status')
  @ApiOperation({ summary: 'Get current job status' })
  @ApiResponse({ status: 200, type: ReembeddingJobDto })
  @ApiResponse({ status: 404, description: 'No active job' })
  getCurrentStatus(): ReembeddingJobDto {
    const status = this.reembeddingService.getCurrentJobStatus();
    if (!status) {
      throw new HttpException(
        'No active re-embedding job',
        HttpStatus.NOT_FOUND,
      );
    }
    return status;
  }

  /**
   * Get specific job status by ID
   */
  @Get('status/:jobId')
  @ApiOperation({ summary: 'Get job status by ID' })
  @ApiResponse({ status: 200, type: ReembeddingJobDto })
  @ApiResponse({ status: 404, description: 'Job not found' })
  getJobStatus(@Param('jobId') jobId: string): ReembeddingJobDto {
    const status = this.reembeddingService.getJobStatus(jobId);
    if (!status) {
      throw new HttpException(`Job not found: ${jobId}`, HttpStatus.NOT_FOUND);
    }
    return status;
  }

  /**
   * List all jobs
   */
  @Get('jobs')
  @ApiOperation({ summary: 'List all re-embedding jobs' })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiResponse({ status: 200, type: [ReembeddingJobDto] })
  listJobs(@Query('limit') limit?: number): ReembeddingJobDto[] {
    return this.reembeddingService.listJobs(limit ?? 10);
  }

  /**
   * Preview enrichment for a single memory
   */
  @Get('preview/:memoryId')
  @ApiOperation({ summary: 'Preview enrichment for a memory' })
  @ApiResponse({ status: 200, type: EnrichedMemoryPreviewDto })
  @ApiResponse({ status: 404, description: 'Memory not found' })
  async previewEnrichment(
    @Param('memoryId') memoryId: string,
  ): Promise<EnrichedMemoryPreviewDto> {
    const preview = await this.reembeddingService.previewEnrichment(memoryId);
    if (!preview) {
      throw new HttpException(
        `Memory not found: ${memoryId}`,
        HttpStatus.NOT_FOUND,
      );
    }
    return preview;
  }

  /**
   * Re-embed a single memory
   */
  @Post('memory/:memoryId')
  @ApiOperation({ summary: 'Re-embed a single memory' })
  @ApiQuery({ name: 'dryRun', required: false, type: Boolean })
  @ApiResponse({ status: 200, type: EnrichedMemoryPreviewDto })
  @ApiResponse({ status: 400, description: 'Re-embedding disabled' })
  @ApiResponse({ status: 404, description: 'Memory not found' })
  async reembedMemory(
    @Param('memoryId') memoryId: string,
    @Query('dryRun') dryRun?: string,
  ): Promise<EnrichedMemoryPreviewDto> {
    if (!this.reembeddingService.isEnabled()) {
      throw new HttpException(
        'Re-embedding is disabled. Set REEMBEDDING_ENABLED=true to enable.',
        HttpStatus.BAD_REQUEST,
      );
    }

    try {
      const result = await this.reembeddingService.reembedMemory(
        memoryId,
        dryRun === 'true',
      );
      if (!result) {
        throw new HttpException(
          `Memory not found: ${memoryId}`,
          HttpStatus.NOT_FOUND,
        );
      }
      return result;
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new HttpException(
        error instanceof Error ? error.message : 'Failed to re-embed memory',
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  /**
   * Check if re-embedding is enabled
   */
  @Get('enabled')
  @ApiOperation({ summary: 'Check if re-embedding is enabled' })
  @ApiResponse({ status: 200 })
  isEnabled(): { enabled: boolean; version: string } {
    return {
      enabled: this.reembeddingService.isEnabled(),
      version: '1.0.0',
    };
  }
}
