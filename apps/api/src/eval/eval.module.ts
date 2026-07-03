import { Module } from '@nestjs/common';
import { EvalService } from './eval.service';
import { EvalController } from './eval.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { MemoryModule } from '../memory/memory.module';
import { AccountModule } from '../account/account.module';

@Module({
  imports: [AccountModule, PrismaModule, MemoryModule],
  controllers: [EvalController],
  providers: [EvalService],
  exports: [EvalService],
})
export class EvalModule {}
