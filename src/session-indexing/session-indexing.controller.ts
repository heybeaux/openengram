import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { SessionIndexingService } from './session-indexing.service';
import { IndexSessionDto, FlushMemoriesDto } from './dto/session-indexing.dto';
import { ApiKeyOrJwtGuard } from '../common/guards/api-key-or-jwt.guard';
import { UserId } from '../common/decorators/user-id.decorator';
import { RateLimitGuard } from '../rate-limit/rate-limit.guard';
import { RateLimit } from '../rate-limit/rate-limit.decorator';
import { SanitizeInterceptor } from '../common/interceptors/sanitize.interceptor';

@ApiTags('sessions', 'flush')
@Controller('v1')
@UseGuards(ApiKeyOrJwtGuard, RateLimitGuard)
@UseInterceptors(SanitizeInterceptor)
export class SessionIndexingController {
  constructor(private readonly service: SessionIndexingService) {}

  /**
   * POST /v1/sessions/index
   * HEY-326: Index a conversation transcript into searchable memory chunks.
   */
  @Post('sessions/index')
  @RateLimit(10)
  @ApiOperation({
    summary: 'Index a session transcript',
    description:
      'Split a conversation transcript into chunks, embed, and store as SESSION memories.',
  })
  async indexSession(
    @UserId() userId: string,
    @Body() dto: IndexSessionDto,
  ) {
    return this.service.indexSession(userId, dto);
  }

  /**
   * GET /v1/sessions/:id/memories
   * HEY-326: Retrieve all memories from a session.
   */
  @Get('sessions/:id/memories')
  @ApiOperation({
    summary: 'Get session memories',
    description: 'Retrieve all memories linked to a specific session.',
  })
  async getSessionMemories(
    @UserId() userId: string,
    @Param('id') sessionId: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.service.getSessionMemories(
      userId,
      sessionId,
      limit ? parseInt(limit, 10) : undefined,
      offset ? parseInt(offset, 10) : undefined,
    );
  }

  /**
   * POST /v1/memories/flush
   * HEY-327: Pre-compaction memory flush.
   * Store a batch of memories urgently before context compaction.
   */
  @Post('memories/flush')
  @RateLimit(20)
  @ApiOperation({
    summary: 'Flush memories before compaction',
    description:
      'Urgently store key memories/summaries before context window compaction.',
  })
  async flushMemories(
    @UserId() userId: string,
    @Body() dto: FlushMemoriesDto,
  ) {
    return this.service.flushMemories(userId, dto);
  }
}
