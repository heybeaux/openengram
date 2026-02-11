import { Module } from '@nestjs/common';
import { MemoryPoolController } from './memory-pool.controller';
import { MemoryPoolService } from './memory-pool.service';

@Module({
  controllers: [MemoryPoolController],
  providers: [MemoryPoolService],
  exports: [MemoryPoolService],
})
export class MemoryPoolModule {}
