import {
  Controller,
  Post,
  Get,
  Patch,
  Delete,
  Body,
  Param,
  Headers,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { MemoryService, MemoryWithExtraction, QueryResult, ContextResult } from './memory.service';
import { CreateMemoryDto, CreateMemoryBatchDto } from './dto/create-memory.dto';
import { QueryMemoryDto, LoadContextDto } from './dto/query-memory.dto';
import { ApiKeyGuard } from '../common/guards/api-key.guard';
import { UserId } from '../common/decorators/user-id.decorator';

@Controller('v1')
@UseGuards(ApiKeyGuard)
export class MemoryController {
  constructor(private readonly memoryService: MemoryService) {}

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
   * Correct a memory (creates new memory, links to original)
   */
  @Post('memories/:id/correct')
  async correct(
    @UserId() userId: string,
    @Param('id') id: string,
    @Body('correction') correction: string,
  ): Promise<MemoryWithExtraction> {
    // TODO: Implement correction flow
    // 1. Create new memory with correction
    // 2. Link to original with UPDATES chain
    // 3. Mark original as superseded
    return this.memoryService.remember(userId, { raw: correction });
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
}
