import { Test, TestingModule } from '@nestjs/testing';
import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ApiKeyGuard } from './api-key.guard';
import { PrismaService } from '../../prisma/prisma.service';
import { createHash } from 'crypto';

describe('ApiKeyGuard', () => {
  let guard: ApiKeyGuard;
  let mockPrisma: any;

  const mockAgent = {
    id: 'agent-123',
    name: 'Test Agent',
    apiKeyHash: createHash('sha256')
      .update('sk-test-key-12345678')
      .digest('hex'),
    apiKeyHint: '5678',
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
  };

  const mockUser = {
    id: 'user-456',
    externalId: 'external-user-123',
    agentId: 'agent-123',
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
  };

  function createMockContext(
    headers: Record<string, string | undefined>,
  ): ExecutionContext {
    const request = {
      headers: {
        'x-am-api-key': headers['x-am-api-key'],
        'x-am-user-id': headers['x-am-user-id'],
        origin: headers['origin'] || '',
        host: headers['host'] || '',
      },
      ip: headers['ip'] || '',
      connection: { remoteAddress: headers['ip'] || '' },
    };

    return {
      switchToHttp: () => ({
        getRequest: () => request,
      }),
    } as ExecutionContext;
  }

  beforeEach(async () => {
    mockPrisma = {
      agent: {
        findUnique: jest.fn(),
      },
      user: {
        findUnique: jest.fn(),
        create: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ApiKeyGuard,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    guard = module.get<ApiKeyGuard>(ApiKeyGuard);
  });

  describe('canActivate', () => {
    it('should allow request with valid API key and user', async () => {
      const context = createMockContext({
        'x-am-api-key': 'sk-test-key-12345678',
        'x-am-user-id': 'external-user-123',
      });

      mockPrisma.agent.findUnique.mockResolvedValue(mockAgent);
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);

      const result = await guard.canActivate(context);

      expect(result).toBe(true);
    });

    it('should reject request without API key', async () => {
      const context = createMockContext({
        'x-am-user-id': 'external-user-123',
      });

      await expect(guard.canActivate(context)).rejects.toThrow(
        new UnauthorizedException('Missing X-AM-API-Key header'),
      );
    });

    it('should reject request without user ID', async () => {
      const context = createMockContext({
        'x-am-api-key': 'sk-test-key-12345678',
      });

      await expect(guard.canActivate(context)).rejects.toThrow(
        new UnauthorizedException('Missing X-AM-User-ID header'),
      );
    });

    it('should reject invalid API key', async () => {
      const context = createMockContext({
        'x-am-api-key': 'invalid-key',
        'x-am-user-id': 'external-user-123',
      });

      mockPrisma.agent.findUnique.mockResolvedValue(null);

      await expect(guard.canActivate(context)).rejects.toThrow(
        new UnauthorizedException('Invalid API key'),
      );
    });

    it('should reject deleted agent', async () => {
      const context = createMockContext({
        'x-am-api-key': 'sk-test-key-12345678',
        'x-am-user-id': 'external-user-123',
      });

      mockPrisma.agent.findUnique.mockResolvedValue({
        ...mockAgent,
        deletedAt: new Date(),
      });

      await expect(guard.canActivate(context)).rejects.toThrow(
        new UnauthorizedException('Invalid API key'),
      );
    });

    it('should create new user on first request', async () => {
      const context = createMockContext({
        'x-am-api-key': 'sk-test-key-12345678',
        'x-am-user-id': 'new-user-123',
      });

      mockPrisma.agent.findUnique.mockResolvedValue(mockAgent);
      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockPrisma.user.create.mockResolvedValue({
        ...mockUser,
        externalId: 'new-user-123',
      });

      const result = await guard.canActivate(context);

      expect(result).toBe(true);
      expect(mockPrisma.user.create).toHaveBeenCalledWith({
        data: {
          agentId: 'agent-123',
          externalId: 'new-user-123',
        },
      });
    });

    it('should reject deleted user', async () => {
      const context = createMockContext({
        'x-am-api-key': 'sk-test-key-12345678',
        'x-am-user-id': 'external-user-123',
      });

      mockPrisma.agent.findUnique.mockResolvedValue(mockAgent);
      mockPrisma.user.findUnique.mockResolvedValue({
        ...mockUser,
        deletedAt: new Date(),
      });

      await expect(guard.canActivate(context)).rejects.toThrow(
        new UnauthorizedException('User has been deleted'),
      );
    });

    it('should attach agent and user to request', async () => {
      const request = {
        headers: {
          'x-am-api-key': 'sk-test-key-12345678',
          'x-am-user-id': 'external-user-123',
        },
      };
      const context = {
        switchToHttp: () => ({
          getRequest: () => request,
        }),
      } as ExecutionContext;

      mockPrisma.agent.findUnique.mockResolvedValue(mockAgent);
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);

      await guard.canActivate(context);

      expect(request['agent']).toEqual(mockAgent);
      expect(request['user']).toEqual(mockUser);
    });

    it('should hash API key using SHA256', async () => {
      const context = createMockContext({
        'x-am-api-key': 'my-secret-api-key',
        'x-am-user-id': 'user-123',
      });

      mockPrisma.agent.findUnique.mockResolvedValue(null);

      try {
        await guard.canActivate(context);
      } catch {
        // Expected to throw
      }

      const expectedHash = createHash('sha256')
        .update('my-secret-api-key')
        .digest('hex');

      expect(mockPrisma.agent.findUnique).toHaveBeenCalledWith({
        where: { apiKeyHash: expectedHash },
      });
    });

    it('should lookup user by agentId and externalId compound key', async () => {
      const context = createMockContext({
        'x-am-api-key': 'sk-test-key-12345678',
        'x-am-user-id': 'external-user-123',
      });

      mockPrisma.agent.findUnique.mockResolvedValue(mockAgent);
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);

      await guard.canActivate(context);

      expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
        where: {
          agentId_externalId: {
            agentId: 'agent-123',
            externalId: 'external-user-123',
          },
        },
      });
    });
  });

  describe('localhost bypass', () => {
    it('should allow localhost requests without API key', async () => {
      const context = createMockContext({
        ip: '127.0.0.1',
      });

      const result = await guard.canActivate(context);
      expect(result).toBe(true);
    });

    it('should allow ::1 (IPv6 localhost) without API key', async () => {
      const context = createMockContext({
        ip: '::1',
      });

      const result = await guard.canActivate(context);
      expect(result).toBe(true);
    });

    it('should allow LAN 10.x requests without API key', async () => {
      const context = createMockContext({
        ip: '10.0.0.108',
      });

      const result = await guard.canActivate(context);
      expect(result).toBe(true);
    });

    it('should allow LAN 192.168.x requests without API key', async () => {
      const context = createMockContext({
        ip: '192.168.1.100',
      });

      const result = await guard.canActivate(context);
      expect(result).toBe(true);
    });

    it('should allow localhost origin without API key', async () => {
      const context = createMockContext({
        origin: 'http://localhost:3000',
      });

      const result = await guard.canActivate(context);
      expect(result).toBe(true);
    });

    it('should still require auth for public IP requests', async () => {
      const context = createMockContext({
        ip: '203.0.113.50',
      });

      await expect(guard.canActivate(context)).rejects.toThrow(
        'Missing X-AM-API-Key header',
      );
    });

    it('should use API key auth when provided even from localhost', async () => {
      mockPrisma.agent.findUnique.mockResolvedValue(mockAgent);
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);

      const context = createMockContext({
        'x-am-api-key': 'sk-test-key-12345678',
        'x-am-user-id': 'external-user-123',
        ip: '127.0.0.1',
      });

      const result = await guard.canActivate(context);
      expect(result).toBe(true);
      expect(mockPrisma.agent.findUnique).toHaveBeenCalled();
    });
  });

  describe('edge cases', () => {
    it('should handle empty string API key', async () => {
      const context = createMockContext({
        'x-am-api-key': '',
        'x-am-user-id': 'user-123',
      });

      await expect(guard.canActivate(context)).rejects.toThrow(
        'Missing X-AM-API-Key header',
      );
    });

    it('should handle empty string user ID', async () => {
      const context = createMockContext({
        'x-am-api-key': 'sk-test-key',
        'x-am-user-id': '',
      });

      await expect(guard.canActivate(context)).rejects.toThrow(
        'Missing X-AM-User-ID header',
      );
    });

    it('should handle database errors gracefully', async () => {
      const context = createMockContext({
        'x-am-api-key': 'sk-test-key-12345678',
        'x-am-user-id': 'external-user-123',
      });

      mockPrisma.agent.findUnique.mockRejectedValue(
        new Error('DB connection failed'),
      );

      await expect(guard.canActivate(context)).rejects.toThrow(
        'DB connection failed',
      );
    });
  });
});
