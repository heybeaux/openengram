import { Module, forwardRef } from '@nestjs/common';
import { AgentSessionController } from './agent-session.controller';
import { AgentSessionService } from './agent-session.service';
import { MemoryPoolModule } from '../memory-pool/memory-pool.module';
import { AccountModule } from '../account/account.module';

@Module({
  imports: [AccountModule, forwardRef(() => MemoryPoolModule)],
  controllers: [AgentSessionController],
  providers: [AgentSessionService],
  exports: [AgentSessionService],
})
export class AgentSessionModule {}
