import {
  Controller,
  Post,
  Body,
  UseGuards,
  Req,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { AccountJwtGuard } from '../account/account.guard';
import { RateLimitGuard } from '../rate-limit/rate-limit.guard';
import { RateLimit } from '../rate-limit/rate-limit.decorator';
import { FeedbackService } from './feedback.service';
import { CreateFeedbackDto } from './feedback.dto';

@ApiTags('feedback')
@Controller('v1')
export class FeedbackController {
  constructor(private readonly feedbackService: FeedbackService) {}

  @Post('feedback')
  @UseGuards(AccountJwtGuard, RateLimitGuard)
  @RateLimit(10) // 10 per minute (effectively ~10/hour given typical usage)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.CREATED)
  async create(@Req() req: any, @Body() dto: CreateFeedbackDto) {
    const feedback = await this.feedbackService.create(req.accountId, dto);
    return { id: feedback.id, status: 'received' };
  }
}
