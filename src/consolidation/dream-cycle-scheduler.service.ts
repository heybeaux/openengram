import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { DreamCycleService } from './dream-cycle.service';

@Injectable()
export class DreamCycleSchedulerService implements OnModuleInit {
  private readonly logger = new Logger(DreamCycleSchedulerService.name);
  private readonly enabled: boolean;

  constructor(
    private readonly dreamCycle: DreamCycleService,
    private readonly config: ConfigService,
  ) {
    this.enabled =
      this.config.get<string>('DREAM_CYCLE_ENABLED', 'true') !== 'false';
  }

  onModuleInit() {
    if (this.enabled) {
      this.logger.log('Dream Cycle scheduler enabled — runs daily at 03:00 UTC');
    } else {
      this.logger.log('Dream Cycle scheduler disabled (DREAM_CYCLE_ENABLED=false)');
    }
  }

  @Cron('0 3 * * *', { name: 'dream-cycle' })
  async handleDreamCycleCron() {
    if (!this.enabled) return;

    this.logger.log('Starting scheduled Dream Cycle run');
    const start = Date.now();

    try {
      const result = await this.dreamCycle.run();
      const durationSec = ((Date.now() - start) / 1000).toFixed(1);
      this.logger.log(
        `Dream Cycle completed in ${durationSec}s — ` +
          `status=${result.status}, merged=${result.duplicatesMerged}, ` +
          `archived=${result.memoriesArchived}, patterns=${result.patternsCreated}`,
      );
    } catch (error) {
      const durationSec = ((Date.now() - start) / 1000).toFixed(1);
      this.logger.error(
        `Dream Cycle failed after ${durationSec}s: ${error.message}`,
        error.stack,
      );
    }
  }
}
