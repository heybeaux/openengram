import {
  Controller,
  Post,
  Get,
  Put,
  Delete,
  Body,
  Query,
  UseGuards,
  Req,
  HttpCode,
  BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { CloudSyncService } from './cloud-sync.service';
import { SyncReconciliationService } from './sync-reconciliation.service';
import { ApiKeyOrJwtGuard } from '../common/guards/api-key-or-jwt.guard';
import { AdminGuard } from '../common/guards/admin.guard';
import { SyncPushDto, SyncPushResponse } from './dto/sync-push.dto';
import { InstanceSyncKeyGuard } from '../common/guards/instance-sync-key.guard';

@ApiTags('cloud')
@Controller('v1/cloud/sync')
@UseGuards(ApiKeyOrJwtGuard)
@ApiBearerAuth()
export class CloudSyncController {
  constructor(
    private readonly cloudSyncService: CloudSyncService,
    private readonly reconciliationService: SyncReconciliationService,
  ) {}

  @Post()
  @HttpCode(200)
  @ApiOperation({ summary: 'Trigger cloud backup sync' })
  async sync(@Req() req: any) {
    return this.cloudSyncService.triggerSync(req.accountId);
  }

  @Get('status')
  @ApiOperation({ summary: 'Get cloud sync status' })
  async status(@Req() req: any) {
    return this.cloudSyncService.getSyncStatus(req.accountId);
  }

  @Delete()
  @HttpCode(200)
  @ApiOperation({ summary: 'Cancel in-progress sync' })
  async cancelSync() {
    this.cloudSyncService.cancelSync();
    return { cancelled: true };
  }

  @Put('auto-sync')
  @HttpCode(200)
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: 'Toggle auto-sync (admin only)' })
  async setAutoSync(@Req() req: any, @Body() body: { enabled: boolean }) {
    await this.cloudSyncService.setAutoSync(req.accountId, body.enabled);
    return { autoSync: body.enabled };
  }

  @Get('history')
  @ApiOperation({ summary: 'Get sync history (last N events)' })
  async history(@Req() req: any) {
    return this.cloudSyncService.getSyncHistory(req.accountId, 10);
  }

  @Post('pull')
  @HttpCode(200)
  @ApiOperation({ summary: 'Pull memories from cloud to local' })
  async pull(@Req() req: any) {
    return this.cloudSyncService.triggerPull(req.accountId);
  }
}

@ApiTags('cloud')
@Controller('v1/cloud/reconcile')
@UseGuards(ApiKeyOrJwtGuard)
@ApiBearerAuth()
export class ReconciliationController {
  constructor(
    private readonly reconciliationService: SyncReconciliationService,
  ) {}

  @Post('preview')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Preview reconciliation between local and cloud memories',
  })
  async preview(@Req() req: any) {
    return this.reconciliationService.reconcile(req.accountId);
  }

  @Post('execute')
  @HttpCode(200)
  @UseGuards(AdminGuard)
  @ApiOperation({
    summary: 'Execute bidirectional reconciliation (admin only)',
  })
  async execute(@Req() req: any) {
    const plan = await this.reconciliationService.reconcile(req.accountId);
    return this.reconciliationService.executeReconciliation(
      req.accountId,
      plan,
    );
  }
}

/**
 * Cloud-side sync ingestion controller.
 * Called by local instances to push memories to the cloud.
 * Authenticated via X-AM-API-Key header.
 */
@ApiTags('sync')
@Controller('v1/sync')
export class SyncIngestController {
  constructor(private readonly cloudSyncService: CloudSyncService) {}

  @Post('push')
  @HttpCode(200)
  @UseGuards(InstanceSyncKeyGuard)
  @ApiOperation({ summary: 'Batch push memories from local instance' })
  async pushBatch(
    @Body() dto: SyncPushDto,
    @Req() req: any,
  ): Promise<SyncPushResponse> {
    if (dto.syncProtocolVersion && dto.syncProtocolVersion > 2) {
      throw new BadRequestException('Unsupported sync protocol version');
    }

    return this.cloudSyncService.handleSyncPush(
      req.accountId,
      req.instanceId,
      dto,
    );
  }

  @Get('pull')
  @UseGuards(InstanceSyncKeyGuard)
  @ApiOperation({ summary: 'Pull memories modified since timestamp' })
  async pullBatch(
    @Query('since') since: string,
    @Query('limit') limit: string,
    @Req() req: any,
  ) {
    const sinceDate = since ? new Date(since) : new Date(0);
    const take = Math.min(parseInt(limit) || 100, 500);
    return this.cloudSyncService.handleSyncPull(
      req.accountId,
      req.instanceId,
      sinceDate,
      take,
    );
  }

  @Get('instances')
  @UseGuards(ApiKeyOrJwtGuard)
  @ApiOperation({ summary: 'List connected instances for the account' })
  async listInstances(@Req() req: any) {
    return this.cloudSyncService.getInstances(req.accountId);
  }
}
