import {
  Controller,
  Post,
  Body,
  UseGuards,
} from '@nestjs/common';
import { ConversationObserverService } from './conversation-observer.service';
import { ObserveDto, ObserveResult } from './dto/observe.dto';
import { ApiKeyGuard } from '../common/guards/api-key.guard';
import { UserId } from '../common/decorators/user-id.decorator';

@Controller('v1')
@UseGuards(ApiKeyGuard)
export class AutoController {
  constructor(private readonly observer: ConversationObserverService) {}

  /**
   * POST /v1/observe
   * Observe conversation turns and auto-extract memories
   * 
   * Analyzes conversation for importance signals:
   * - Explicit: "remember this", "important", "never forget"
   * - Corrections: "actually", "no that's wrong", "I meant"
   * - Preferences: "I prefer", "I always", "I never", "I like", "I hate"
   * - Repetition: same concept mentioned multiple times
   * 
   * Extracts and stores memories above the importance threshold.
   */
  @Post('observe')
  async observe(
    @UserId() userId: string,
    @Body() dto: ObserveDto,
  ): Promise<ObserveResult> {
    return this.observer.observe(userId, dto);
  }

  /**
   * POST /v1/observe/analyze
   * Analyze signals without storing (preview mode)
   */
  @Post('observe/analyze')
  async analyze(
    @UserId() userId: string,
    @Body() dto: ObserveDto,
  ): Promise<{
    signals: ObserveResult['signals'];
    aggregateImportance: number;
  }> {
    return this.observer.analyzeSignals(dto);
  }
}
