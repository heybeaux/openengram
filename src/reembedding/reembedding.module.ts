import { Module } from '@nestjs/common';
import { ReembeddingService } from './reembedding.service';
import { ReembeddingController } from './reembedding.controller';
import { ContextEnricherService } from './context-enricher.service';
import { MemoryModule } from '../memory/memory.module';
import { AccountModule } from '../account/account.module';
import { EmbeddingModule } from '../embedding/embedding.module';

/**
 * Re-embedding Module
 *
 * MVP Implementation of Contextual Re-embedding for Engram.
 *
 * Features:
 * - Context enrichment (temporal, entity, importance)
 * - Batch re-embedding with progress tracking
 * - Embedding versioning
 * - Feature flag controlled (REEMBEDDING_ENABLED)
 *
 * Endpoints:
 * - POST /v1/reembedding/run - Trigger batch re-embedding
 * - GET /v1/reembedding/status - Get current job status
 * - GET /v1/reembedding/preview/:memoryId - Preview enrichment
 */
@Module({
  imports: [AccountModule, MemoryModule, EmbeddingModule],
  controllers: [ReembeddingController],
  providers: [ReembeddingService, ContextEnricherService],
  exports: [ReembeddingService, ContextEnricherService],
})
export class ReembeddingModule {}
