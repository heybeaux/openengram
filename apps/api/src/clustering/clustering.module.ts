import { Module } from '@nestjs/common';
import { ClusteringController } from './clustering.controller';
import { ClusteringService } from './clustering.service';
import { PrismaModule } from '../prisma/prisma.module';
import { LLMModule } from '../llm/llm.module';
import { AccountModule } from '../account/account.module';

@Module({
  imports: [AccountModule, PrismaModule, LLMModule],
  controllers: [ClusteringController],
  providers: [ClusteringService],
  exports: [ClusteringService],
})
export class ClusteringModule {}
