import { Module } from '@nestjs/common';
import { MemoryService } from './memory.service';
import { MemoryController } from './memory.controller';
import { ExtractionService } from './extraction.service';
import { EmbeddingService } from './embedding.service';
import { ImportanceService } from './importance.service';
import { BackfillService } from './backfill.service';
import { ConsolidationService } from './consolidation.service';
import { LLMModule } from '../llm/llm.module';

@Module({
  imports: [LLMModule],
  controllers: [MemoryController],
  providers: [
    MemoryService,
    ExtractionService,
    EmbeddingService,
    ImportanceService,
    BackfillService,
    ConsolidationService,
  ],
  exports: [MemoryService, BackfillService, ConsolidationService, EmbeddingService],
})
export class MemoryModule {}
