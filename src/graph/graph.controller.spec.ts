import { Test, TestingModule } from '@nestjs/testing';
import { GraphController } from './graph.controller';
import { GraphService } from './services/graph.service';
import { EntityService } from './services/entity.service';
import { RelationshipService } from './services/relationship.service';
import { GraphExtractionService } from './services/graph-extraction.service';
import { PrismaService } from '../prisma/prisma.service';
import { BadRequestException } from '@nestjs/common';
import { ApiKeyOrJwtGuard } from '../common/guards/api-key-or-jwt.guard';

const mockGuard = { canActivate: jest.fn().mockReturnValue(true) };

describe('GraphController', () => {
  let controller: GraphController;
  let graphService: any;
  let entityService: any;
  let relationshipService: any;
  let extractionService: any;
  let prisma: any;

  const mockGraphService = {
    isEnabled: jest.fn().mockReturnValue(true),
    searchEntities: jest.fn(),
    getEntityProfile: jest.fn(),
    findPath: jest.fn(),
    findByRelationship: jest.fn(),
    getMemoriesForEntity: jest.fn(),
    getRelatedEntities: jest.fn(),
    getStats: jest.fn(),
    backfill: jest.fn(),
  };

  const mockEntityService = {
    list: jest.fn(),
    getWithRelationships: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  };

  const mockRelationshipService = {
    list: jest.fn(),
    findByIdOrFail: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    traverse: jest.fn(),
  };

  const mockExtractionService = {
    isEnabled: jest.fn().mockReturnValue(true),
    extract: jest.fn(),
  };

  const mockPrisma = {
    user: {
      findMany: jest.fn(),
    },
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [GraphController],
      providers: [
        { provide: GraphService, useValue: mockGraphService },
        { provide: EntityService, useValue: mockEntityService },
        { provide: RelationshipService, useValue: mockRelationshipService },
        { provide: GraphExtractionService, useValue: mockExtractionService },
        { provide: PrismaService, useValue: mockPrisma },
      ],
    })
      .overrideGuard(ApiKeyOrJwtGuard)
      .useValue(mockGuard)
      .compile();

    controller = module.get<GraphController>(GraphController);
  });

  // ==================== Status ====================

  describe('getStatus', () => {
    it('should return graph and extraction enabled status', async () => {
      const result = await controller.getStatus();
      expect(result).toEqual({ enabled: true, extractionEnabled: true });
    });

    it('should reflect disabled state', async () => {
      mockGraphService.isEnabled.mockReturnValue(false);
      mockExtractionService.isEnabled.mockReturnValue(false);
      const result = await controller.getStatus();
      expect(result).toEqual({ enabled: false, extractionEnabled: false });
    });
  });

  // ==================== Entities ====================

  describe('listEntities', () => {
    it('should list entities with explicit userId', async () => {
      const entities = [{ id: 'e1', name: 'Test' }];
      mockEntityService.list.mockResolvedValue(entities);

      const result = await controller.listEntities({} as any, 'user-1', 'person');
      expect(mockEntityService.list).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'user-1', type: 'person' }),
      );
      expect(result).toEqual(entities);
    });

    it('should resolve account user IDs when userId not provided', async () => {
      mockPrisma.user.findMany.mockResolvedValue([{ id: 'u1' }, { id: 'u2' }]);
      mockEntityService.list.mockResolvedValue([]);

      await controller.listEntities({ accountId: 'acc-1' } as any, undefined);
      expect(mockEntityService.list).toHaveBeenCalledWith(
        expect.objectContaining({ userId: ['u1', 'u2'] }),
      );
    });

    it('should throw BadRequestException when no userId and no account', async () => {
      mockPrisma.user.findMany.mockResolvedValue([]);
      await expect(
        controller.listEntities({} as any, undefined),
      ).rejects.toThrow(BadRequestException);
    });

    it('should parse limit and offset as integers', async () => {
      mockEntityService.list.mockResolvedValue([]);
      await controller.listEntities({} as any, 'user-1', undefined, undefined, '10', '5');
      expect(mockEntityService.list).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 10, offset: 5 }),
      );
    });
  });

  describe('getEntity', () => {
    it('should get entity by id', async () => {
      const entity = { id: 'e1', name: 'Test' };
      mockEntityService.getWithRelationships.mockResolvedValue(entity);
      const result = await controller.getEntity('e1');
      expect(result).toEqual(entity);
    });
  });

  describe('createEntity', () => {
    it('should create entity', async () => {
      const dto = { name: 'New Entity', userId: 'u1', type: 'person' } as any;
      mockEntityService.create.mockResolvedValue({ id: 'e1', ...dto });
      const result = await controller.createEntity(dto);
      expect(mockEntityService.create).toHaveBeenCalledWith(dto);
      expect(result.id).toBe('e1');
    });
  });

  describe('updateEntity', () => {
    it('should update entity', async () => {
      const dto = { name: 'Updated' } as any;
      mockEntityService.update.mockResolvedValue({ id: 'e1', name: 'Updated' });
      const result = await controller.updateEntity('e1', dto);
      expect(mockEntityService.update).toHaveBeenCalledWith('e1', dto);
      expect(result.name).toBe('Updated');
    });
  });

  describe('deleteEntity', () => {
    it('should delete entity', async () => {
      mockEntityService.delete.mockResolvedValue(undefined);
      await controller.deleteEntity('e1');
      expect(mockEntityService.delete).toHaveBeenCalledWith('e1');
    });
  });

  describe('searchEntities', () => {
    it('should search entities with valid params', async () => {
      mockGraphService.searchEntities.mockResolvedValue([{ id: 'e1' }]);
      const result = await controller.searchEntities({
        userId: 'u1',
        query: 'test',
        type: 'person',
        limit: 5,
      });
      expect(mockGraphService.searchEntities).toHaveBeenCalledWith('u1', 'test', {
        type: 'person',
        limit: 5,
      });
      expect(result).toHaveLength(1);
    });

    it('should throw when userId missing', async () => {
      await expect(
        controller.searchEntities({ userId: '', query: 'test' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw when query missing', async () => {
      await expect(
        controller.searchEntities({ userId: 'u1', query: '' }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('getEntityProfile', () => {
    it('should return entity profile', async () => {
      const profile = { name: 'Beaux', relationships: [] };
      mockGraphService.getEntityProfile.mockResolvedValue(profile);
      const result = await controller.getEntityProfile('u1', 'Beaux');
      expect(result).toEqual(profile);
    });

    it('should throw when entity not found', async () => {
      mockGraphService.getEntityProfile.mockResolvedValue(null);
      await expect(
        controller.getEntityProfile('u1', 'nonexistent'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ==================== Relationships ====================

  describe('listRelationships', () => {
    it('should list with explicit userId', async () => {
      mockRelationshipService.list.mockResolvedValue([]);
      await controller.listRelationships({} as any, 'u1');
      expect(mockRelationshipService.list).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'u1' }),
      );
    });

    it('should resolve account when no userId', async () => {
      mockPrisma.user.findMany.mockResolvedValue([{ id: 'u1' }]);
      mockRelationshipService.list.mockResolvedValue([]);
      await controller.listRelationships({ accountId: 'acc-1' } as any);
      expect(mockRelationshipService.list).toHaveBeenCalledWith(
        expect.objectContaining({ userId: ['u1'] }),
      );
    });

    it('should throw when no userId and no account', async () => {
      mockPrisma.user.findMany.mockResolvedValue([]);
      await expect(
        controller.listRelationships({} as any),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('createRelationship', () => {
    it('should create relationship', async () => {
      const dto = { sourceEntityId: 'e1', targetEntityId: 'e2', type: 'KNOWS' } as any;
      mockRelationshipService.create.mockResolvedValue({ id: 'r1', ...dto });
      const result = await controller.createRelationship(dto);
      expect(result.id).toBe('r1');
    });
  });

  describe('deleteRelationship', () => {
    it('should delete relationship', async () => {
      mockRelationshipService.delete.mockResolvedValue(undefined);
      await controller.deleteRelationship('r1');
      expect(mockRelationshipService.delete).toHaveBeenCalledWith('r1');
    });
  });

  // ==================== Graph Queries ====================

  describe('traverseGraph', () => {
    it('should traverse with valid dto', async () => {
      const dto = { userId: 'u1', startEntityId: 'e1' } as any;
      mockRelationshipService.traverse.mockResolvedValue({ nodes: [], edges: [] });
      const result = await controller.traverseGraph(dto);
      expect(result).toEqual({ nodes: [], edges: [] });
    });

    it('should throw when userId missing', async () => {
      await expect(
        controller.traverseGraph({ startEntityId: 'e1' } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw when startEntityId missing', async () => {
      await expect(
        controller.traverseGraph({ userId: 'u1' } as any),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('findPath', () => {
    it('should find path between entities', async () => {
      mockGraphService.findPath.mockResolvedValue({ path: ['e1', 'e2'] });
      const result = await controller.findPath({ userId: 'u1', from: 'e1', to: 'e2' });
      expect(result).toEqual({ path: ['e1', 'e2'] });
    });

    it('should throw when params missing', async () => {
      await expect(
        controller.findPath({ userId: 'u1', from: '', to: 'e2' }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('findByRelationship', () => {
    it('should find entities by relationship', async () => {
      mockGraphService.findByRelationship.mockResolvedValue([{ id: 'e1' }]);
      const result = await controller.findByRelationship({
        userId: 'u1',
        relationshipType: 'KNOWS',
        targetEntity: 'Beaux',
      });
      expect(result).toHaveLength(1);
    });

    it('should throw when params missing', async () => {
      await expect(
        controller.findByRelationship({
          userId: 'u1',
          relationshipType: '',
          targetEntity: 'x',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ==================== Memories & Related ====================

  describe('getEntityMemories', () => {
    it('should get memories with default limit', async () => {
      mockGraphService.getMemoriesForEntity.mockResolvedValue([]);
      await controller.getEntityMemories('e1');
      expect(mockGraphService.getMemoriesForEntity).toHaveBeenCalledWith('e1', 20);
    });

    it('should parse custom limit', async () => {
      mockGraphService.getMemoriesForEntity.mockResolvedValue([]);
      await controller.getEntityMemories('e1', '50');
      expect(mockGraphService.getMemoriesForEntity).toHaveBeenCalledWith('e1', 50);
    });
  });

  describe('getRelatedEntities', () => {
    it('should get related with default depth', async () => {
      mockGraphService.getRelatedEntities.mockResolvedValue([]);
      await controller.getRelatedEntities('e1');
      expect(mockGraphService.getRelatedEntities).toHaveBeenCalledWith('e1', 1);
    });
  });

  // ==================== Stats & Admin ====================

  describe('getStats', () => {
    it('should return stats', async () => {
      const stats = { entityCount: 10, relationshipCount: 20 };
      mockGraphService.getStats.mockResolvedValue(stats);
      const result = await controller.getStats('u1');
      expect(result).toEqual(stats);
    });
  });

  describe('extract', () => {
    it('should extract from content', async () => {
      mockExtractionService.extract.mockResolvedValue({ entities: [] });
      const result = await controller.extract({ content: 'test content' });
      expect(result).toEqual({ entities: [] });
    });

    it('should throw when content empty', async () => {
      await expect(controller.extract({ content: '' })).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('backfill', () => {
    it('should backfill with explicit userId', async () => {
      mockGraphService.backfill.mockResolvedValue({ processed: 5, skipped: 0, failed: 0 });
      const result = await controller.backfill({} as any, { userId: 'u1', limit: 10 });
      expect(mockGraphService.backfill).toHaveBeenCalledWith('u1', { limit: 10 });
      expect(result.processed).toBe(5);
    });

    it('should backfill all account users when no userId', async () => {
      mockPrisma.user.findMany.mockResolvedValue([{ id: 'u1' }, { id: 'u2' }]);
      mockGraphService.backfill.mockResolvedValue({ processed: 3, skipped: 1, failed: 0 });
      const result = await controller.backfill(
        { accountId: 'acc-1' } as any,
        {},
      );
      expect(mockGraphService.backfill).toHaveBeenCalledTimes(2);
      expect(result.processed).toBe(6);
      expect((result as any).users).toBe(2);
    });

    it('should clamp limit to valid range', async () => {
      mockGraphService.backfill.mockResolvedValue({ processed: 0, skipped: 0, failed: 0 });
      await controller.backfill({} as any, { userId: 'u1', limit: 99999 });
      expect(mockGraphService.backfill).toHaveBeenCalledWith('u1', { limit: 5000 });
    });

    it('should throw when no userId and no account users', async () => {
      mockPrisma.user.findMany.mockResolvedValue([]);
      await expect(
        controller.backfill({} as any, {}),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
