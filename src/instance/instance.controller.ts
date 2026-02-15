import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { InstanceService, type InstanceInfo, type InstanceInfoDetailed } from './instance.service';
import { SkipRateLimit } from '../rate-limit/rate-limit.decorator';
import { ApiKeyOrJwtGuard } from '../common/guards/api-key-or-jwt.guard';

@ApiTags('instance')
@Controller()
@SkipRateLimit()
export class InstanceController {
  constructor(private readonly instanceService: InstanceService) {}

  @Get('v1/instance/info')
  @ApiOperation({
    summary: 'Instance info',
    description:
      'Returns deployment mode and feature flags. No authentication required.',
  })
  @ApiResponse({ status: 200, description: 'Instance information.' })
  async getInfo(): Promise<InstanceInfo> {
    return this.instanceService.getInfo();
  }

  @Get('v1/instance/info/detailed')
  @UseGuards(ApiKeyOrJwtGuard)
  @ApiOperation({
    summary: 'Detailed instance info',
    description:
      'Returns deployment mode, version, and feature flags. Requires authentication.',
  })
  @ApiResponse({ status: 200, description: 'Detailed instance information.' })
  async getDetailedInfo(): Promise<InstanceInfoDetailed> {
    return this.instanceService.getDetailedInfo();
  }
}
