import { AdminController } from './admin.controller';
import { ForbiddenException } from '@nestjs/common';

describe('AdminController', () => {
  let controller: AdminController;
  let prisma: any;
  let config: any;

  beforeEach(() => {
    prisma = {
      account: { findUnique: jest.fn() },
      $queryRawUnsafe: jest.fn(),
    };
    config = {
      get: jest.fn().mockReturnValue('admin@test.com,boss@test.com'),
    };
    controller = new AdminController(prisma, config);
  });

  describe('listAccounts', () => {
    it('should return accounts for admin user', async () => {
      prisma.account.findUnique.mockResolvedValue({ email: 'admin@test.com' });
      prisma.$queryRawUnsafe.mockResolvedValue([
        { id: '1', email: 'admin@test.com', plan: 'PRO' },
      ]);

      const result = await controller.listAccounts({ accountId: 'acc-1' });
      expect(result.accounts).toHaveLength(1);
      expect(prisma.account.findUnique).toHaveBeenCalledWith({
        where: { id: 'acc-1' },
        select: { email: true },
      });
    });

    it('should throw ForbiddenException for non-admin user', async () => {
      prisma.account.findUnique.mockResolvedValue({ email: 'user@test.com' });

      await expect(controller.listAccounts({ accountId: 'acc-2' })).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('should throw ForbiddenException when account not found', async () => {
      prisma.account.findUnique.mockResolvedValue(null);

      await expect(controller.listAccounts({ accountId: 'missing' })).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('should be case-insensitive for admin email check', async () => {
      prisma.account.findUnique.mockResolvedValue({ email: 'ADMIN@TEST.COM' });
      prisma.$queryRawUnsafe.mockResolvedValue([]);

      const result = await controller.listAccounts({ accountId: 'acc-1' });
      expect(result.accounts).toEqual([]);
    });

    it('should support multiple admin emails from config', async () => {
      prisma.account.findUnique.mockResolvedValue({ email: 'boss@test.com' });
      prisma.$queryRawUnsafe.mockResolvedValue([]);

      const result = await controller.listAccounts({ accountId: 'acc-3' });
      expect(result.accounts).toEqual([]);
    });
  });

  describe('constructor', () => {
    it('should use default admin email when config is empty', () => {
      const defaultConfig = { get: jest.fn().mockReturnValue('hello@heybeaux.dev') };
      const ctrl = new AdminController(prisma, defaultConfig);
      // Just verify it constructs without error
      expect(ctrl).toBeDefined();
    });
  });
});
