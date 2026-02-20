import { Module } from '@nestjs/common';
import { AgentController } from './agent.controller';
import { AgentService } from './agent.service';
import { TrustHistoryService } from './trust-history.service';
import { LLMModule } from '../llm/llm.module';
import { MemoryModule } from '../memory/memory.module';
import { AccountModule } from '../account/account.module';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [AccountModule, LLMModule, MemoryModule, PrismaModule],
  controllers: [AgentController],
  providers: [AgentService, TrustHistoryService],
  exports: [AgentService, TrustHistoryService],
})
export class AgentModule {}
