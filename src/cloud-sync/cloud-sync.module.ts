import { Module } from '@nestjs/common';
import {
  CloudSyncController,
  SyncIngestController,
} from './cloud-sync.controller';
import { CloudSyncService } from './cloud-sync.service';
import { CloudSyncPushService } from './cloud-sync-push.service';
import { CloudSyncPullService } from './cloud-sync-pull.service';
import { CloudSyncIngestService } from './cloud-sync-ingest.service';
import { SyncReconciliationService } from './sync-reconciliation.service';
import { ReconciliationController } from './reconciliation.controller';
import { ConfigModule } from '@nestjs/config';
import { CloudLinkModule } from '../cloud-link/cloud-link.module';
import { AccountModule } from '../account/account.module';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [AccountModule, CloudLinkModule, ConfigModule, PrismaModule],
  controllers: [CloudSyncController, SyncIngestController, ReconciliationController],
  providers: [
    CloudSyncService,
    CloudSyncPushService,
    CloudSyncPullService,
    CloudSyncIngestService,
    SyncReconciliationService,
  ],
  exports: [CloudSyncService, SyncReconciliationService],
})
export class CloudSyncModule {}
