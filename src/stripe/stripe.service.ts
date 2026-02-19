import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { Plan } from '@prisma/client';
import Stripe from 'stripe';

const PLAN_PRICES: Record<
  string,
  { plan: Plan; amount: number; name: string }
> = {
  STARTER: { plan: Plan.STARTER, amount: 900, name: 'Engram Starter' },
  PRO: { plan: Plan.PRO, amount: 3900, name: 'Engram Pro' },
  SCALE: { plan: Plan.SCALE, amount: 9900, name: 'Engram Scale' },
};

@Injectable()
export class StripeService implements OnModuleInit {
  private readonly logger = new Logger(StripeService.name);
  readonly stripe: Stripe | null;
  private priceMap: Record<string, string> = {}; // plan -> priceId
  private readonly frontendUrl: string;

  constructor(
    private config: ConfigService,
    private prisma: PrismaService,
  ) {
    const stripeKey = this.config.get<string>('STRIPE_SECRET_KEY');
    this.stripe = stripeKey
      ? new Stripe(stripeKey, { apiVersion: '2025-01-27.acacia' as any })
      : null;
    this.frontendUrl = this.config.get<string>(
      'FRONTEND_URL',
      'http://localhost:3000',
    );
  }

  async onModuleInit() {
    if (!this.stripe) {
      this.logger.warn(
        'STRIPE_SECRET_KEY not set — Stripe integration disabled',
      );
      return;
    }
    await this.ensureProductsAndPrices();
  }

  private requireStripe(): Stripe {
    if (!this.stripe) {
      throw new Error('Stripe is not configured — set STRIPE_SECRET_KEY');
    }
    return this.stripe;
  }

  private async ensureProductsAndPrices() {
    // Look for existing products with our metadata
    const products = await this.requireStripe().products.list({
      limit: 100,
      active: true,
    });

    for (const [key, config] of Object.entries(PLAN_PRICES)) {
      let product = products.data.find((p) => p.metadata?.plan === key);
      if (!product) {
        product = await this.requireStripe().products.create({
          name: config.name,
          metadata: { plan: key },
        });
        this.logger.log(`Created Stripe product: ${config.name}`);
      }

      // Find or create price
      const prices = await this.requireStripe().prices.list({
        product: product.id,
        active: true,
        limit: 10,
      });
      let price = prices.data.find(
        (p) =>
          p.unit_amount === config.amount && p.recurring?.interval === 'month',
      );
      if (!price) {
        price = await this.requireStripe().prices.create({
          product: product.id,
          unit_amount: config.amount,
          currency: 'usd',
          recurring: { interval: 'month' },
          metadata: { plan: key },
        });
        this.logger.log(
          `Created Stripe price: ${config.name} $${config.amount / 100}/mo`,
        );
      }

      this.priceMap[key] = price.id;
    }

    this.logger.log('Stripe products/prices synced');
  }

  async createCheckoutSession(
    accountId: string,
    plan: string,
  ): Promise<string> {
    const priceId = this.priceMap[plan];
    if (!priceId) throw new Error(`Unknown plan: ${plan}`);

    const account = await this.prisma.account.findUniqueOrThrow({
      where: { id: accountId },
    });

    let customerId = account.stripeCustomerId;
    if (!customerId) {
      const customer = await this.requireStripe().customers.create({
        email: account.email,
        metadata: { accountId: account.id },
      });
      customerId = customer.id;
      await this.prisma.account.update({
        where: { id: accountId },
        data: { stripeCustomerId: customerId },
      });
    }

    const session = await this.requireStripe().checkout.sessions.create({
      customer: customerId,
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${this.frontendUrl}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${this.frontendUrl}/billing/cancel`,
    });

    return session.url!;
  }

  async createPortalSession(accountId: string): Promise<string> {
    const account = await this.prisma.account.findUniqueOrThrow({
      where: { id: accountId },
    });

    if (!account.stripeCustomerId) {
      throw new Error('No Stripe customer found. Subscribe to a plan first.');
    }

    const session = await this.requireStripe().billingPortal.sessions.create({
      customer: account.stripeCustomerId,
      return_url: `${this.frontendUrl}/billing`,
    });

    return session.url;
  }

  async handleWebhookEvent(rawBody: Buffer, signature: string) {
    const webhookSecret = this.config.get<string>('STRIPE_WEBHOOK_SECRET', '');
    const event = this.requireStripe().webhooks.constructEvent(
      rawBody,
      signature,
      webhookSecret,
    );

    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        if (session.customer) {
          await this.syncSubscription(
            session.customer as string,
            session.subscription as string,
          );
        }
        break;
      }
      case 'customer.subscription.updated': {
        const sub = event.data.object;
        await this.syncSubscriptionFromObject(sub);
        break;
      }
      case 'customer.subscription.deleted': {
        const sub = event.data.object;
        const customerId =
          typeof sub.customer === 'string'
            ? sub.customer
            : (sub.customer?.id ?? 'unknown');
        await this.prisma.account.updateMany({
          where: { stripeCustomerId: customerId },
          data: { plan: Plan.FREE, planExpiresAt: null },
        });
        this.logger.log(
          `Subscription deleted for customer ${customerId} — downgraded to FREE`,
        );
        break;
      }
      case 'invoice.payment_failed': {
        const invoice = event.data.object;
        const invoiceCustomerId =
          typeof invoice.customer === 'string'
            ? invoice.customer
            : (invoice.customer?.id ?? 'unknown');
        this.logger.warn(`Payment failed for customer ${invoiceCustomerId}`);
        break;
      }
      default:
        this.logger.debug(`Unhandled Stripe event: ${event.type}`);
    }
  }

  private async syncSubscription(customerId: string, subscriptionId: string) {
    const sub = await this.requireStripe().subscriptions.retrieve(subscriptionId);
    await this.syncSubscriptionFromObject(sub);
  }

  private async syncSubscriptionFromObject(sub: Stripe.Subscription) {
    const customerId = sub.customer as string;
    const priceId = sub.items.data[0]?.price?.id;
    if (!priceId) return;

    // Look up plan from price metadata
    const price = await this.requireStripe().prices.retrieve(priceId);
    const planKey = price.metadata?.plan as Plan | undefined;
    if (!planKey || !Object.values(Plan).includes(planKey)) {
      this.logger.warn(
        `Unknown plan in price metadata: ${price.metadata?.plan}`,
      );
      return;
    }

    const periodEnd = new Date((sub as any).current_period_end * 1000);

    await this.prisma.account.updateMany({
      where: { stripeCustomerId: customerId },
      data: { plan: planKey, planExpiresAt: periodEnd },
    });

    this.logger.log(
      `Synced subscription for customer ${customerId} → ${planKey}`,
    );
  }
}
