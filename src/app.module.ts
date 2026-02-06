import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';
import { PrismaModule } from './prisma/prisma.module';
import { LLMModule } from './llm/llm.module';
import { VectorModule } from './vector/vector.module';
import { MemoryModule } from './memory/memory.module';
import { AutoModule } from './auto/auto.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { AgentModule } from './agent/agent.module';
import { HierarchyModule } from './hierarchy/hierarchy.module';
import { GraphModule } from './graph/graph.module';
import { ReembeddingModule } from './reembedding/reembedding.module';
import { EnsembleModule } from './ensemble/ensemble.module';
import { AnalyticsModule } from './analytics/analytics.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    ServeStaticModule.forRoot({
      // Works for both ts-node (src/) and compiled (dist/src/) by resolving from project root
      rootPath: join(process.cwd(), 'public'),
      serveRoot: '/',
      serveStaticOptions: {
        index: false, // Don't serve index.html for /
      },
    }),
    PrismaModule,
    LLMModule,
    VectorModule,
    MemoryModule,
    AutoModule,
    DashboardModule,
    AgentModule,
    HierarchyModule,
    GraphModule,
    ReembeddingModule,
    EnsembleModule,
    AnalyticsModule,
  ],
})
export class AppModule {}
