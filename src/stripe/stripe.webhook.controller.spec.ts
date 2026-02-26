import { Test, TestingModule } from '@nestjs/testing';
import { StripeWebhookController } from './stripe.webhook.controller';
import { StripeService } from './stripe.service';

describe('StripeWebhookController', () => {
  let controller: StripeWebhookController;
  let stripeService: jest.Mocked<StripeService>;

  beforeEach(async () => {
    stripeService = {
      handleWebhookEvent: jest.fn(),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      controllers: [StripeWebhookController],
      providers: [{ provide: StripeService, useValue: stripeService }],
    }).compile();

    controller = module.get<StripeWebhookController>(StripeWebhookController);
  });

  const mockRes = () => {
    const res: any = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    return res;
  };

  describe('handleWebhook', () => {
    it('should return 400 if rawBody is missing', async () => {
      const req = {} as any; // no rawBody
      const res = mockRes();

      await controller.handleWebhook(req, 'sig_123', res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ error: 'Missing raw body' });
    });

    it('should return 400 if stripe-signature is missing', async () => {
      const req = { rawBody: Buffer.from('test') } as any;
      const res = mockRes();

      await controller.handleWebhook(req, '', res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Missing stripe-signature header',
      });
    });

    it('should return 400 if signature is undefined', async () => {
      const req = { rawBody: Buffer.from('test') } as any;
      const res = mockRes();

      await controller.handleWebhook(req, undefined as any, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Missing stripe-signature header',
      });
    });

    it('should process valid webhook and return received:true', async () => {
      const rawBody = Buffer.from('{"type":"checkout.session.completed"}');
      const req = { rawBody } as any;
      const res = mockRes();
      stripeService.handleWebhookEvent.mockResolvedValue(undefined);

      await controller.handleWebhook(req, 'sig_valid', res);

      expect(stripeService.handleWebhookEvent).toHaveBeenCalledWith(
        rawBody,
        'sig_valid',
      );
      expect(res.json).toHaveBeenCalledWith({ received: true });
    });

    it('should return 400 if service throws (invalid signature)', async () => {
      const rawBody = Buffer.from('test');
      const req = { rawBody } as any;
      const res = mockRes();
      stripeService.handleWebhookEvent.mockRejectedValue(
        new Error('Webhook signature verification failed'),
      );

      await controller.handleWebhook(req, 'sig_invalid', res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Webhook signature verification failed',
      });
    });
  });
});
