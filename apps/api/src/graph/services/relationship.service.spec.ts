import { Test, TestingModule } from '@nestjs/testing';
import { RelationshipService } from './relationship.service';
import { PrismaService } from '../../prisma/prisma.service';
import { GraphRelationshipType } from '@prisma/client';
import { BadRequestException, NotFoundException } from '@nestjs/common';

describe('RelationshipService', () => {
  let service: RelationshipService;
  let prisma: PrismaService;

  const mockPrismaService = {
    graphRelationship: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    graphEntity: {
      findUnique: jest.fn(),
    },
    $queryRaw: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RelationshipService,
        { provide: PrismaService, useValue: mockPrismaService },
      ],
    }).compile();

    service = module.get<RelationshipService>(RelationshipService);
    prisma = module.get<PrismaService>(PrismaService);
    jest.clearAllMocks();
  });

  describe('create', () => {
    it('should create a relationship', async () => {
      const mockRelationship = {
        id: 'rel-1',
        userId: 'user-1',
        sourceEntityId: 'entity-1',
        targetEntityId: 'entity-2',
        type: GraphRelationshipType.SPOUSE_OF,
        weight: 1.0,
        properties: {},
        sourceMemoryIds: ['mem-1'],
        isInferred: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockPrismaService.graphRelationship.create.mockResolvedValue(
        mockRelationship,
      );
      mockPrismaService.graphRelationship.findUnique.mockResolvedValue(null); // No inverse exists

      const result = await service.create({
        userId: 'user-1',
        sourceEntityId: 'entity-1',
        targetEntityId: 'entity-2',
        type: GraphRelationshipType.SPOUSE_OF,
        sourceMemoryIds: ['mem-1'],
      });

      expect(result).toEqual(mockRelationship);
      expect(mockPrismaService.graphRelationship.create).toHaveBeenCalledTimes(
        2,
      ); // Original + inverse for symmetric
    });

    it('should reject self-referential relationships', async () => {
      await expect(
        service.create({
          userId: 'user-1',
          sourceEntityId: 'entity-1',
          targetEntityId: 'entity-1',
          type: GraphRelationshipType.FRIEND_OF,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should not create inverse for non-symmetric relationships', async () => {
      const mockRelationship = {
        id: 'rel-1',
        userId: 'user-1',
        sourceEntityId: 'entity-1',
        targetEntityId: 'entity-2',
        type: GraphRelationshipType.PARENT_OF,
        weight: 1.0,
      };

      mockPrismaService.graphRelationship.create.mockResolvedValue(
        mockRelationship,
      );

      await service.create({
        userId: 'user-1',
        sourceEntityId: 'entity-1',
        targetEntityId: 'entity-2',
        type: GraphRelationshipType.PARENT_OF,
      });

      // Only one create call (no inverse for PARENT_OF)
      expect(mockPrismaService.graphRelationship.create).toHaveBeenCalledTimes(
        1,
      );
    });
  });

  describe('upsert', () => {
    it('should create new relationship if not exists', async () => {
      const mockRelationship = {
        id: 'rel-1',
        userId: 'user-1',
        sourceEntityId: 'entity-1',
        targetEntityId: 'entity-2',
        type: GraphRelationshipType.LIVES_IN,
        weight: 0.9,
        properties: {},
        sourceMemoryIds: ['mem-1'],
      };

      mockPrismaService.graphRelationship.findUnique.mockResolvedValue(null);
      mockPrismaService.graphRelationship.create.mockResolvedValue(
        mockRelationship,
      );

      const result = await service.upsert({
        userId: 'user-1',
        sourceEntityId: 'entity-1',
        targetEntityId: 'entity-2',
        type: GraphRelationshipType.LIVES_IN,
        weight: 0.9,
        sourceMemoryIds: ['mem-1'],
      });

      expect(result.created).toBe(true);
      expect(result.relationship).toEqual(mockRelationship);
    });

    it('should update existing relationship', async () => {
      const existingRel = {
        id: 'rel-1',
        userId: 'user-1',
        sourceEntityId: 'entity-1',
        targetEntityId: 'entity-2',
        type: GraphRelationshipType.LIVES_IN,
        weight: 0.8,
        properties: { since: '2020' },
        sourceMemoryIds: ['mem-1'],
      };

      const updatedRel = {
        ...existingRel,
        weight: 0.84, // Blended weight
        sourceMemoryIds: ['mem-1', 'mem-2'],
      };

      mockPrismaService.graphRelationship.findUnique.mockResolvedValue(
        existingRel,
      );
      mockPrismaService.graphRelationship.update.mockResolvedValue(updatedRel);

      const result = await service.upsert({
        userId: 'user-1',
        sourceEntityId: 'entity-1',
        targetEntityId: 'entity-2',
        type: GraphRelationshipType.LIVES_IN,
        weight: 1.0,
        sourceMemoryIds: ['mem-2'],
      });

      expect(result.created).toBe(false);
      expect(mockPrismaService.graphRelationship.update).toHaveBeenCalled();
    });
  });

  describe('isSymmetric', () => {
    it('should identify symmetric relationships', () => {
      expect(service.isSymmetric(GraphRelationshipType.SPOUSE_OF)).toBe(true);
      expect(service.isSymmetric(GraphRelationshipType.SIBLING_OF)).toBe(true);
      expect(service.isSymmetric(GraphRelationshipType.FRIEND_OF)).toBe(true);
      expect(service.isSymmetric(GraphRelationshipType.COLLEAGUE_OF)).toBe(
        true,
      );
      expect(service.isSymmetric(GraphRelationshipType.RELATED_TO)).toBe(true);
    });

    it('should identify non-symmetric relationships', () => {
      expect(service.isSymmetric(GraphRelationshipType.PARENT_OF)).toBe(false);
      expect(service.isSymmetric(GraphRelationshipType.CHILD_OF)).toBe(false);
      expect(service.isSymmetric(GraphRelationshipType.LIVES_IN)).toBe(false);
      expect(service.isSymmetric(GraphRelationshipType.OWNS)).toBe(false);
    });
  });

  describe('list', () => {
    it('should list relationships for a user', async () => {
      const mockRelationships = [
        {
          id: 'rel-1',
          type: GraphRelationshipType.SPOUSE_OF,
          sourceEntity: { id: 'e1', name: 'Beaux', type: 'PERSON' },
          targetEntity: { id: 'e2', name: 'Deanna', type: 'PERSON' },
        },
      ];

      mockPrismaService.graphRelationship.findMany.mockResolvedValue(
        mockRelationships,
      );

      const result = await service.list({ userId: 'user-1' });

      expect(result).toEqual(mockRelationships);
    });

    it('should filter by entity and direction', async () => {
      mockPrismaService.graphRelationship.findMany.mockResolvedValue([]);

      await service.list({
        userId: 'user-1',
        entityId: 'entity-1',
        direction: 'outgoing',
      });

      expect(mockPrismaService.graphRelationship.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            sourceEntityId: 'entity-1',
          }),
        }),
      );
    });
  });

  describe('getForEntity', () => {
    it('should get all relationships for an entity (both directions)', async () => {
      mockPrismaService.graphRelationship.findMany.mockResolvedValue([]);

      await service.getForEntity('entity-1', 'both');

      expect(mockPrismaService.graphRelationship.findMany).toHaveBeenCalledWith(
        {
          where: {
            OR: [
              { sourceEntityId: 'entity-1' },
              { targetEntityId: 'entity-1' },
            ],
          },
          include: expect.any(Object),
        },
      );
    });
  });

  describe('traverse', () => {
    it('should traverse graph from starting entity', async () => {
      const mockEntity = { id: 'entity-1', name: 'Beaux', userId: 'user-1' };
      mockPrismaService.graphEntity.findUnique.mockResolvedValue(mockEntity);

      mockPrismaService.$queryRaw.mockResolvedValue([
        {
          id: 'entity-1',
          name: 'Beaux',
          type: 'PERSON',
          depth: 0,
          rel_id: null,
          source_id: null,
          target_id: null,
          rel_type: null,
          weight: null,
        },
        {
          id: 'entity-2',
          name: 'Deanna',
          type: 'PERSON',
          depth: 1,
          rel_id: 'rel-1',
          source_id: 'entity-1',
          target_id: 'entity-2',
          rel_type: 'SPOUSE_OF',
          weight: 1.0,
        },
      ]);

      const result = await service.traverse({
        userId: 'user-1',
        startEntityId: 'entity-1',
        maxDepth: 2,
      });

      expect(result.nodes).toHaveLength(2);
      expect(result.edges).toHaveLength(1);
      expect(result.nodes[0].name).toBe('Beaux');
      expect(result.nodes[1].name).toBe('Deanna');
    });

    it('should throw if start entity not found', async () => {
      mockPrismaService.graphEntity.findUnique.mockResolvedValue(null);

      await expect(
        service.traverse({
          userId: 'user-1',
          startEntityId: 'nonexistent',
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('findPath', () => {
    it('should find path between two entities', async () => {
      mockPrismaService.$queryRaw.mockResolvedValue([
        {
          path: ['entity-1', 'entity-2', 'entity-3'],
          rel_path: ['rel-1', 'rel-2'],
        },
      ]);

      const result = await service.findPath('user-1', 'entity-1', 'entity-3');

      expect(result).toHaveLength(3);
      expect(result[0].entityId).toBe('entity-1');
      expect(result[0].relationshipId).toBeNull();
      expect(result[1].entityId).toBe('entity-2');
      expect(result[1].relationshipId).toBe('rel-1');
    });

    it('should return empty array if no path found', async () => {
      mockPrismaService.$queryRaw.mockResolvedValue([]);

      const result = await service.findPath('user-1', 'entity-1', 'entity-99');

      expect(result).toEqual([]);
    });
  });
});
