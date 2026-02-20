import { Module } from '@nestjs/common';
import {
  CloudSyncController,
  SyncIngestController,
  ReconciliationController,
} from './cloud-sync.controller';
import { CloudSyncService } from './cloud-sync.service';
import { SyncReconciliationService } from './sync-reconciliation.service';
import { CloudLinkModule } from '../cloud-link/cloud-link.module';
import { AccountModule } from '../account/account.module';

@Module({
  imports: [AccountModule, CloudLinkModule],
  controllers: [CloudSyncController, SyncIngestController, ReconciliationController],
  providers: [CloudSyncService, SyncReconciliationService],
  exports: [CloudSyncService, SyncReconciliationService],
})
export class CloudSyncModule {}
