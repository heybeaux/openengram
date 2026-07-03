import { Module } from '@nestjs/common';
import { MemoryPoolController } from './memory-pool.controller';
import { MemoryPoolService } from './memory-pool.service';
import { AccountModule } from '../account/account.module';

@Module({
  imports: [AccountModule, AccountModule],
  controllers: [MemoryPoolController],
  providers: [MemoryPoolService],
  exports: [MemoryPoolService],
})
export class MemoryPoolModule {}
