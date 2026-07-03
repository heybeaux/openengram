import { HttpException } from '@nestjs/common';
import { UsageLimitMiddleware } from './usage-limit.middleware';
import { PrismaService } from '../../prisma/prisma.service';

// Mock PLAN_LIMITS
jest.mock('../../account/plan-limits.js', () => ({
  PLAN_LIMITS: {
    free: { apiCallsPerDay: 100, memories: 1000 },
    pro: { apiCallsPerDay: 10000, memories: 100000 },
    enterprise: { apiCallsPerDay: -1, memories: -1 },
  },
}));

const mockPrisma = {
  account: { findUnique: jest.fn() },
  $queryRaw: jest.fn(),
};

function createReqResNext(overrides: {
  agent?: any;
  method?: string;
  path?: string;
}) {
  const req = {
    agent: overrides.agent ?? null,
    method: overrides.method ?? 'GET',
    path: overrides.path ?? '/v1/memories',
  } as any;
  const res = {} as any;
  const next = jest.fn();
  return { req, res, next };
}

describe('UsageLimitMiddleware', () => {
  let middleware: UsageLimitMiddleware;

  beforeEach(() => {
    jest.clearAllMocks();
    middleware = new UsageLimitMiddleware(
      mockPrisma as unknown as PrismaService,
    );
  });

  // =========================================================================
  // No account (self-hosted) — pass through
  // =========================================================================

  it('should pass through when agent has no accountId', async () => {
    const { req, res, next } = createReqResNext({ agent: { id: 'a' } });
    await middleware.use(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('should pass through when no agent on request', async () => {
    const { req, res, next } = createReqResNext({ agent: null });
    await middleware.use(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('should pass through when account not found in DB', async () => {
    mockPrisma.account.findUnique.mockResolvedValue(null);
    const { req, res, next } = createReqResNext({
      agent: { id: 'a', accountId: 'acc-1' },
    });
    await middleware.use(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  // =========================================================================
  // API call limits
  // =========================================================================

  it('should allow request within daily limit', async () => {
    mockPrisma.account.findUnique.mockResolvedValue({
      id: 'acc-1',
      plan: 'free',
      memoriesUsed: 50,
    });
    mockPrisma.$queryRaw.mockResolvedValue([
      { api_calls_today: 50, memories_used: 50 },
    ]);

    const { req, res, next } = createReqResNext({
      agent: { id: 'a', accountId: 'acc-1' },
    });
    await middleware.use(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(req.account).toBeDefined();
  });

  it('should throw 429 when daily API limit exceeded', async () => {
    mockPrisma.account.findUnique.mockResolvedValue({
      id: 'acc-1',
      plan: 'free',
    });
    mockPrisma.$queryRaw.mockResolvedValue([
      { api_calls_today: 101, memories_used: 50 },
    ]);

    const { req, res, next } = createReqResNext({
      agent: { id: 'a', accountId: 'acc-1' },
    });

    await expect(middleware.use(req, res, next)).rejects.toThrow(HttpException);
    await expect(middleware.use(req, res, next)).rejects.toThrow(
      /Daily API call limit reached/,
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('should not limit enterprise plan (apiCallsPerDay = -1)', async () => {
    mockPrisma.account.findUnique.mockResolvedValue({
      id: 'acc-1',
      plan: 'enterprise',
    });
    mockPrisma.$queryRaw.mockResolvedValue([
      { api_calls_today: 999999, memories_used: 999999 },
    ]);

    const { req, res, next } = createReqResNext({
      agent: { id: 'a', accountId: 'acc-1' },
    });
    await middleware.use(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  // =========================================================================
  // Memory limits
  // =========================================================================

  it('should throw 429 when memory limit reached on POST /memories', async () => {
    mockPrisma.account.findUnique.mockResolvedValue({
      id: 'acc-1',
      plan: 'free',
      memoriesUsed: 1000,
    });
    mockPrisma.$queryRaw.mockResolvedValue([
      { api_calls_today: 1, memories_used: 1000 },
    ]);

    const { req, res, next } = createReqResNext({
      agent: { id: 'a', accountId: 'acc-1' },
      method: 'POST',
      path: '/v1/memories',
    });

    await expect(middleware.use(req, res, next)).rejects.toThrow(
      /Memory limit reached/,
    );
  });

  it('should not check memory limit on GET requests', async () => {
    mockPrisma.account.findUnique.mockResolvedValue({
      id: 'acc-1',
      plan: 'free',
      memoriesUsed: 1000,
    });
    mockPrisma.$queryRaw.mockResolvedValue([
      { api_calls_today: 1, memories_used: 1000 },
    ]);

    const { req, res, next } = createReqResNext({
      agent: { id: 'a', accountId: 'acc-1' },
      method: 'GET',
      path: '/v1/memories',
    });
    await middleware.use(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('should not check memory limit on non-memory POST endpoints', async () => {
    mockPrisma.account.findUnique.mockResolvedValue({
      id: 'acc-1',
      plan: 'free',
      memoriesUsed: 1000,
    });
    mockPrisma.$queryRaw.mockResolvedValue([
      { api_calls_today: 1, memories_used: 1000 },
    ]);

    const { req, res, next } = createReqResNext({
      agent: { id: 'a', accountId: 'acc-1' },
      method: 'POST',
      path: '/v1/search',
    });
    await middleware.use(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('should not limit enterprise memory (memories = -1)', async () => {
    mockPrisma.account.findUnique.mockResolvedValue({
      id: 'acc-1',
      plan: 'enterprise',
    });
    mockPrisma.$queryRaw.mockResolvedValue([
      { api_calls_today: 1, memories_used: 999999 },
    ]);

    const { req, res, next } = createReqResNext({
      agent: { id: 'a', accountId: 'acc-1' },
      method: 'POST',
      path: '/v1/memories',
    });
    await middleware.use(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  // =========================================================================
  // Edge cases
  // =========================================================================

  it('should use memoriesUsed from account when query returns null', async () => {
    mockPrisma.account.findUnique.mockResolvedValue({
      id: 'acc-1',
      plan: 'free',
      memoriesUsed: 999,
    });
    mockPrisma.$queryRaw.mockResolvedValue([
      { api_calls_today: 1, memories_used: null },
    ]);

    const { req, res, next } = createReqResNext({
      agent: { id: 'a', accountId: 'acc-1' },
      method: 'POST',
      path: '/v1/memories',
    });
    await middleware.use(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('should handle empty query result gracefully', async () => {
    mockPrisma.account.findUnique.mockResolvedValue({
      id: 'acc-1',
      plan: 'free',
      memoriesUsed: 0,
    });
    mockPrisma.$queryRaw.mockResolvedValue([]);

    const { req, res, next } = createReqResNext({
      agent: { id: 'a', accountId: 'acc-1' },
    });
    await middleware.use(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('should attach account to request for downstream use', async () => {
    const account = { id: 'acc-1', plan: 'pro', memoriesUsed: 50 };
    mockPrisma.account.findUnique.mockResolvedValue(account);
    mockPrisma.$queryRaw.mockResolvedValue([
      { api_calls_today: 1, memories_used: 50 },
    ]);

    const { req, res, next } = createReqResNext({
      agent: { id: 'a', accountId: 'acc-1' },
    });
    await middleware.use(req, res, next);
    expect(req.account).toEqual(account);
  });

  it('should include plan name in error message', async () => {
    mockPrisma.account.findUnique.mockResolvedValue({
      id: 'acc-1',
      plan: 'free',
    });
    mockPrisma.$queryRaw.mockResolvedValue([
      { api_calls_today: 101, memories_used: 0 },
    ]);

    const { req, res, next } = createReqResNext({
      agent: { id: 'a', accountId: 'acc-1' },
    });

    try {
      await middleware.use(req, res, next);
      fail('Should have thrown');
    } catch (e: any) {
      expect(e.getStatus()).toBe(429);
      expect(e.getResponse().message).toContain('free plan');
    }
  });
});
