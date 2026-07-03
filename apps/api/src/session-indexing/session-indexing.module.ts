import { Module } from '@nestjs/common';
import { SessionIndexingController } from './session-indexing.controller';
import { SessionIndexingService } from './session-indexing.service';
import { MemoryModule } from '../memory/memory.module';
import { EmbeddingModule } from '../embedding/embedding.module';
import { AccountModule } from '../account/account.module';

@Module({
  imports: [MemoryModule, EmbeddingModule, AccountModule],
  controllers: [SessionIndexingController],
  providers: [SessionIndexingService],
  exports: [SessionIndexingService],
})
export class SessionIndexingModule {}
