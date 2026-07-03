import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { StripeService } from './stripe.service';
import { PrismaService } from '../prisma/prisma.service';
import { Plan } from '@prisma/client';

// Mock Stripe
const mockStripe = {
  customers: { create: jest.fn() },
  checkout: { sessions: { create: jest.fn() } },
  billingPortal: { sessions: { create: jest.fn() } },
  products: { list: jest.fn(), create: jest.fn() },
  prices: { list: jest.fn(), create: jest.fn(), retrieve: jest.fn() },
  subscriptions: { retrieve: jest.fn() },
  webhooks: { constructEvent: jest.fn() },
};

jest.mock('stripe', () => {
  return jest.fn().mockImplementation(() => mockStripe);
});

describe('StripeService', () => {
  let service: StripeService;
  let prisma: any;

  const mockAccount = {
    id: 'acc_123',
    email: 'test@example.com',
    stripeCustomerId: null,
    plan: Plan.FREE,
  };

  beforeEach(async () => {
    prisma = {
      account: {
        findUniqueOrThrow: jest.fn().mockResolvedValue(mockAccount),
        update: jest.fn().mockResolvedValue(mockAccount),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StripeService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, def?: string) => {
              const map: Record<string, string> = {
                STRIPE_SECRET_KEY: 'sk_test_123',
                STRIPE_WEBHOOK_SECRET: 'whsec_test_123',
                FRONTEND_URL: 'http://localhost:3000',
              };
              return map[key] ?? def;
            }),
          },
        },
      ],
    }).compile();

    service = module.get<StripeService>(StripeService);
    // Manually set priceMap since we skip onModuleInit
    (service as any).priceMap = {
      STARTER: 'price_starter',
      PRO: 'price_pro',
      SCALE: 'price_scale',
    };
  });

  afterEach(() => jest.clearAllMocks());

  describe('createCheckoutSession', () => {
    it('creates a customer if account has none, then creates checkout session', async () => {
      mockStripe.customers.create.mockResolvedValue({ id: 'cus_new' });
      mockStripe.checkout.sessions.create.mockResolvedValue({
        url: 'https://checkout.stripe.com/session123',
      });

      const url = await service.createCheckoutSession('acc_123', 'STARTER');

      expect(mockStripe.customers.create).toHaveBeenCalledWith({
        email: 'test@example.com',
        metadata: { accountId: 'acc_123' },
      });
      expect(prisma.account.update).toHaveBeenCalledWith({
        where: { id: 'acc_123' },
        data: { stripeCustomerId: 'cus_new' },
      });
      expect(mockStripe.checkout.sessions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          customer: 'cus_new',
          mode: 'subscription',
          line_items: [{ price: 'price_starter', quantity: 1 }],
        }),
      );
      expect(url).toBe('https://checkout.stripe.com/session123');
    });

    it('reuses existing stripeCustomerId', async () => {
      prisma.account.findUniqueOrThrow.mockResolvedValue({
        ...mockAccount,
        stripeCustomerId: 'cus_existing',
      });
      mockStripe.checkout.sessions.create.mockResolvedValue({
        url: 'https://checkout.stripe.com/x',
      });

      await service.createCheckoutSession('acc_123', 'PRO');

      expect(mockStripe.customers.create).not.toHaveBeenCalled();
      expect(mockStripe.checkout.sessions.create).toHaveBeenCalledWith(
        expect.objectContaining({ customer: 'cus_existing' }),
      );
    });

    it('throws on unknown plan', async () => {
      await expect(
        service.createCheckoutSession('acc_123', 'INVALID'),
      ).rejects.toThrow('Unknown plan');
    });
  });

  describe('createPortalSession', () => {
    it('creates portal session for customer', async () => {
      prisma.account.findUniqueOrThrow.mockResolvedValue({
        ...mockAccount,
        stripeCustomerId: 'cus_123',
      });
      mockStripe.billingPortal.sessions.create.mockResolvedValue({
        url: 'https://billing.stripe.com/portal',
      });

      const url = await service.createPortalSession('acc_123');

      expect(url).toBe('https://billing.stripe.com/portal');
    });

    it('throws if no stripeCustomerId', async () => {
      await expect(service.createPortalSession('acc_123')).rejects.toThrow(
        'No Stripe customer found',
      );
    });
  });

  describe('handleWebhookEvent', () => {
    it('handles checkout.session.completed — upgrades plan', async () => {
      mockStripe.webhooks.constructEvent.mockReturnValue({
        type: 'checkout.session.completed',
        data: { object: { customer: 'cus_123', subscription: 'sub_123' } },
      });
      mockStripe.subscriptions.retrieve.mockResolvedValue({
        customer: 'cus_123',
        current_period_end: Math.floor(Date.now() / 1000) + 86400 * 30,
        items: { data: [{ price: { id: 'price_pro' } }] },
      });
      mockStripe.prices.retrieve.mockResolvedValue({
        id: 'price_pro',
        metadata: { plan: 'PRO' },
      });

      await service.handleWebhookEvent(Buffer.from('body'), 'sig');

      expect(prisma.account.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { stripeCustomerId: 'cus_123' },
          data: expect.objectContaining({ plan: Plan.PRO }),
        }),
      );
    });

    it('handles customer.subscription.deleted — downgrades to FREE', async () => {
      mockStripe.webhooks.constructEvent.mockReturnValue({
        type: 'customer.subscription.deleted',
        data: { object: { customer: 'cus_123' } },
      });

      await service.handleWebhookEvent(Buffer.from('body'), 'sig');

      expect(prisma.account.updateMany).toHaveBeenCalledWith({
        where: { stripeCustomerId: 'cus_123' },
        data: { plan: Plan.FREE, planExpiresAt: null },
      });
    });

    it('handles invoice.payment_failed — logs warning only', async () => {
      mockStripe.webhooks.constructEvent.mockReturnValue({
        type: 'invoice.payment_failed',
        data: { object: { customer: 'cus_456' } },
      });

      await service.handleWebhookEvent(Buffer.from('body'), 'sig');

      expect(prisma.account.updateMany).not.toHaveBeenCalled();
    });

    it('throws on invalid signature', async () => {
      mockStripe.webhooks.constructEvent.mockImplementation(() => {
        throw new Error('Invalid signature');
      });

      await expect(
        service.handleWebhookEvent(Buffer.from('body'), 'bad_sig'),
      ).rejects.toThrow('Invalid signature');
    });
  });
});
