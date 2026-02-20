import {
  Controller,
  Post,
  Get,
  Patch,
  Body,
  Param,
  UseGuards,
  HttpCode,
  Optional,
} from '@nestjs/common';
import { WakingCycleService } from './waking-cycle.service';
import { InsightFeedbackService } from './insight-feedback.service';
import { ProactiveNotificationService } from './proactive-notification.service';
import { ApiKeyGuard } from '../common/guards/api-key.guard';
import { AwarenessConfig } from './config/awareness.config';
import { InsightFeedbackDto } from './dto/insight-feedback.dto';
import { NotificationConfigDto } from './dto/notification-config.dto';

@Controller('v1')
@UseGuards(ApiKeyGuard)
export class AwarenessController {
  constructor(
    @Optional() private readonly wakingCycle?: WakingCycleService,
    @Optional() private readonly insightFeedback?: InsightFeedbackService,
    @Optional() private readonly proactiveNotification?: ProactiveNotificationService,
  ) {}

  @Get('awareness/status')
  @HttpCode(200)
  getStatus() {
    return {
      enabled: AwarenessConfig.enabled,
      schedule: AwarenessConfig.schedule,
      signals: AwarenessConfig.signals,
      github: {
        configured:
          !!AwarenessConfig.github.token &&
          AwarenessConfig.github.repos.length > 0,
        repos: AwarenessConfig.github.repos,
      },
      cycleAvailable: !!this.wakingCycle,
    };
  }

  @Post('awareness/cycle')
  @HttpCode(200)
  async triggerCycle() {
    if (!this.wakingCycle) {
      return {
        error: 'Waking Cycle not available. Set AWARENESS_ENABLED=true and redeploy.',
        enabled: AwarenessConfig.enabled,
      };
    }
    return this.wakingCycle.runCycle();
  }

  /** HEY-151: PATCH /v1/insights/:id/feedback */
  @Patch('insights/:id/feedback')
  @HttpCode(200)
  async submitInsightFeedback(
    @Param('id') insightId: string,
    @Body() dto: InsightFeedbackDto,
  ) {
    if (!this.insightFeedback) {
      return {
        error: 'Insight feedback not available. Set AWARENESS_ENABLED=true and redeploy.',
        enabled: AwarenessConfig.enabled,
      };
    }
    return this.insightFeedback.recordFeedback(insightId, dto.action, dto.comment);
  }

  /** HEY-154: POST /v1/notifications/configure */
  @Post('notifications/configure')
  @HttpCode(200)
  async configureNotifications(@Body() dto: NotificationConfigDto) {
    if (!this.proactiveNotification) {
      return {
        error: 'Proactive notifications not available. Set AWARENESS_ENABLED=true and redeploy.',
        enabled: AwarenessConfig.enabled,
      };
    }
    const accountId = 'default';
    return this.proactiveNotification.configure(accountId, {
      confidenceThreshold: dto.confidenceThreshold,
      enabled: dto.enabled,
      webhookUrl: dto.webhookUrl,
      webhookSecret: dto.webhookSecret,
    });
  }

  /** HEY-154: GET /v1/notifications/config */
  @Get('notifications/config')
  @HttpCode(200)
  async getNotificationConfig() {
    if (!this.proactiveNotification) {
      return {
        error: 'Proactive notifications not available. Set AWARENESS_ENABLED=true and redeploy.',
        enabled: AwarenessConfig.enabled,
      };
    }
    return this.proactiveNotification.getConfig('default');
  }
}
