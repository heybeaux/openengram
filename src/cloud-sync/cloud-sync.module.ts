import { Module } from '@nestjs/common';
import {
  CloudSyncController,
  SyncIngestController,
} from './cloud-sync.controller';
import { CloudSyncService } from './cloud-sync.service';
import { CloudLinkModule } from '../cloud-link/cloud-link.module';
import { AccountModule } from '../account/account.module';

@Module({
  imports: [AccountModule, CloudLinkModule],
  controllers: [CloudSyncController, SyncIngestController],
  providers: [CloudSyncService],
  exports: [CloudSyncService],
})
export class CloudSyncModule {}
