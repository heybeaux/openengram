import { Test, TestingModule } from '@nestjs/testing';
import { EntityService } from './entity.service';
import { PrismaService } from '../../prisma/prisma.service';
import { GraphEntityType } from '@prisma/client';

describe('EntityService', () => {
  let service: EntityService;
  let prisma: PrismaService;

  const mockPrismaService = {
    graphEntity: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      count: jest.fn(),
      groupBy: jest.fn(),
    },
    graphRelationship: {
      count: jest.fn(),
    },
    graphEntityMention: {
      count: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EntityService,
        { provide: PrismaService, useValue: mockPrismaService },
      ],
    }).compile();

    service = module.get<EntityService>(EntityService);
    prisma = module.get<PrismaService>(PrismaService);
    jest.clearAllMocks();
  });

  describe('create', () => {
    it('should create an entity', async () => {
      const mockEntity = {
        id: 'entity-1',
        userId: 'user-1',
        name: 'Beaux',
        type: GraphEntityType.PERSON,
        aliases: ['beaux walton'],
        description: null,
        metadata: {},
        mentionCount: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockPrismaService.graphEntity.create.mockResolvedValue(mockEntity);

      const result = await service.create({
        userId: 'user-1',
        name: 'Beaux',
        type: GraphEntityType.PERSON,
        aliases: ['beaux walton'],
      });

      expect(result).toEqual(mockEntity);
      expect(mockPrismaService.graphEntity.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: 'user-1',
          name: 'Beaux',
          type: GraphEntityType.PERSON,
        }),
      });
    });
  });

  describe('findById', () => {
    it('should find entity by id', async () => {
      const mockEntity = {
        id: 'entity-1',
        name: 'Beaux',
        type: GraphEntityType.PERSON,
      };

      mockPrismaService.graphEntity.findUnique.mockResolvedValue(mockEntity);

      const result = await service.findById('entity-1');

      expect(result).toEqual(mockEntity);
      expect(mockPrismaService.graphEntity.findUnique).toHaveBeenCalledWith({
        where: { id: 'entity-1' },
      });
    });

    it('should return null if not found', async () => {
      mockPrismaService.graphEntity.findUnique.mockResolvedValue(null);

      const result = await service.findById('nonexistent');

      expect(result).toBeNull();
    });
  });

  describe('findByName', () => {
    it('should find entity by exact name and type', async () => {
      const mockEntity = {
        id: 'entity-1',
        name: 'Beaux',
        type: GraphEntityType.PERSON,
      };

      mockPrismaService.graphEntity.findUnique.mockResolvedValue(mockEntity);

      const result = await service.findByName('user-1', 'Beaux', GraphEntityType.PERSON);

      expect(result).toEqual(mockEntity);
      expect(mockPrismaService.graphEntity.findUnique).toHaveBeenCalledWith({
        where: {
          userId_name_type: {
            userId: 'user-1',
            name: 'Beaux',
            type: GraphEntityType.PERSON,
          },
        },
      });
    });

    it('should find entity by name (case-insensitive) when type not specified', async () => {
      const mockEntity = {
        id: 'entity-1',
        name: 'Beaux',
        type: GraphEntityType.PERSON,
      };

      mockPrismaService.graphEntity.findFirst.mockResolvedValue(mockEntity);

      const result = await service.findByName('user-1', 'beaux');

      expect(result).toEqual(mockEntity);
    });
  });

  describe('findByAlias', () => {
    it('should find entity by alias', async () => {
      const mockEntity = {
        id: 'entity-1',
        name: 'Beaux Walton',
        type: GraphEntityType.PERSON,
        aliases: ['beaux'],
      };

      mockPrismaService.graphEntity.findFirst.mockResolvedValue(mockEntity);

      const result = await service.findByAlias('user-1', 'beaux', GraphEntityType.PERSON);

      expect(result).toEqual(mockEntity);
      expect(mockPrismaService.graphEntity.findFirst).toHaveBeenCalledWith({
        where: {
          userId: 'user-1',
          aliases: { has: 'beaux' },
          type: GraphEntityType.PERSON,
        },
      });
    });
  });

  describe('list', () => {
    it('should list entities with pagination', async () => {
      const mockEntities = [
        { id: 'entity-1', name: 'Beaux', mentionCount: 10 },
        { id: 'entity-2', name: 'Deanna', mentionCount: 5 },
      ];

      mockPrismaService.graphEntity.findMany.mockResolvedValue(mockEntities);
      mockPrismaService.graphEntity.count.mockResolvedValue(2);

      const result = await service.list({
        userId: 'user-1',
        limit: 10,
        offset: 0,
      });

      expect(result.entities).toEqual(mockEntities);
      expect(result.total).toBe(2);
    });

    it('should filter by type', async () => {
      mockPrismaService.graphEntity.findMany.mockResolvedValue([]);
      mockPrismaService.graphEntity.count.mockResolvedValue(0);

      await service.list({
        userId: 'user-1',
        type: GraphEntityType.PLACE,
      });

      expect(mockPrismaService.graphEntity.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            type: GraphEntityType.PLACE,
          }),
        }),
      );
    });

    it('should search in name, aliases, and description', async () => {
      mockPrismaService.graphEntity.findMany.mockResolvedValue([]);
      mockPrismaService.graphEntity.count.mockResolvedValue(0);

      await service.list({
        userId: 'user-1',
        search: 'powell',
      });

      expect(mockPrismaService.graphEntity.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: expect.arrayContaining([
              { name: { contains: 'powell', mode: 'insensitive' } },
            ]),
          }),
        }),
      );
    });
  });

  describe('addAliases', () => {
    it('should add new aliases to existing entity', async () => {
      const mockEntity = {
        id: 'entity-1',
        aliases: ['beaux'],
      };

      const updatedEntity = {
        ...mockEntity,
        aliases: ['beaux', 'bw'],
      };

      mockPrismaService.graphEntity.findUnique.mockResolvedValue(mockEntity);
      mockPrismaService.graphEntity.update.mockResolvedValue(updatedEntity);

      const result = await service.addAliases('entity-1', ['bw', 'beaux']); // beaux should be skipped

      expect(result.aliases).toContain('bw');
      expect(mockPrismaService.graphEntity.update).toHaveBeenCalledWith({
        where: { id: 'entity-1' },
        data: {
          aliases: { push: ['bw'] },
        },
      });
    });

    it('should not update if no new aliases', async () => {
      const mockEntity = {
        id: 'entity-1',
        aliases: ['beaux', 'bw'],
      };

      mockPrismaService.graphEntity.findUnique.mockResolvedValue(mockEntity);

      const result = await service.addAliases('entity-1', ['beaux', 'BW']);

      expect(result).toEqual(mockEntity);
      expect(mockPrismaService.graphEntity.update).not.toHaveBeenCalled();
    });
  });

  describe('getStats', () => {
    it('should return graph statistics', async () => {
      mockPrismaService.graphEntity.count.mockResolvedValue(10);
      mockPrismaService.graphEntity.groupBy.mockResolvedValue([
        { type: 'PERSON', _count: { type: 5 } },
        { type: 'PLACE', _count: { type: 3 } },
        { type: 'ORGANIZATION', _count: { type: 2 } },
      ]);
      mockPrismaService.graphRelationship.count.mockResolvedValue(25);
      mockPrismaService.graphEntityMention.count.mockResolvedValue(50);

      const result = await service.getStats('user-1');

      expect(result).toEqual({
        totalEntities: 10,
        byType: {
          PERSON: 5,
          PLACE: 3,
          ORGANIZATION: 2,
        },
        totalRelationships: 25,
        totalMentions: 50,
      });
    });
  });
});
