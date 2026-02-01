import { Global, Module } from '@nestjs/common';
import { LLMService } from './llm.service';

@Global()
@Module({
  providers: [LLMService],
  exports: [LLMService],
})
export class LLMModule {}
