import { Test, TestingModule } from '@nestjs/testing';
import { ChallengeController } from './challenge.controller';
import { ChallengeService } from './challenge.service';
import { PrismaService } from '../prisma/prisma.service';
import { ApiKeyOrJwtGuard } from '../common/guards/api-key-or-jwt.guard';

const mockPrisma = {
  identityChallenge: {
    findMany: jest.fn().mockResolvedValue([]),
    upsert: jest.fn().mockResolvedValue({}),
  },
  identityAgentProfile: {
    findMany: jest.fn().mockResolvedValue([]),
    upsert: jest.fn().mockResolvedValue({}),
  },
};

describe('ChallengeController', () => {
  let controller: ChallengeController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ChallengeController],
      providers: [
        ChallengeService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    })
      .overrideGuard(ApiKeyOrJwtGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get(ChallengeController);
  });

  it('should create a challenge', async () => {
    const result = await controller.create({
      taskDescription: 'Unsafe task',
      challengeType: 'unsafe',
      reasoning: 'Dangerous',
    });
    expect(result.id).toBeDefined();
    expect(result.challengeType).toBe('unsafe');
  });

  it('should list challenges', async () => {
    await controller.create({
      taskDescription: 'Task',
      challengeType: 'underspecified',
      reasoning: 'Missing details',
    });
    const list = await controller.list();
    expect(list.length).toBeGreaterThanOrEqual(1);
  });

  it('should get by id', async () => {
    const created = await controller.create({
      taskDescription: 'Task',
      challengeType: 'unsafe',
      reasoning: 'Dangerous',
    });
    const found = await controller.getById(created.id);
    expect(found.id).toBe(created.id);
  });

  it('should resolve a challenge', async () => {
    const created = await controller.create({
      taskDescription: 'Task',
      challengeType: 'unsafe',
      reasoning: 'Dangerous',
    });
    const resolved = await controller.resolve(created.id, {
      resolution: 'accepted',
      resolvedBy: 'admin',
    });
    expect(resolved.resolution).toBe('accepted');
  });
});
