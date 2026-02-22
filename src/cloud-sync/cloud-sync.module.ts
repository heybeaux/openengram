import { Module } from '@nestjs/common';
import {
  CloudSyncController,
  SyncIngestController,
} from './cloud-sync.controller';
import { CloudSyncService } from './cloud-sync.service';
import { SyncReconciliationService } from './sync-reconciliation.service';
import { ReconciliationController } from './reconciliation.controller';
import { CloudLinkModule } from '../cloud-link/cloud-link.module';
import { AccountModule } from '../account/account.module';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [AccountModule, CloudLinkModule, PrismaModule],
  controllers: [CloudSyncController, SyncIngestController, ReconciliationController],
  providers: [CloudSyncService, SyncReconciliationService],
  exports: [CloudSyncService, SyncReconciliationService],
})
export class CloudSyncModule {}
