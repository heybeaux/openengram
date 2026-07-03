import { Module } from '@nestjs/common';
import { StripeService } from './stripe.service.js';
import { StripeController } from './stripe.controller.js';
import { StripeWebhookController } from './stripe.webhook.controller.js';
import { AccountModule } from '../account/account.module.js';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [AccountModule, PrismaModule],
  controllers: [StripeController, StripeWebhookController],
  providers: [StripeService],
  exports: [StripeService],
})
export class StripeModule {}
