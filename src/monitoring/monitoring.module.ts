import { Global, Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { MonitoringService } from './monitoring.service';
import { MonitoringController } from './monitoring.controller';
import { MonitoringInterceptor } from './monitoring.interceptor';
import { AccountModule } from '../account/account.module';

@Global()
@Module({
  imports: [AccountModule, PrismaModule],
  controllers: [MonitoringController],
  providers: [
    MonitoringService,
    MonitoringInterceptor,
    { provide: 'MONITORING_SERVICE', useExisting: MonitoringService },
  ],
  exports: [MonitoringService, MonitoringInterceptor, 'MONITORING_SERVICE'],
})
export class MonitoringModule {}
