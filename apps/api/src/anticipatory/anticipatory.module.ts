import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { GraphModule } from '../graph/graph.module';
import { AnticipatoryService } from './anticipatory.service';
import { ContextSignalService } from './context-signal.service';
import { StrategySelectorService } from './strategy-selector.service';
import { CircuitBreakerService } from './circuit-breaker.service';
import { EntityRadiationStrategy } from './strategies/entity-radiation.strategy';
import { InsightInjectionStrategy } from './strategies/insight-injection.strategy';
import { FeedbackService } from './feedback/feedback.service';
import { FeedbackController } from './feedback/feedback.controller';

/**
 * Anticipatory Recall Module
 *
 * Provides the Anticipatory Recall Engine (ARE) — a system that runs
 * alongside standard memory recall to surface adjacent memories and
 * insights the agent didn't explicitly ask for.
 *
 * Feature-flagged via ANTICIPATORY_ENABLED environment variable.
 */
@Module({
  imports: [PrismaModule, GraphModule],
  controllers: [FeedbackController],
  providers: [
    AnticipatoryService,
    ContextSignalService,
    StrategySelectorService,
    CircuitBreakerService,
    EntityRadiationStrategy,
    InsightInjectionStrategy,
    FeedbackService,
  ],
  exports: [AnticipatoryService, ContextSignalService],
})
export class AnticipatoryModule {}
