import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { ProjectsModule } from './projects/projects.module';
import { SearchModule } from './search/search.module';
import { IngestionModule } from './ingestion/ingestion.module';
import { CardsModule } from './v2/api/cards.module';
import { PassRunsModule } from './v2/api/pass-runs.module';
import { V2IngestModule } from './v2/ingest/ingest.module';
import { SchedulerModule } from './v2/scheduler/scheduler.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    PrismaModule,
    ProjectsModule,
    SearchModule,
    IngestionModule,
    CardsModule,
    PassRunsModule,
    V2IngestModule,
    SchedulerModule,
  ],
})
export class AppModule {}
