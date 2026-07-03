import { Controller, Post, Body, Param, UseGuards } from '@nestjs/common';
import { SummarizationService } from './summarization.service';
import { SummarizeDto, SummarizeResult } from './dto/summarize.dto';
import { ApiKeyOrJwtGuard } from '../common/guards/api-key-or-jwt.guard';
import { UserId } from '../common/decorators/user-id.decorator';

@Controller('v1/summarize')
@UseGuards(ApiKeyOrJwtGuard)
export class SummarizationController {
  constructor(private readonly summarizationService: SummarizationService) {}

  /**
   * POST /v1/summarize
   * Manually summarize provided conversation turns and store as memories
   */
  @Post()
  async summarize(
    @UserId() userId: string,
    @Body() dto: SummarizeDto,
  ): Promise<SummarizeResult> {
    return this.summarizationService.summarizeAndStore(userId, dto.turns, {
      sessionId: dto.sessionId,
      projectId: dto.projectId,
      minImportance: dto.minImportance,
    });
  }

  /**
   * POST /v1/summarize/session/:sessionId
   * Flush and summarize a session's buffered turns
   */
  @Post('session/:sessionId')
  async summarizeSession(
    @UserId() userId: string,
    @Param('sessionId') sessionId: string,
  ): Promise<SummarizeResult> {
    const result = await this.summarizationService.flushBuffer(
      userId,
      sessionId,
    );
    return (
      result ?? {
        facts: [],
        created: 0,
        totalTurns: 0,
        processingMs: 0,
      }
    );
  }
}
