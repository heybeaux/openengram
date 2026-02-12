import { Module, forwardRef } from '@nestjs/common';
import { AgentSessionController } from './agent-session.controller';
import { AgentSessionService } from './agent-session.service';
import { MemoryPoolModule } from '../memory-pool/memory-pool.module';

@Module({
  imports: [forwardRef(() => MemoryPoolModule)],
  controllers: [AgentSessionController],
  providers: [AgentSessionService],
  exports: [AgentSessionService],
})
export class AgentSessionModule {}
