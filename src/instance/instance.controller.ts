import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { InstanceService, type InstanceInfo } from './instance.service';
import { SkipRateLimit } from '../rate-limit/rate-limit.decorator';

@ApiTags('instance')
@Controller()
@SkipRateLimit()
export class InstanceController {
  constructor(private readonly instanceService: InstanceService) {}

  @Get('v1/instance/info')
  @ApiOperation({
    summary: 'Instance info',
    description:
      'Returns deployment mode, version, and feature flags. No authentication required.',
  })
  @ApiResponse({ status: 200, description: 'Instance information.' })
  async getInfo(): Promise<InstanceInfo> {
    return this.instanceService.getInfo();
  }
}
