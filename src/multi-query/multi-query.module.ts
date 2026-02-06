import { Module } from '@nestjs/common';
import { MultiQueryService } from './multi-query.service';
import { QueryExpansionService } from './query-expansion.service';
import { ResultFusionService } from './result-fusion.service';
import { MultiQueryController } from './multi-query.controller';
import { MemoryModule } from '../memory/memory.module';
import { LLMModule } from '../llm/llm.module';

/**
 * Multi-Query Retrieval Module
 * 
 * Provides multi-query search capabilities to improve recall by:
 * - Expanding queries into semantic variants
 * - Parallel embedding and search
 * - Result fusion with RRF and other strategies
 * 
 * Usage:
 * Import this module and inject MultiQueryService where needed.
 * The service integrates with existing EmbeddingService for vector ops.
 */
@Module({
  imports: [MemoryModule, LLMModule],
  controllers: [MultiQueryController],
  providers: [
    MultiQueryService,
    QueryExpansionService,
    ResultFusionService,
  ],
  exports: [MultiQueryService, QueryExpansionService, ResultFusionService],
})
export class MultiQueryModule {}
