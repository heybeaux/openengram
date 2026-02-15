import { Module } from '@nestjs/common';
import { AutoController } from './auto.controller';
import { ConversationObserverService } from './conversation-observer.service';
import { ImportanceDetectorService } from './importance-detector.service';
import { AutoExtractorService } from './auto-extractor.service';
import { MemoryModule } from '../memory/memory.module';
import { PrismaModule } from '../prisma/prisma.module';
import { SummarizationModule } from '../summarization/summarization.module';
import { AccountModule } from '../account/account.module';

@Module({
  imports: [AccountModule, MemoryModule, PrismaModule, SummarizationModule],
  controllers: [AutoController],
  providers: [
    ConversationObserverService,
    ImportanceDetectorService,
    AutoExtractorService,
  ],
  exports: [ConversationObserverService],
})
export class AutoModule {}
