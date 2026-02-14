import { Controller, Post, Req, Res, Headers, HttpCode } from '@nestjs/common';
import { StripeService } from './stripe.service.js';
import type { Request, Response } from 'express';

@Controller('v1/billing')
export class StripeWebhookController {
  constructor(private stripeService: StripeService) {}

  @Post('webhooks')
  @HttpCode(200)
  async handleWebhook(
    @Req() req: Request,
    @Headers('stripe-signature') signature: string,
    @Res() res: Response,
  ) {
    const rawBody = (req as any).rawBody as Buffer;
    if (!rawBody) {
      res.status(400).json({ error: 'Missing raw body' });
      return;
    }
    if (!signature) {
      res.status(400).json({ error: 'Missing stripe-signature header' });
      return;
    }

    try {
      await this.stripeService.handleWebhookEvent(rawBody, signature);
      res.json({ received: true });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  }
}
