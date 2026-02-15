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
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { CloudSyncService } from './cloud-sync.service';
import { AccountJwtGuard } from '../account/account.guard';

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
  @ApiOperation({ summary: 'Toggle auto-sync' })
  async setAutoSync(@Req() req: any, @Body() body: { enabled: boolean }) {
    await this.cloudSyncService.setAutoSync(req.accountId, body.enabled);
    return { autoSync: body.enabled };
  }
}
