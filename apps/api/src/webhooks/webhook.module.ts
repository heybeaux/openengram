import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../prisma/prisma.module';
import { WebhookController } from './webhook.controller';
import { WebhookService } from './webhook.service';
import { WebhookDeliveryService } from './webhook-delivery.service';

@Module({
  imports: [ConfigModule, PrismaModule],
  controllers: [WebhookController],
  providers: [WebhookService, WebhookDeliveryService],
  exports: [WebhookService, WebhookDeliveryService],
})
export class WebhookModule {}
