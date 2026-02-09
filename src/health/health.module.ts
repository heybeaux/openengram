import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaModule } from '../prisma/prisma.module';
import { MemoryModule } from '../memory/memory.module';
import { HealthController } from './health.controller';
import { EmbedHealthService } from './embed-health.service';
import { EmbeddingRetryService } from './embedding-retry.service';

@Module({
  imports: [ScheduleModule.forRoot(), PrismaModule, MemoryModule],
  controllers: [HealthController],
  providers: [EmbedHealthService, EmbeddingRetryService],
  exports: [EmbedHealthService],
})
export class HealthModule {}
