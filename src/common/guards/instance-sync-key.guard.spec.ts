import { Test, TestingModule } from '@nestjs/testing';
import { InstanceSyncKeyGuard } from './instance-sync-key.guard';
import { PrismaService } from '../../prisma/prisma.service';
import { UnauthorizedException, ExecutionContext } from '@nestjs/common';
import { createHash } from 'crypto';

const mockPrisma = {
  instanceSyncKey: { findUnique: jest.fn(), update: jest.fn() },
  instanceApiKey: { findUnique: jest.fn(), update: jest.fn() },
};

function createMockContext(headers: Record<string, string> = {}): {
  ctx: ExecutionContext;
  request: Record<string, unknown>;
} {
  const request: Record<string, unknown> = { headers };
  return {
    ctx: {
      switchToHttp: () => ({
        getRequest: () => request,
      }),
    } as unknown as ExecutionContext,
    request,
  };
}

describe('InstanceSyncKeyGuard', () => {
  let guard: InstanceSyncKeyGuard;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockPrisma.instanceSyncKey.update.mockResolvedValue({});
    mockPrisma.instanceApiKey.update.mockResolvedValue({});

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InstanceSyncKeyGuard,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    guard = module.get<InstanceSyncKeyGuard>(InstanceSyncKeyGuard);
  });

  describe('X-Sync-Key authentication', () => {
    const syncKey = 'esync_test123';
    const keyHash = createHash('sha256').update(syncKey).digest('hex');

    it('should authenticate with valid sync key', async () => {
      const { ctx, request } = createMockContext({ 'x-sync-key': syncKey });
      mockPrisma.instanceSyncKey.findUnique.mockResolvedValue({
        id: 'inst-1',
        keyHash,
        accountId: 'acc-1',
        instanceName: 'test-instance',
        revokedAt: null,
      });

      const result = await guard.canActivate(ctx);
      expect(result).toBe(true);
      expect(request.accountId).toBe('acc-1');
      expect(request.instanceId).toBe('inst-1');
      expect(request.instanceName).toBe('test-instance');
      expect(mockPrisma.instanceSyncKey.findUnique).toHaveBeenCalledWith({
        where: { keyHash },
      });
    });

    it('should reject invalid sync key', async () => {
      const { ctx } = createMockContext({ 'x-sync-key': 'bad-key' });
      mockPrisma.instanceSyncKey.findUnique.mockResolvedValue(null);

      await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
      await expect(guard.canActivate(ctx)).rejects.toThrow('Invalid or revoked sync key');
    });

    it('should reject revoked sync key', async () => {
      const { ctx } = createMockContext({ 'x-sync-key': syncKey });
      mockPrisma.instanceSyncKey.findUnique.mockResolvedValue({
        id: 'inst-1',
        keyHash,
        accountId: 'acc-1',
        revokedAt: new Date(),
      });

      await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
      await expect(guard.canActivate(ctx)).rejects.toThrow('Invalid or revoked sync key');
    });

    it('should update lastUsedAt (best-effort, no failure on error)', async () => {
      const { ctx } = createMockContext({ 'x-sync-key': syncKey });
      mockPrisma.instanceSyncKey.findUnique.mockResolvedValue({
        id: 'inst-1',
        keyHash,
        accountId: 'acc-1',
        instanceName: 'test',
        revokedAt: null,
      });
      mockPrisma.instanceSyncKey.update.mockRejectedValue(new Error('DB error'));

      const result = await guard.canActivate(ctx);
      expect(result).toBe(true); // Should not fail
    });
  });

  describe('X-AM-API-Key (eng_inst_) fallback', () => {
    const apiKey = 'eng_inst_test456';
    const keyHash = createHash('sha256').update(apiKey).digest('hex');

    it('should authenticate with valid instance API key with sync scope', async () => {
      const { ctx, request } = createMockContext({ 'x-am-api-key': apiKey });
      mockPrisma.instanceApiKey.findUnique.mockResolvedValue({
        id: 'ikey-1',
        keyHash,
        accountId: 'acc-2',
        name: 'my-instance',
        scopes: ['sync', 'read'],
        deletedAt: null,
      });

      const result = await guard.canActivate(ctx);
      expect(result).toBe(true);
      expect(request.accountId).toBe('acc-2');
      expect(request.instanceName).toBe('my-instance');
    });

    it('should reject instance API key without sync scope', async () => {
      const { ctx } = createMockContext({ 'x-am-api-key': apiKey });
      mockPrisma.instanceApiKey.findUnique.mockResolvedValue({
        id: 'ikey-1',
        keyHash,
        accountId: 'acc-2',
        name: 'my-instance',
        scopes: ['read'],
        deletedAt: null,
      });

      await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
      await expect(guard.canActivate(ctx)).rejects.toThrow('Instance API key lacks sync scope');
    });

    it('should reject deleted instance API key', async () => {
      const { ctx } = createMockContext({ 'x-am-api-key': apiKey });
      mockPrisma.instanceApiKey.findUnique.mockResolvedValue({
        id: 'ikey-1',
        keyHash,
        accountId: 'acc-2',
        deletedAt: new Date(),
      });

      await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
      await expect(guard.canActivate(ctx)).rejects.toThrow('Invalid instance API key');
    });

    it('should reject unknown instance API key', async () => {
      const { ctx } = createMockContext({ 'x-am-api-key': apiKey });
      mockPrisma.instanceApiKey.findUnique.mockResolvedValue(null);

      await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
    });

    it('should use X-Instance-Id header when present', async () => {
      const { ctx, request } = createMockContext({
        'x-am-api-key': apiKey,
        'x-instance-id': 'custom-inst-id',
      });
      mockPrisma.instanceApiKey.findUnique.mockResolvedValue({
        id: 'ikey-1',
        keyHash,
        accountId: 'acc-2',
        name: 'my-instance',
        scopes: ['sync'],
        deletedAt: null,
      });

      await guard.canActivate(ctx);
      expect(request.instanceId).toBe('custom-inst-id');
    });

    it('should ignore non eng_inst_ API keys', async () => {
      const { ctx } = createMockContext({ 'x-am-api-key': 'eng_regular_key' });

      await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
      await expect(guard.canActivate(ctx)).rejects.toThrow('Missing X-Sync-Key or X-AM-API-Key header');
    });
  });

  describe('no credentials', () => {
    it('should throw when no sync key or API key provided', async () => {
      const { ctx } = createMockContext({});

      await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
      await expect(guard.canActivate(ctx)).rejects.toThrow('Missing X-Sync-Key or X-AM-API-Key header');
    });
  });

  describe('priority: X-Sync-Key over X-AM-API-Key', () => {
    it('should prefer X-Sync-Key when both headers present', async () => {
      const syncKey = 'esync_both';
      const { ctx, request } = createMockContext({
        'x-sync-key': syncKey,
        'x-am-api-key': 'eng_inst_both',
      });
      const keyHash = createHash('sha256').update(syncKey).digest('hex');
      mockPrisma.instanceSyncKey.findUnique.mockResolvedValue({
        id: 'inst-sync',
        keyHash,
        accountId: 'acc-sync',
        instanceName: 'sync-instance',
        revokedAt: null,
      });

      const result = await guard.canActivate(ctx);
      expect(result).toBe(true);
      expect(request.accountId).toBe('acc-sync');
      expect(mockPrisma.instanceApiKey.findUnique).not.toHaveBeenCalled();
    });
  });
});
