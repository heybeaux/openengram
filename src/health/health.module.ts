import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { MemoryModule } from '../memory/memory.module';
import { HealthController } from './health.controller';
import { EmbedHealthService } from './embed-health.service';
import { EmbeddingRetryService } from './embedding-retry.service';

@Module({
  imports: [PrismaModule, MemoryModule],
  controllers: [HealthController],
  providers: [EmbedHealthService, EmbeddingRetryService],
  exports: [EmbedHealthService],
})
export class HealthModule {}
