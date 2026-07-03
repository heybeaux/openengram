import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { ClusteringController } from './clustering.controller';
import { ClusteringService } from './clustering.service';
import { ApiKeyOrJwtGuard } from '../common/guards/api-key-or-jwt.guard';

describe('ClusteringController', () => {
  let controller: ClusteringController;
  let service: jest.Mocked<ClusteringService>;

  beforeEach(async () => {
    const mockService = {
      run: jest.fn(),
      listClusters: jest.fn(),
      getCluster: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ClusteringController],
      providers: [{ provide: ClusteringService, useValue: mockService }],
    })
      .overrideGuard(ApiKeyOrJwtGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<ClusteringController>(ClusteringController);
    service = module.get(ClusteringService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('POST /run', () => {
    it('should trigger clustering run', async () => {
      const expected = {
        clustersCreated: 3,
        memoriesClustered: 15,
        memoriesTotal: 20,
        noisePoints: 5,
        dryRun: false,
        durationMs: 1234,
      };
      service.run.mockResolvedValue(expected);

      const result = await controller.run({ userId: 'user1' });
      expect(result).toEqual(expected);
      expect(service.run).toHaveBeenCalledWith({
        userId: 'user1',
        dryRun: undefined,
      });
    });

    it('should pass dryRun from query param', async () => {
      service.run.mockResolvedValue({} as any);
      await controller.run({}, 'true');
      expect(service.run).toHaveBeenCalledWith({ dryRun: true });
    });
  });

  describe('GET /clusters', () => {
    it('should return cluster list', async () => {
      service.listClusters.mockResolvedValue([
        {
          id: 'c1',
          label: 'Test',
          description: null,
          memberCount: 5,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);

      const result = await controller.listClusters();
      expect(result).toHaveLength(1);
    });
  });

  describe('GET /clusters/:id', () => {
    it('should throw NotFoundException for missing cluster', async () => {
      service.getCluster.mockResolvedValue(null);
      await expect(controller.getCluster('bad-id')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
