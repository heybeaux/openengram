import { Test, TestingModule } from '@nestjs/testing';
import { TeamController } from './team.controller';
import { TeamProfileService } from './team-profile.service';
import { PrismaService } from '../prisma/prisma.service';
import { FileStoreService } from '../common/persistence/file-store.service';
import { ApiKeyOrJwtGuard } from '../common/guards/api-key-or-jwt.guard';

const mockFileStore = {
  load: jest.fn().mockReturnValue(new Map()),
  save: jest.fn().mockResolvedValue(undefined),
  onModuleInit: jest.fn(),
};

describe('TeamController', () => {
  let controller: TeamController;

  const mockPrisma = {
    memory: { findMany: jest.fn().mockResolvedValue([]) },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [TeamController],
      providers: [
        TeamProfileService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: FileStoreService, useValue: mockFileStore },
      ],
    })
      .overrideGuard(ApiKeyOrJwtGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get(TeamController);
  });

  it('should create a team', async () => {
    const result = await controller.create({
      name: 'Alpha Team',
      agentIds: ['agent-1', 'agent-2'],
    });
    expect(result.id).toBeDefined();
    expect(result.name).toBe('Alpha Team');
  });

  it('should list teams', async () => {
    await controller.create({ name: 'Team A', agentIds: ['a1'] });
    const list = await controller.list();
    expect(list.length).toBeGreaterThanOrEqual(1);
  });

  it('should get team by id', async () => {
    const created = await controller.create({ name: 'Team B', agentIds: ['a1'] });
    const found = await controller.getById(created.id);
    expect(found.name).toBe('Team B');
  });

  it('should update a team', async () => {
    const created = await controller.create({ name: 'Team C', agentIds: ['a1'] });
    const updated = await controller.update(created.id, { name: 'Team C Updated' });
    expect(updated.name).toBe('Team C Updated');
  });

  it('should delete a team', async () => {
    const created = await controller.create({ name: 'Team D', agentIds: ['a1'] });
    await controller.delete(created.id);
    await expect(controller.getById(created.id)).rejects.toThrow();
  });
});
