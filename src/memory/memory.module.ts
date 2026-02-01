import { Module } from '@nestjs/common';
import { MemoryService } from './memory.service';
import { MemoryController } from './memory.controller';
import { ExtractionService } from './extraction.service';
import { EmbeddingService } from './embedding.service';
import { ImportanceService } from './importance.service';

@Module({
  controllers: [MemoryController],
  providers: [
    MemoryService,
    ExtractionService,
    EmbeddingService,
    ImportanceService,
  ],
  exports: [MemoryService],
})
export class MemoryModule {}
