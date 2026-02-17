import { Module } from '@nestjs/common';
import { ScopedContextController } from './scoped-context.controller';
import { ScopedContextService } from './scoped-context.service';
import { AgentSessionModule } from '../agent-session/agent-session.module';
import { MemoryPoolModule } from '../memory-pool/memory-pool.module';
import { MemoryAccessLogModule } from '../memory-access-log/memory-access-log.module';
import { MemoryModule } from '../memory/memory.module';
import { AccountModule } from '../account/account.module';

@Module({
  imports: [
    AccountModule,
    AgentSessionModule,
    MemoryPoolModule,
    MemoryAccessLogModule,
    MemoryModule,
  ],
  controllers: [ScopedContextController],
  providers: [ScopedContextService],
  exports: [ScopedContextService],
})
export class ScopedContextModule {}
