import { Module } from '@nestjs/common';
import { ServicePrismaService } from './service-prisma.service';

@Module({
  providers: [ServicePrismaService],
  exports: [ServicePrismaService],
})
export class ServicePrismaModule {}
