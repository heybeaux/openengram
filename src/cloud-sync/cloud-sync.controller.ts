import {
  Controller,
  Post,
  Get,
  Put,
  Delete,
  Body,
  UseGuards,
  Req,
  HttpCode,
  Headers,
  BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { CloudSyncService } from './cloud-sync.service';
import { AccountJwtGuard } from '../account/account.guard';
import { AdminGuard } from '../common/guards/admin.guard';
import { SyncPushDto, SyncPushResponse } from './dto/sync-push.dto';
import { ApiKeyGuard } from '../common/guards/api-key.guard';

@ApiTags('cloud')
@Controller('v1/cloud/sync')
@UseGuards(AccountJwtGuard)
@ApiBearerAuth()
export class CloudSyncController {
  constructor(private readonly cloudSyncService: CloudSyncService) {}

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
  @UseGuards(ApiKeyGuard)
  @ApiOperation({ summary: 'Batch push memories from local instance' })
  async pushBatch(
    @Body() dto: SyncPushDto,
    @Headers('x-instance-id') instanceId: string,
    @Req() req: any,
  ): Promise<SyncPushResponse> {
    if (!instanceId) {
      throw new BadRequestException('X-Instance-Id header is required');
    }

    if (dto.syncProtocolVersion && dto.syncProtocolVersion > 2) {
      throw new BadRequestException('Unsupported sync protocol version');
    }

    const userId = req.userId;
    return this.cloudSyncService.handleSyncPush(userId, instanceId, dto);
  }
}
