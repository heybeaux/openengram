import {
  Controller,
  Post,
  UseGuards,
  HttpCode,
  Req,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { ApiKeyOrJwtGuard } from '../common/guards/api-key-or-jwt.guard';
import { SyncReconciliationService } from './sync-reconciliation.service';

@ApiTags('cloud')
@Controller('v1/cloud/reconcile')
@UseGuards(ApiKeyOrJwtGuard)
@ApiBearerAuth()
export class ReconciliationController {
  constructor(private readonly reconciliationService: SyncReconciliationService) {}

  @Post('preview')
  @HttpCode(200)
  @ApiOperation({ summary: 'Preview reconciliation — compare local vs cloud memories' })
  async preview(@Req() req: any) {
    return this.reconciliationService.reconcile(req.accountId);
  }

  @Post('execute')
  @HttpCode(200)
  @ApiOperation({ summary: 'Execute reconciliation — push local-only, pull cloud-only' })
  async execute(@Req() req: any) {
    const plan = await this.reconciliationService.reconcile(req.accountId);
    return this.reconciliationService.executeReconciliation(req.accountId, plan);
  }
}
