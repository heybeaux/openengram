import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { MemoryAccessLogService } from './memory-access-log.service';
import { MemoryAccessLogController } from './memory-access-log.controller';

@Module({
  imports: [PrismaModule],
  controllers: [MemoryAccessLogController],
  providers: [MemoryAccessLogService],
  exports: [MemoryAccessLogService],
})
export class MemoryAccessLogModule {}
