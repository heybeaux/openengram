import { Module } from '@nestjs/common';
import { FogIndexController } from './fog-index.controller';
import { FogIndexService } from './fog-index.service';
import { PrismaModule } from '../prisma/prisma.module';
import { AccountModule } from '../account/account.module';

@Module({
  imports: [AccountModule, PrismaModule],
  controllers: [FogIndexController],
  providers: [FogIndexService],
  exports: [FogIndexService],
})
export class FogIndexModule {}
