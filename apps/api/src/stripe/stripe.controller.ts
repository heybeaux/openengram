import {
  Controller,
  Post,
  Get,
  Body,
  Req,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { AccountJwtGuard } from '../account/account.guard.js';
import { StripeService } from './stripe.service.js';

@Controller('v1/billing')
export class StripeController {
  constructor(private stripeService: StripeService) {}

  @Post('checkout')
  @UseGuards(AccountJwtGuard)
  async createCheckout(
    @Req() req: any,
    @Body() body: { plan: 'STARTER' | 'PRO' | 'SCALE' },
  ) {
    if (!['STARTER', 'PRO', 'SCALE'].includes(body.plan)) {
      throw new BadRequestException(
        'Invalid plan. Must be STARTER, PRO, or SCALE.',
      );
    }
    const url = await this.stripeService.createCheckoutSession(
      req.accountId,
      body.plan,
    );
    return { url };
  }

  @Get('portal')
  @UseGuards(AccountJwtGuard)
  async createPortal(@Req() req: any) {
    const url = await this.stripeService.createPortalSession(req.accountId);
    return { url };
  }
}
