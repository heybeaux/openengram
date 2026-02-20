import { Controller, Post, Get, Query, UseGuards, HttpCode, Optional } from '@nestjs/common';
import { WakingCycleService } from './waking-cycle.service';
import { ApiKeyGuard } from '../common/guards/api-key.guard';
import { AwarenessConfig } from './config/awareness.config';

/**
 * Awareness API — on-demand Waking Cycle trigger.
 *
 * POST /v1/awareness/cycle — run a cycle immediately and return results.
 * POST /v1/awareness/cycle?accountId=xxx — run for a specific account.
 * GET  /v1/awareness/status — check if awareness is enabled and configured.
 * Requires API key auth (same as memory endpoints).
 */
@Controller('v1/awareness')
@UseGuards(ApiKeyGuard)
export class AwarenessController {
  constructor(
    @Optional() private readonly wakingCycle?: WakingCycleService,
  ) {}

  @Get('status')
  @HttpCode(200)
  getStatus() {
    return {
      enabled: AwarenessConfig.enabled,
      schedule: AwarenessConfig.schedule,
      signals: AwarenessConfig.signals,
      github: {
        configured: !!AwarenessConfig.github.token && AwarenessConfig.github.repos.length > 0,
        repos: AwarenessConfig.github.repos,
      },
      cycleAvailable: !!this.wakingCycle,
    };
  }

  @Post('cycle')
  @HttpCode(200)
  async triggerCycle(@Query('accountId') accountId?: string) {
    if (!this.wakingCycle) {
      return {
        error: 'Waking Cycle not available. Set AWARENESS_ENABLED=true and redeploy.',
        enabled: AwarenessConfig.enabled,
      };
    }
    return this.wakingCycle.runCycle(accountId);
  }
}
