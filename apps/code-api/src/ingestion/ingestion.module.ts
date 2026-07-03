import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { IngestionController } from './ingestion.controller';
import { IngestionStoreService } from './ingestion-store.service';

@Module({
  imports: [PrismaModule],
  controllers: [IngestionController],
  providers: [IngestionStoreService],
  exports: [IngestionStoreService],
})
export class IngestionModule {}
