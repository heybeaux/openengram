import { Module } from '@nestjs/common';
import { FogIndexController } from './fog-index.controller';
import { FogIndexService } from './fog-index.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [FogIndexController],
  providers: [FogIndexService],
  exports: [FogIndexService],
})
export class FogIndexModule {}
