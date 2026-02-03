import { Module } from '@nestjs/common';
import { AutoController } from './auto.controller';
import { ConversationObserverService } from './conversation-observer.service';
import { ImportanceDetectorService } from './importance-detector.service';
import { AutoExtractorService } from './auto-extractor.service';
import { MemoryModule } from '../memory/memory.module';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [MemoryModule, PrismaModule],
  controllers: [AutoController],
  providers: [
    ConversationObserverService,
    ImportanceDetectorService,
    AutoExtractorService,
  ],
  exports: [ConversationObserverService],
})
export class AutoModule {}
