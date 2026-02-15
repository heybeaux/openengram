import { Module } from '@nestjs/common';
import { CorrectionService } from './correction.service';
import { CorrectionController } from './correction.controller';
import { MemoryModule } from '../memory/memory.module';
import { LLMModule } from '../llm/llm.module';
import { AccountModule } from '../account/account.module';

@Module({
  imports: [AccountModule, MemoryModule, LLMModule],
  controllers: [CorrectionController],
  providers: [CorrectionService],
  exports: [CorrectionService],
})
export class CorrectionModule {}
