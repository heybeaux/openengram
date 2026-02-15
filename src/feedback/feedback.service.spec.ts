import { Test, TestingModule } from '@nestjs/testing';
import { FeedbackService } from './feedback.service';
import { PrismaService } from '../prisma/prisma.service';

describe('FeedbackService', () => {
  let service: FeedbackService;
  let prisma: jest.Mocked<PrismaService>;

  const mockPrisma = {
    uxFeedback: {
      create: jest.fn(),
      findMany: jest.fn(),
    },
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FeedbackService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<FeedbackService>(FeedbackService);
    prisma = module.get(PrismaService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    it('should create feedback with all fields', async () => {
      const dto = {
        rating: 8,
        text: 'Great product!',
        category: 'general' as const,
        page: '/dashboard',
      };
      const expected = { id: 'fb-1', ...dto, accountId: 'acc-1', createdAt: new Date() };
      mockPrisma.uxFeedback.create.mockResolvedValue(expected);

      const result = await service.create('acc-1', dto);

      expect(result).toEqual(expected);
      expect(mockPrisma.uxFeedback.create).toHaveBeenCalledWith({
        data: {
          accountId: 'acc-1',
          rating: 8,
          text: 'Great product!',
          category: 'general',
          page: '/dashboard',
        },
      });
    });

    it('should create feedback with optional fields omitted', async () => {
      const dto = { rating: 5, category: 'nps' as const };
      const expected = { id: 'fb-2', ...dto, accountId: 'acc-1', createdAt: new Date() };
      mockPrisma.uxFeedback.create.mockResolvedValue(expected);

      const result = await service.create('acc-1', dto);

      expect(result).toEqual(expected);
      expect(mockPrisma.uxFeedback.create).toHaveBeenCalledWith({
        data: {
          accountId: 'acc-1',
          rating: 5,
          text: undefined,
          category: 'nps',
          page: undefined,
        },
      });
    });
  });

  describe('findByAccount', () => {
    it('should return feedback for an account with default limit', async () => {
      const feedbacks = [
        { id: 'fb-1', accountId: 'acc-1', rating: 8, category: 'general', createdAt: new Date() },
      ];
      mockPrisma.uxFeedback.findMany.mockResolvedValue(feedbacks);

      const result = await service.findByAccount('acc-1');

      expect(result).toEqual(feedbacks);
      expect(mockPrisma.uxFeedback.findMany).toHaveBeenCalledWith({
        where: { accountId: 'acc-1' },
        orderBy: { createdAt: 'desc' },
        take: 50,
      });
    });

    it('should respect custom limit', async () => {
      mockPrisma.uxFeedback.findMany.mockResolvedValue([]);

      await service.findByAccount('acc-1', 10);

      expect(mockPrisma.uxFeedback.findMany).toHaveBeenCalledWith({
        where: { accountId: 'acc-1' },
        orderBy: { createdAt: 'desc' },
        take: 10,
      });
    });
  });
});
