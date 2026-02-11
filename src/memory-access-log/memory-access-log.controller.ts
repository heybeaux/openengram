import { Controller, Get, Param } from '@nestjs/common';
import { MemoryAccessLogService } from './memory-access-log.service';

@Controller('v1')
export class MemoryAccessLogController {
  constructor(private readonly accessLogService: MemoryAccessLogService) {}

  @Get('memories/:id/attribution')
  async getAttribution(@Param('id') id: string) {
    return this.accessLogService.getAttribution(id);
  }

  @Get('agent-sessions/:key/summary')
  async getSessionSummary(@Param('key') key: string) {
    return this.accessLogService.getSessionSummary(key);
  }
}
