import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { LLMModule } from './llm/llm.module';
import { VectorModule } from './vector/vector.module';
import { MemoryModule } from './memory/memory.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    PrismaModule,
    LLMModule,
    VectorModule,
    MemoryModule,
  ],
})
export class AppModule {}
