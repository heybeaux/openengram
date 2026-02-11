import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  MonitoringService,
  MonitoringMetrics,
  MonitoringAlert,
} from './monitoring.service';
import { SkipRateLimit } from '../rate-limit/rate-limit.decorator';

@ApiTags('Monitoring')
@Controller('v1/monitoring')
@SkipRateLimit()
export class MonitoringController {
  constructor(private readonly monitoringService: MonitoringService) {}

  /**
   * GET /v1/monitoring/status
   * Returns all current monitoring metrics
   */
  @Get('status')
  async getStatus(): Promise<MonitoringMetrics> {
    return this.monitoringService.getMetrics();
  }

  /**
   * GET /v1/monitoring/alerts
   * Returns any active alerts
   */
  @Get('alerts')
  async getAlerts(): Promise<{ alerts: MonitoringAlert[]; count: number }> {
    const alerts = await this.monitoringService.getAlerts();
    return { alerts, count: alerts.length };
  }
}
