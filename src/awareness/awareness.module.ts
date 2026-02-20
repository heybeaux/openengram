import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { WakingCycleService } from './waking-cycle.service';
import { AwarenessController } from './awareness.controller';
import { AwarenessSourceController } from './awareness-source.controller';
import { AwarenessSourceService } from './awareness-source.service';
import { MemorySignalService } from './signals/memory-signal.service';
import { GitHubSignalService } from './signals/github-signal.service';
import { LinearSignalService } from './signals/linear-signal.service';
import { PatternDetectorService } from './analysis/pattern-detector.service';
import { InsightGeneratorService } from './analysis/insight-generator.service';
import { PrismaModule } from '../prisma/prisma.module';
import { LLMModule } from '../llm/llm.module';
import { MemoryModule } from '../memory/memory.module';
import { AwarenessConfig } from './config/awareness.config';
import { Logger } from '@nestjs/common';

const logger = new Logger('AwarenessModule');

/**
 * Awareness Module — optional Waking Cycle for Engram.
 *
 * Enabled via AWARENESS_ENABLED=true. When disabled, this module
 * registers no providers and has zero runtime cost.
 *
 * The module observes memory patterns, detects insights, and stores
 * them as INSIGHT layer memories that flow through the standard
 * recall pipeline.
 */
@Module({
  // NOTE: ScheduleModule.forRoot() is registered here as no other module uses it yet.
  // If other modules need @Cron/@Interval, move .forRoot() to AppModule and import
  // ScheduleModule (without .forRoot()) here instead.
  imports: AwarenessConfig.enabled
    ? [PrismaModule, LLMModule, MemoryModule, ScheduleModule.forRoot()]
    : [],
  // Controller always registers — returns helpful errors when disabled
  controllers: [AwarenessController, AwarenessSourceController],
  providers: AwarenessConfig.enabled
    ? [
        WakingCycleService,
        MemorySignalService,
        GitHubSignalService,
        LinearSignalService,
        PatternDetectorService,
        InsightGeneratorService,
        AwarenessSourceService,
      ]
    : [AwarenessSourceService],
  exports: AwarenessConfig.enabled
    ? [WakingCycleService, AwarenessSourceService]
    : [AwarenessSourceService],
})
export class AwarenessModule {
  constructor() {
    if (AwarenessConfig.enabled) {
      logger.log('Awareness module enabled — Waking Cycle active');
    } else {
      logger.log('Awareness module disabled (set AWARENESS_ENABLED=true to enable)');
    }
  }
}
