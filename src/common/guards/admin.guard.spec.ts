import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { AdminGuard } from './admin.guard';
import { PrismaService } from '../../prisma/prisma.service';
import { ForbiddenException, ExecutionContext } from '@nestjs/common';

const mockPrisma = {
  account: { findUnique: jest.fn() },
};

function createMockContext(overrides: {
  accountId?: string;
  isLanBypass?: boolean;
}): ExecutionContext {
  const request: Record<string, unknown> = {
    headers: {},
    accountId: overrides.accountId,
    isLanBypass: overrides.isLanBypass || false,
  };
  return {
    switchToHttp: () => ({
      getRequest: () => request,
    }),
  } as unknown as ExecutionContext;
}

describe('AdminGuard', () => {
  let guard: AdminGuard;
  let configGet: jest.Mock;

  beforeEach(async () => {
    jest.clearAllMocks();
    configGet = jest.fn((key: string, def?: string) => {
      if (key === 'EDITION') return 'cloud';
      if (key === 'LAN_BYPASS') return '';
      return def;
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminGuard,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ConfigService, useValue: { get: configGet } },
      ],
    }).compile();

    guard = module.get<AdminGuard>(AdminGuard);
  });

  describe('admin account', () => {
    it('should allow access for admin accounts', async () => {
      const ctx = createMockContext({ accountId: 'acc-1' });
      mockPrisma.account.findUnique.mockResolvedValue({ isAdmin: true });

      const result = await guard.canActivate(ctx);
      expect(result).toBe(true);
      expect(mockPrisma.account.findUnique).toHaveBeenCalledWith({
        where: { id: 'acc-1' },
        select: { isAdmin: true },
      });
    });

    it('should deny access for non-admin accounts', async () => {
      const ctx = createMockContext({ accountId: 'acc-2' });
      mockPrisma.account.findUnique.mockResolvedValue({ isAdmin: false });

      await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
      await expect(guard.canActivate(ctx)).rejects.toThrow(
        'Admin access required',
      );
    });

    it('should deny access when account not found', async () => {
      const ctx = createMockContext({ accountId: 'acc-404' });
      mockPrisma.account.findUnique.mockResolvedValue(null);

      await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
    });
  });

  describe('no authentication', () => {
    it('should throw ForbiddenException when no accountId', async () => {
      const ctx = createMockContext({});

      await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
      await expect(guard.canActivate(ctx)).rejects.toThrow(
        'Authentication required',
      );
    });
  });

  describe('LAN bypass', () => {
    it('should allow LAN bypass on local edition', async () => {
      configGet.mockImplementation((key: string) => {
        if (key === 'EDITION') return 'local';
        if (key === 'LAN_BYPASS') return '';
        return undefined;
      });
      const ctx = createMockContext({ isLanBypass: true });

      const result = await guard.canActivate(ctx);
      expect(result).toBe(true);
      expect(mockPrisma.account.findUnique).not.toHaveBeenCalled();
    });

    it('should allow LAN bypass when LAN_BYPASS env is true', async () => {
      configGet.mockImplementation((key: string) => {
        if (key === 'EDITION') return 'cloud';
        if (key === 'LAN_BYPASS') return 'true';
        return undefined;
      });
      const ctx = createMockContext({ isLanBypass: true });

      const result = await guard.canActivate(ctx);
      expect(result).toBe(true);
    });

    it('should NOT allow LAN bypass on cloud edition without LAN_BYPASS', async () => {
      const ctx = createMockContext({ isLanBypass: true });

      await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
      await expect(guard.canActivate(ctx)).rejects.toThrow(
        'Authentication required',
      );
    });

    it('should NOT allow LAN bypass when isLanBypass is false on local edition', async () => {
      configGet.mockImplementation((key: string) => {
        if (key === 'EDITION') return 'local';
        if (key === 'LAN_BYPASS') return '';
        return undefined;
      });
      const ctx = createMockContext({ isLanBypass: false });

      await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
    });
  });
});
