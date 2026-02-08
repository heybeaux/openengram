import { Module, forwardRef } from '@nestjs/common';
import { MemoryService } from './memory.service';
import { MemoryController } from './memory.controller';
import { ExtractionService } from './extraction.service';
import { EmbeddingService } from './embedding.service';
import { ImportanceService } from './importance.service';
import { BackfillService } from './backfill.service';
import { ConsolidationService } from './consolidation.service';
import { TemporalParserService } from './temporal/temporal-parser.service';
import { LLMModule } from '../llm/llm.module';
import { HierarchyModule } from '../hierarchy/hierarchy.module';
import { MultiQueryService } from '../multi-query/multi-query.service';
import { QueryExpansionService } from '../multi-query/query-expansion.service';
import { ResultFusionService } from '../multi-query/result-fusion.service';
import { ContextualRecallService } from './contextual-recall.service';

@Module({
  imports: [LLMModule, forwardRef(() => HierarchyModule)],
  controllers: [MemoryController],
  providers: [
    MemoryService,
    ExtractionService,
    EmbeddingService,
    ImportanceService,
    BackfillService,
    ConsolidationService,
    TemporalParserService,
    MultiQueryService,
    QueryExpansionService,
    ResultFusionService,
    ContextualRecallService,
  ],
  exports: [MemoryService, BackfillService, ConsolidationService, EmbeddingService, TemporalParserService, MultiQueryService, ContextualRecallService],
})
export class MemoryModule {}
