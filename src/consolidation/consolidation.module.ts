import { Module } from '@nestjs/common';
import { ConsolidationController } from './consolidation.controller';
import { DreamCycleService } from './dream-cycle.service';
import { DreamCycleSchedulerService } from './dream-cycle-scheduler.service';
import { GenerateContextService } from './generate-context.service';
import {
  DreamCycleDedupStage,
  DreamCycleStalenessStage,
  DreamCyclePatternsStage,
  DreamCycleDriftStage,
  DreamCycleIdentityStage,
  DreamCyclePendingStage,
  DreamCycleTieringStage,
  DreamCycleConsolidationStage,
} from './stages';
import { MemoryModule } from '../memory/memory.module';
import { LLMModule } from '../llm/llm.module';
import { ClusteringModule } from '../clustering/clustering.module';
import { ImportanceScorerService } from '../memory/intelligence/importance-scorer.service';
import { FogIndexModule } from '../fog-index/fog-index.module';
import { AccountModule } from '../account/account.module';
import { IdentityModule } from '../identity/identity.module';
import { TemporalSamplingService } from './temporal-sampling.service';
import { ServicePrismaModule } from '../prisma/service-prisma.module';
import { DreamCycleRunTrackerService } from './dream-cycle-run-tracker.service';

@Module({
  imports: [
    AccountModule,
    MemoryModule,
    LLMModule,
    ClusteringModule,
    FogIndexModule,
    IdentityModule,
    ServicePrismaModule,
  ],
  controllers: [ConsolidationController],
  providers: [
    DreamCycleService,
    DreamCycleSchedulerService,
    DreamCycleDedupStage,
    DreamCycleStalenessStage,
    DreamCyclePendingStage,
    DreamCyclePatternsStage,
    DreamCycleDriftStage,
    DreamCycleIdentityStage,
    DreamCycleTieringStage,
    DreamCycleConsolidationStage,
    GenerateContextService,
    ImportanceScorerService,
    TemporalSamplingService,
    DreamCycleRunTrackerService,
  ],
  exports: [DreamCycleService, GenerateContextService],
})
export class ConsolidationModule {}
