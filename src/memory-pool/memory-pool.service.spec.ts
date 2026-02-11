import { Test, TestingModule } from '@nestjs/testing';
import { MemoryPoolService } from './memory-pool.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotFoundException } from '@nestjs/common';

describe('MemoryPoolService', () => {
  let service: MemoryPoolService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      memoryPool: {
        create: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
      },
      poolGrant: {
        upsert: jest.fn(),
        delete: jest.fn(),
      },
      memoryPoolMembership: {
        create: jest.fn(),
        delete: jest.fn(),
      },
      agentSession: {
        findUnique: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MemoryPoolService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(MemoryPoolService);
  });

  describe('create', () => {
    it('should create a pool', async () => {
      const dto = { name: 'test-pool', userId: 'u1', createdBy: 'agent:main' };
      prisma.memoryPool.create.mockResolvedValue({ id: 'p1', ...dto, visibility: 'GLOBAL' });

      const result = await service.create(dto);
      expect(result.name).toBe('test-pool');
    });
  });

  describe('getById', () => {
    it('should throw NotFoundException when pool not found', async () => {
      prisma.memoryPool.findUnique.mockResolvedValue(null);
      await expect(service.getById('nonexistent')).rejects.toThrow(NotFoundException);
    });
  });

  describe('grantAccess', () => {
    it('should upsert a grant', async () => {
      prisma.memoryPool.findUnique.mockResolvedValue({ id: 'p1' });
      prisma.poolGrant.upsert.mockResolvedValue({ id: 'g1', poolId: 'p1', permission: 'READ' });

      const result = await service.grantAccess('p1', {
        agentSessionId: 's1',
        grantedBy: 'agent:main',
      });
      expect(result.permission).toBe('READ');
    });
  });

  describe('getAccessiblePoolIds', () => {
    it('should return global pools for a user', async () => {
      prisma.memoryPool.findMany
        .mockResolvedValueOnce([{ id: 'global-pool' }]) // global pools
        .mockResolvedValueOnce([]) // private pools
      prisma.agentSession.findUnique.mockResolvedValue({
        sessionKey: 'agent:main',
        parentKey: null,
        poolGrants: [],
      });

      const ids = await service.getAccessiblePoolIds('agent:main', 'u1');
      expect(ids).toContain('global-pool');
    });

    it('should include shared pools via grants', async () => {
      prisma.memoryPool.findMany
        .mockResolvedValueOnce([{ id: 'global-pool' }]) // global
        .mockResolvedValueOnce([{ id: 'shared-pool' }]) // shared via grant
        .mockResolvedValueOnce([]) // private
      prisma.agentSession.findUnique.mockResolvedValue({
        sessionKey: 'agent:sub:1',
        parentKey: 'agent:main',
        poolGrants: [{ poolId: 'shared-pool' }],
      });

      const ids = await service.getAccessiblePoolIds('agent:sub:1', 'u1');
      expect(ids).toContain('global-pool');
      expect(ids).toContain('shared-pool');
    });

    it('should include private pools created by session', async () => {
      prisma.memoryPool.findMany
        .mockResolvedValueOnce([]) // global
        .mockResolvedValueOnce([{ id: 'private-pool' }]) // private
      prisma.agentSession.findUnique.mockResolvedValue({
        sessionKey: 'agent:sub:1',
        parentKey: 'agent:main',
        poolGrants: [],
      });

      const ids = await service.getAccessiblePoolIds('agent:sub:1', 'u1');
      expect(ids).toContain('private-pool');
    });
  });
});
