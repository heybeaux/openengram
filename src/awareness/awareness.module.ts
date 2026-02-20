import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { WakingCycleService } from './waking-cycle.service';
import { AwarenessController } from './awareness.controller';
import { MemorySignalService } from './signals/memory-signal.service';
import { GitHubSignalService } from './signals/github-signal.service';
import { PatternDetectorService } from './analysis/pattern-detector.service';
import { InsightGeneratorService } from './analysis/insight-generator.service';
import { BehavioralConsistencyService } from './analysis/behavioral-consistency.service';
import { InsightFeedbackService } from './insight-feedback.service';
import { ProactiveNotificationService } from './proactive-notification.service';
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
 * Features:
 * - Waking Cycle: pattern detection + insight generation (HEY-136)
 * - Insight Feedback: confidence adjustment from user feedback (HEY-151)
 * - Proactive Notifications: webhook push for high-confidence insights (HEY-154)
 */
@Module({
  imports: AwarenessConfig.enabled
    ? [PrismaModule, LLMModule, MemoryModule, ScheduleModule.forRoot()]
    : [],
  controllers: [AwarenessController],
  providers: AwarenessConfig.enabled
    ? [
        WakingCycleService,
        MemorySignalService,
        GitHubSignalService,
        PatternDetectorService,
        InsightGeneratorService,
        BehavioralConsistencyService,
        InsightFeedbackService,
        ProactiveNotificationService,
      ]
    : [],
  exports: AwarenessConfig.enabled
    ? [WakingCycleService, BehavioralConsistencyService, InsightFeedbackService, ProactiveNotificationService]
    : [],
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
