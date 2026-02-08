import { Module } from '@nestjs/common';
import { ConsolidationController } from './consolidation.controller';
import { DreamCycleService } from './dream-cycle.service';
import { MemoryModule } from '../memory/memory.module';
import { LLMModule } from '../llm/llm.module';
import { ImportanceScorerService } from '../memory/intelligence/importance-scorer.service';

@Module({
  imports: [MemoryModule, LLMModule],
  controllers: [ConsolidationController],
  providers: [DreamCycleService, ImportanceScorerService],
  exports: [DreamCycleService],
})
export class ConsolidationModule {}
