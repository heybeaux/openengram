import { Module } from '@nestjs/common';
import { EvalService } from './eval.service';
import { EvalController } from './eval.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { MemoryModule } from '../memory/memory.module';

@Module({
  imports: [PrismaModule, MemoryModule],
  controllers: [EvalController],
  providers: [EvalService],
  exports: [EvalService],
})
export class EvalModule {}
