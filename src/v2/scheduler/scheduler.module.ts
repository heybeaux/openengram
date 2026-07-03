/**
 * Scheduler module (EC-49).
 *
 * Bundles three trigger surfaces — cron, webhook, post-commit hook — on
 * top of the existing V2IngestModule. The controllers/services live in
 * their own module so a deployer can disable scheduling entirely by
 * dropping it from `AppModule.imports` without touching ingest.
 */

import { Module } from '@nestjs/common';

import { V2IngestModule } from '../ingest/ingest.module';
import { CronSchedulerService } from './cron.service';
import { WebhookController } from './webhook.controller';

@Module({
  imports: [V2IngestModule],
  controllers: [WebhookController],
  providers: [CronSchedulerService],
})
export class SchedulerModule {}
