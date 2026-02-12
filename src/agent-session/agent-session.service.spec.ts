import { Test, TestingModule } from '@nestjs/testing';
import { AgentSessionService } from './agent-session.service';
import { PrismaService } from '../prisma/prisma.service';
import { MemoryPoolService } from '../memory-pool/memory-pool.service';
import { NotFoundException } from '@nestjs/common';

describe('AgentSessionService', () => {
  let service: AgentSessionService;
  let prisma: any;
  let poolService: any;

  beforeEach(async () => {
    prisma = {
      agentSession: {
        upsert: jest.fn(),
        findUnique: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
      },
      memoryPool: {
        findFirst: jest.fn(),
      },
    };

    poolService = {
      findOrCreatePool: jest.fn(),
      grantAccess: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AgentSessionService,
        { provide: PrismaService, useValue: prisma },
        { provide: MemoryPoolService, useValue: poolService },
      ],
    }).compile();

    service = module.get(AgentSessionService);
  });

  describe('upsert', () => {
    it('should create a new agent session', async () => {
      const dto = {
        sessionKey: 'agent:main:subagent:abc',
        parentKey: 'agent:main',
        label: 'test',
      };
      const expected = {
        id: 'id1',
        ...dto,
        status: 'ACTIVE',
        createdAt: new Date(),
      };
      prisma.agentSession.upsert.mockResolvedValue(expected);

      const result = await service.upsert(dto);
      expect(result.sessionKey).toBe(dto.sessionKey);
    });

    it('should auto-create task pool when label and userId provided', async () => {
      const dto = {
        sessionKey: 'agent:main:subagent:abc',
        parentKey: 'agent:main',
        label: 'v09-test',
        userId: 'u1',
      };
      const session = { id: 'sess1', ...dto, status: 'ACTIVE', createdAt: new Date() };
      prisma.agentSession.upsert.mockResolvedValue(session);
      poolService.findOrCreatePool.mockResolvedValue({ id: 'pool1', name: 'task:v09-test' });
      poolService.grantAccess.mockResolvedValue({});
      // Parent lookup
      prisma.agentSession.findUnique.mockResolvedValue({ id: 'parent-id', sessionKey: 'agent:main' });
      // Global pool lookup
      prisma.memoryPool.findFirst.mockResolvedValue(null);

      const result = await service.upsert(dto);
      expect(result.poolId).toBe('pool1');
      expect(poolService.findOrCreatePool).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'task:v09-test',
          userId: 'u1',
          visibility: 'SHARED',
        }),
      );
      // WRITE grant to sub-agent
      expect(poolService.grantAccess).toHaveBeenCalledWith(
        'pool1',
        expect.objectContaining({ agentSessionId: 'sess1', permission: 'WRITE' }),
      );
      // READ grant to parent
      expect(poolService.grantAccess).toHaveBeenCalledWith(
        'pool1',
        expect.objectContaining({ agentSessionId: 'parent-id', permission: 'READ' }),
      );
    });

    it('should not create pool when no label or userId', async () => {
      const dto = { sessionKey: 'agent:main' };
      prisma.agentSession.upsert.mockResolvedValue({
        id: 'id1',
        ...dto,
        status: 'ACTIVE',
      });

      const result = await service.upsert(dto);
      expect(result.poolId).toBeUndefined();
      expect(poolService.findOrCreatePool).not.toHaveBeenCalled();
    });
  });

  describe('getByKey', () => {
    it('should return session when found', async () => {
      const session = { id: 'id1', sessionKey: 'agent:main' };
      prisma.agentSession.findUnique.mockResolvedValue(session);
      expect(await service.getByKey('agent:main')).toEqual(session);
    });

    it('should throw NotFoundException when not found', async () => {
      prisma.agentSession.findUnique.mockResolvedValue(null);
      await expect(service.getByKey('nonexistent')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('updateStatus', () => {
    it('should set endedAt when completing', async () => {
      prisma.agentSession.findUnique.mockResolvedValue({
        id: 'id1',
        sessionKey: 'agent:main',
      });
      prisma.agentSession.update.mockResolvedValue({
        id: 'id1',
        status: 'COMPLETED',
      });

      await service.updateStatus('agent:main', { status: 'COMPLETED' });
      expect(prisma.agentSession.update).toHaveBeenCalledWith({
        where: { id: 'id1' },
        data: expect.objectContaining({
          status: 'COMPLETED',
          endedAt: expect.any(Date),
        }),
      });
    });
  });

  describe('listByParent', () => {
    it('should list children of a parent', async () => {
      prisma.agentSession.findMany.mockResolvedValue([]);
      await service.listByParent('agent:main');
      expect(prisma.agentSession.findMany).toHaveBeenCalledWith({
        where: { parentKey: 'agent:main' },
        orderBy: { createdAt: 'desc' },
      });
    });
  });

  describe('updateStatus - memory promotion', () => {
    beforeEach(() => {
      prisma.memoryPool = {
        ...prisma.memoryPool,
        findFirst: jest.fn(),
      };
      prisma.memoryPoolMembership = {
        upsert: jest.fn().mockResolvedValue({}),
      };
    });

    it('should promote high-scoring memories to global pool on COMPLETED', async () => {
      const sessionKey = 'agent:main:subagent:abc';
      const session = { id: 'sess1', sessionKey, label: 'test-task', status: 'ACTIVE' };
      prisma.agentSession.findUnique.mockResolvedValue(session);
      prisma.agentSession.update.mockResolvedValue({ ...session, status: 'COMPLETED' });

      // Task pool with 3 memories: 2 high-scoring, 1 low
      prisma.memoryPool.findFirst.mockResolvedValue({
        id: 'task-pool-1',
        name: 'task:test-task',
        userId: 'u1',
        memberships: [
          { memory: { id: 'm1', effectiveScore: 0.9, userId: 'u1' } },
          { memory: { id: 'm2', effectiveScore: 0.8, userId: 'u1' } },
          { memory: { id: 'm3', effectiveScore: 0.3, userId: 'u1' } },
        ],
      });

      // Global pool
      poolService.findOrCreatePool.mockResolvedValue({ id: 'global-pool-1' });

      await service.updateStatus(sessionKey, { status: 'COMPLETED' as any });

      // Should promote m1 and m2 (score >= 0.7), not m3
      expect(prisma.memoryPoolMembership.upsert).toHaveBeenCalledTimes(2);
      expect(prisma.memoryPoolMembership.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { memoryId_poolId: { memoryId: 'm1', poolId: 'global-pool-1' } },
          create: expect.objectContaining({ memoryId: 'm1', poolId: 'global-pool-1' }),
        }),
      );
      expect(prisma.memoryPoolMembership.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { memoryId_poolId: { memoryId: 'm2', poolId: 'global-pool-1' } },
          create: expect.objectContaining({ memoryId: 'm2', poolId: 'global-pool-1' }),
        }),
      );
    });

    it('should NOT promote memories when status is TERMINATED', async () => {
      const sessionKey = 'agent:main:subagent:abc';
      prisma.agentSession.findUnique.mockResolvedValue({
        id: 'sess1', sessionKey, label: 'test-task',
      });
      prisma.agentSession.update.mockResolvedValue({ id: 'sess1', status: 'TERMINATED' });

      await service.updateStatus(sessionKey, { status: 'TERMINATED' as any });

      expect(prisma.memoryPool.findFirst).not.toHaveBeenCalled();
    });

    it('should handle no task pool gracefully', async () => {
      const sessionKey = 'agent:main:subagent:abc';
      prisma.agentSession.findUnique.mockResolvedValue({
        id: 'sess1', sessionKey, label: 'test-task',
      });
      prisma.agentSession.update.mockResolvedValue({ id: 'sess1', status: 'COMPLETED' });
      prisma.memoryPool.findFirst.mockResolvedValue(null);

      // Should not throw
      await service.updateStatus(sessionKey, { status: 'COMPLETED' as any });
      expect(poolService.findOrCreatePool).not.toHaveBeenCalled();
    });

    it('should handle session without label (no promotion)', async () => {
      const sessionKey = 'agent:main:subagent:abc';
      prisma.agentSession.findUnique.mockResolvedValue({
        id: 'sess1', sessionKey, label: null,
      });
      prisma.agentSession.update.mockResolvedValue({ id: 'sess1', status: 'COMPLETED' });

      await service.updateStatus(sessionKey, { status: 'COMPLETED' as any });
      expect(prisma.memoryPool.findFirst).not.toHaveBeenCalled();
    });
  });
});
