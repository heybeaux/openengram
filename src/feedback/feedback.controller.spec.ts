import { Test, TestingModule } from '@nestjs/testing';
import { FeedbackController } from './feedback.controller';
import { FeedbackService } from './feedback.service';
import { AccountJwtGuard } from '../account/account.guard';
import { RateLimitGuard } from '../rate-limit/rate-limit.guard';

describe('FeedbackController', () => {
  let controller: FeedbackController;

  const mockFeedbackService = {
    create: jest.fn(),
    findByAccount: jest.fn(),
  };

  const mockGuard = { canActivate: jest.fn().mockReturnValue(true) };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [FeedbackController],
      providers: [{ provide: FeedbackService, useValue: mockFeedbackService }],
    })
      .overrideGuard(AccountJwtGuard)
      .useValue(mockGuard)
      .overrideGuard(RateLimitGuard)
      .useValue(mockGuard)
      .compile();

    controller = module.get<FeedbackController>(FeedbackController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('create', () => {
    it('should create feedback and return id + status', async () => {
      const dto = { rating: 9, text: 'Love it', category: 'feature' as const };
      const req = { accountId: 'acc-1' };
      mockFeedbackService.create.mockResolvedValue({
        id: 'fb-123',
        accountId: 'acc-1',
        ...dto,
        createdAt: new Date(),
      });

      const result = await controller.create(req, dto);

      expect(result).toEqual({ id: 'fb-123', status: 'received' });
      expect(mockFeedbackService.create).toHaveBeenCalledWith('acc-1', dto);
    });
  });
});
