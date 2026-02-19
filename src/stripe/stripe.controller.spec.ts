import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { StripeController } from './stripe.controller';
import { StripeService } from './stripe.service';
import { AccountJwtGuard } from '../account/account.guard';

describe('StripeController', () => {
  let controller: StripeController;
  let stripeService: jest.Mocked<StripeService>;

  beforeEach(async () => {
    stripeService = {
      createCheckoutSession: jest.fn(),
      createPortalSession: jest.fn(),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      controllers: [StripeController],
      providers: [{ provide: StripeService, useValue: stripeService }],
    })
      .overrideGuard(AccountJwtGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<StripeController>(StripeController);
  });

  describe('createCheckout', () => {
    it('should create checkout session for valid STARTER plan', async () => {
      stripeService.createCheckoutSession.mockResolvedValue('https://checkout.stripe.com/123');
      const req = { accountId: 'acc-1' };

      const result = await controller.createCheckout(req, { plan: 'STARTER' });

      expect(result).toEqual({ url: 'https://checkout.stripe.com/123' });
      expect(stripeService.createCheckoutSession).toHaveBeenCalledWith('acc-1', 'STARTER');
    });

    it('should create checkout session for valid PRO plan', async () => {
      stripeService.createCheckoutSession.mockResolvedValue('https://checkout.stripe.com/456');
      const req = { accountId: 'acc-2' };

      const result = await controller.createCheckout(req, { plan: 'PRO' });

      expect(result).toEqual({ url: 'https://checkout.stripe.com/456' });
    });

    it('should create checkout session for valid SCALE plan', async () => {
      stripeService.createCheckoutSession.mockResolvedValue('https://checkout.stripe.com/789');
      const req = { accountId: 'acc-3' };

      const result = await controller.createCheckout(req, { plan: 'SCALE' });

      expect(result).toEqual({ url: 'https://checkout.stripe.com/789' });
    });

    it('should throw BadRequestException for invalid plan', async () => {
      const req = { accountId: 'acc-1' };

      await expect(
        controller.createCheckout(req, { plan: 'INVALID' as any }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException for empty plan', async () => {
      const req = { accountId: 'acc-1' };

      await expect(
        controller.createCheckout(req, { plan: '' as any }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should propagate service errors', async () => {
      stripeService.createCheckoutSession.mockRejectedValue(new Error('Stripe error'));
      const req = { accountId: 'acc-1' };

      await expect(
        controller.createCheckout(req, { plan: 'PRO' }),
      ).rejects.toThrow('Stripe error');
    });
  });

  describe('createPortal', () => {
    it('should create portal session', async () => {
      stripeService.createPortalSession.mockResolvedValue('https://billing.stripe.com/portal');
      const req = { accountId: 'acc-1' };

      const result = await controller.createPortal(req);

      expect(result).toEqual({ url: 'https://billing.stripe.com/portal' });
      expect(stripeService.createPortalSession).toHaveBeenCalledWith('acc-1');
    });

    it('should propagate service errors for portal', async () => {
      stripeService.createPortalSession.mockRejectedValue(
        new Error('No Stripe customer found. Subscribe to a plan first.'),
      );
      const req = { accountId: 'acc-1' };

      await expect(controller.createPortal(req)).rejects.toThrow('No Stripe customer found');
    });
  });
});
