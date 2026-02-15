import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { MemoryAccessLogService } from './memory-access-log.service';
import { MemoryAccessLogController } from './memory-access-log.controller';
import { AccountModule } from '../account/account.module';

@Module({
  imports: [AccountModule, PrismaModule],
  controllers: [MemoryAccessLogController],
  providers: [MemoryAccessLogService],
  exports: [MemoryAccessLogService],
})
export class MemoryAccessLogModule {}
