import { UsageLimitGuard } from './usage-limit.guard';
import { ExecutionContext, HttpException } from '@nestjs/common';

describe('UsageLimitGuard', () => {
  let guard: UsageLimitGuard;
  let prisma: any;

  const mockContext = (
    accountId: string | null,
    method = 'GET',
    path = '/v1/account',
  ) => {
    const req = { accountId, method, path };
    return {
      switchToHttp: () => ({
        getRequest: () => req,
      }),
    } as unknown as ExecutionContext;
  };

  beforeEach(() => {
    prisma = {
      account: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
    };
    guard = new UsageLimitGuard(prisma);
  });

  it('should pass if no accountId', async () => {
    expect(await guard.canActivate(mockContext(null))).toBe(true);
  });

  it('should pass if account not found', async () => {
    prisma.account.findUnique.mockResolvedValue(null);
    expect(await guard.canActivate(mockContext('acc-1'))).toBe(true);
  });

  it('should increment apiCallsToday', async () => {
    prisma.account.findUnique.mockResolvedValue({
      id: 'acc-1',
      plan: 'FREE',
      apiCallsToday: 5,
      apiCallsResetAt: new Date(),
      memoriesUsed: 0,
    });
    prisma.account.update.mockResolvedValue({});

    await guard.canActivate(mockContext('acc-1'));
    expect(prisma.account.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { apiCallsToday: { increment: 1 } },
      }),
    );
  });

  it('should throw 429 when API call limit reached', async () => {
    prisma.account.findUnique.mockResolvedValue({
      id: 'acc-1',
      plan: 'FREE',
      apiCallsToday: 100,
      apiCallsResetAt: new Date(),
      memoriesUsed: 0,
    });

    await expect(guard.canActivate(mockContext('acc-1'))).rejects.toThrow(
      HttpException,
    );
  });

  it('should throw 429 when memory limit reached on POST /memories', async () => {
    prisma.account.findUnique.mockResolvedValue({
      id: 'acc-1',
      plan: 'FREE',
      apiCallsToday: 5,
      apiCallsResetAt: new Date(),
      memoriesUsed: 1000,
    });
    prisma.account.update.mockResolvedValue({});

    await expect(
      guard.canActivate(mockContext('acc-1', 'POST', '/v1/memories')),
    ).rejects.toThrow(HttpException);
  });

  it('should reset daily counter on new day', async () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);

    prisma.account.findUnique.mockResolvedValue({
      id: 'acc-1',
      plan: 'FREE',
      apiCallsToday: 99,
      apiCallsResetAt: yesterday,
      memoriesUsed: 0,
    });
    prisma.account.update.mockResolvedValue({});

    const result = await guard.canActivate(mockContext('acc-1'));
    expect(result).toBe(true);
    // First call resets, second increments
    expect(prisma.account.update).toHaveBeenCalledTimes(2);
  });
});
