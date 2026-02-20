import {
  Controller,
  Post,
  Body,
  UseGuards,
  HttpCode,
  Req,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { ApiKeyOrJwtGuard } from '../common/guards/api-key-or-jwt.guard';
import { ReconciliationService } from './reconciliation.service';

class ReconcileRequestDto {
  /** Strategy: 'local-wins' | 'cloud-wins' | 'newest-wins' */
  strategy?: string;
}

@ApiTags('cloud')
@Controller('v1/cloud/reconcile')
@UseGuards(ApiKeyOrJwtGuard)
@ApiBearerAuth()
export class ReconciliationController {
  constructor(private readonly reconciliationService: ReconciliationService) {}

  @Post('preview')
  @HttpCode(200)
  @ApiOperation({ summary: 'Preview sync reconciliation — show conflicts without resolving' })
  async preview(@Req() req: any) {
    return this.reconciliationService.preview(req.accountId);
  }

  @Post('execute')
  @HttpCode(200)
  @ApiOperation({ summary: 'Execute sync reconciliation — resolve conflicts' })
  async execute(@Req() req: any, @Body() dto: ReconcileRequestDto) {
    return this.reconciliationService.execute(req.accountId, dto.strategy || 'newest-wins');
  }
}
