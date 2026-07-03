import { Test, TestingModule } from '@nestjs/testing';
import { AccountService } from './account.service';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { createHash } from 'crypto';

describe('AccountService', () => {
  let service: AccountService;
  let prisma: any;
  let jwt: any;
  let config: any;

  const mockAccount = {
    id: 'acc-1',
    email: 'test@example.com',
    passwordHash: '',
    name: 'Test',
    plan: 'FREE',
    memoriesUsed: 0,
    apiCallsToday: 0,
    apiCallsResetAt: null,
    resetToken: null,
    resetTokenExpiresAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    stripeCustomerId: null,
    planExpiresAt: null,
  };

  beforeEach(async () => {
    mockAccount.passwordHash = await bcrypt.hash('password123', 12);

    prisma = {
      account: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        findUniqueOrThrow: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      agent: {
        findMany: jest.fn().mockResolvedValue([]),
        deleteMany: jest.fn(),
        count: jest.fn(),
        create: jest.fn(),
      },
      user: {
        findMany: jest.fn().mockResolvedValue([]),
        deleteMany: jest.fn(),
      },
      memory: { deleteMany: jest.fn() },
      session: { deleteMany: jest.fn() },
      project: { deleteMany: jest.fn() },
      $transaction: jest.fn((fn) => fn(prisma)),
    };

    jwt = { sign: jest.fn().mockReturnValue('jwt-token'), verify: jest.fn() };
    config = { get: jest.fn().mockReturnValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AccountService,
        { provide: PrismaService, useValue: prisma },
        { provide: JwtService, useValue: jwt },
        { provide: ConfigService, useValue: config },
      ],
    }).compile();

    service = module.get<AccountService>(AccountService);
  });

  describe('forgotPassword', () => {
    it('should return success even if email not found', async () => {
      prisma.account.findUnique.mockResolvedValue(null);
      const result = await service.forgotPassword('unknown@example.com');
      expect(result.message).toContain('reset link has been sent');
      expect(prisma.account.update).not.toHaveBeenCalled();
    });

    it('should store hashed token and log reset link in dev mode', async () => {
      prisma.account.findUnique.mockResolvedValue(mockAccount);
      prisma.account.update.mockResolvedValue(mockAccount);

      const result = await service.forgotPassword('test@example.com');
      expect(result.message).toContain('reset link has been sent');
      expect(prisma.account.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'acc-1' },
          data: expect.objectContaining({
            resetToken: expect.any(String),
            resetTokenExpiresAt: expect.any(Date),
          }),
        }),
      );
    });
  });

  describe('resetPassword', () => {
    it('should reject invalid token', async () => {
      prisma.account.findFirst.mockResolvedValue(null);
      await expect(
        service.resetPassword('bad-token', 'newpass123'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject expired token', async () => {
      prisma.account.findFirst.mockResolvedValue({
        ...mockAccount,
        resetToken: 'hash',
        resetTokenExpiresAt: new Date(Date.now() - 1000),
      });
      await expect(
        service.resetPassword('some-token', 'newpass123'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reset password with valid token', async () => {
      const rawToken = 'valid-token-123';
      const tokenHash = createHash('sha256').update(rawToken).digest('hex');

      prisma.account.findFirst.mockResolvedValue({
        ...mockAccount,
        resetToken: tokenHash,
        resetTokenExpiresAt: new Date(Date.now() + 3600000),
      });
      prisma.account.update.mockResolvedValue(mockAccount);

      const result = await service.resetPassword(rawToken, 'newpassword');
      expect(result.message).toContain('reset successfully');
      expect(prisma.account.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            resetToken: null,
            resetTokenExpiresAt: null,
            passwordHash: expect.any(String),
          }),
        }),
      );
    });
  });

  describe('changePassword', () => {
    it('should reject wrong current password', async () => {
      prisma.account.findUniqueOrThrow.mockResolvedValue(mockAccount);
      await expect(
        service.changePassword('acc-1', 'wrongpassword', 'newpass123'),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should change password with correct current password', async () => {
      prisma.account.findUniqueOrThrow.mockResolvedValue(mockAccount);
      prisma.account.update.mockResolvedValue(mockAccount);

      const result = await service.changePassword(
        'acc-1',
        'password123',
        'newpassword',
      );
      expect(result.message).toContain('changed successfully');
      expect(prisma.account.update).toHaveBeenCalled();
    });
  });

  describe('deleteAccount', () => {
    it('should delete account and all related data in transaction', async () => {
      prisma.agent.findMany.mockResolvedValue([{ id: 'agent-1' }]);
      prisma.user.findMany.mockResolvedValue([{ id: 'user-1' }]);

      await service.deleteAccount('acc-1');

      expect(prisma.$transaction).toHaveBeenCalled();
      expect(prisma.memory.deleteMany).toHaveBeenCalled();
      expect(prisma.session.deleteMany).toHaveBeenCalled();
      expect(prisma.project.deleteMany).toHaveBeenCalled();
      expect(prisma.user.deleteMany).toHaveBeenCalled();
      expect(prisma.agent.deleteMany).toHaveBeenCalled();
      expect(prisma.account.delete).toHaveBeenCalledWith({
        where: { id: 'acc-1' },
      });
    });

    it('should handle account with no agents', async () => {
      prisma.agent.findMany.mockResolvedValue([]);

      await service.deleteAccount('acc-1');

      expect(prisma.account.delete).toHaveBeenCalled();
      expect(prisma.memory.deleteMany).not.toHaveBeenCalled();
    });
  });
});
