import { Module } from '@nestjs/common';
import { SummarizationController } from './summarization.controller';
import { SummarizationService } from './summarization.service';
import { MemoryModule } from '../memory/memory.module';

@Module({
  imports: [MemoryModule],
  controllers: [SummarizationController],
  providers: [SummarizationService],
  exports: [SummarizationService],
})
export class SummarizationModule {}
