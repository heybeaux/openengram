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
import { DeduplicationModule } from './deduplication/deduplication.module';
import { MultiQueryModule } from './multi-query/multi-query.module';
import { ConsolidationModule } from './consolidation/consolidation.module';
import { ClusteringModule } from './clustering/clustering.module';
import { HealthModule } from './health/health.module';
import { SummarizationModule } from './summarization/summarization.module';
import { CorrectionModule } from './correction/correction.module';
import { AgentSessionModule } from './agent-session/agent-session.module';
import { MemoryPoolModule } from './memory-pool/memory-pool.module';
import { MemoryAccessLogModule } from './memory-access-log/memory-access-log.module';
import { ScopedContextModule } from './scoped-context/scoped-context.module';
import { RateLimitModule } from './rate-limit/rate-limit.module';
import { MonitoringModule } from './monitoring/monitoring.module';
import { FogIndexModule } from './fog-index/fog-index.module';
import { EvalModule } from './eval/eval.module';
import { EmbeddingModule } from './embedding/embedding.module';
import { EventModule } from './events/event.module';
import { WebhookModule } from './webhooks/webhook.module';
import { AccountModule } from './account/account.module';
import { StripeModule } from './stripe/stripe.module';
import { MiddlewareConsumer, NestModule } from '@nestjs/common';
import { UsageLimitMiddleware } from './common/middleware/usage-limit.middleware';

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
    EventModule,
    EmbeddingModule,
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
    MultiQueryModule,
    DeduplicationModule,
    ConsolidationModule,
    ClusteringModule,
    HealthModule,
    CorrectionModule,
    SummarizationModule,
    MemoryAccessLogModule,
    AgentSessionModule,
    MemoryPoolModule,
    ScopedContextModule,
    FogIndexModule,
    RateLimitModule,
    MonitoringModule,
    EvalModule,
    WebhookModule,
    AccountModule,
    StripeModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(UsageLimitMiddleware).forRoutes('v1/*path');
  }
}
