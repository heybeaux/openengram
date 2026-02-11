import { Module } from '@nestjs/common';
import { AgentSessionController } from './agent-session.controller';
import { AgentSessionService } from './agent-session.service';

@Module({
  controllers: [AgentSessionController],
  providers: [AgentSessionService],
  exports: [AgentSessionService],
})
export class AgentSessionModule {}
