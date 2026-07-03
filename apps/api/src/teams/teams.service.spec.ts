import { TeamsService } from './teams.service';
import { NotFoundException } from '@nestjs/common';

describe('TeamsService', () => {
  let service: TeamsService;
  let prisma: any;

  const userId = 'user-1';
  const teamId = 'team-1';
  const now = new Date('2026-01-01');

  const mockTeam = {
    id: teamId,
    name: 'Alpha Team',
    description: 'Test team',
    userId,
    sharedCapabilities: ['code_review', 'deploy'],
    trustScore: 0.85,
    collaborationCount: 5,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    members: [
      { id: 'mem-1', agentId: 'agent-a', role: 'lead', joinedAt: now },
      { id: 'mem-2', agentId: 'agent-b', role: null, joinedAt: now },
    ],
  };

  beforeEach(() => {
    prisma = {
      agentTeam: {
        create: jest.fn().mockResolvedValue(mockTeam),
        findMany: jest.fn().mockResolvedValue([mockTeam]),
        findFirst: jest.fn().mockResolvedValue(mockTeam),
        update: jest.fn().mockResolvedValue(mockTeam),
      },
      agentTeamMember: {
        create: jest.fn().mockResolvedValue(mockTeam.members[0]),
        delete: jest.fn().mockResolvedValue(mockTeam.members[0]),
      },
      agentTeamCollaboration: {
        create: jest.fn().mockResolvedValue({
          id: 'collab-1',
          teamId,
          taskDescription: 'Fix bug',
          participantAgentIds: ['agent-a', 'agent-b'],
          outcome: 'success',
          score: 0.9,
          createdAt: now,
        }),
        findMany: jest.fn().mockResolvedValue([]),
      },
    };

    service = new TeamsService(prisma);
  });

  describe('create', () => {
    it('should create a team with members', async () => {
      const result = await service.create(userId, {
        name: 'Alpha Team',
        sharedCapabilities: ['code_review'],
        members: [{ agentId: 'agent-a', role: 'lead' }],
      });

      expect(result.id).toBe(teamId);
      expect(result.name).toBe('Alpha Team');
      expect(result.members).toHaveLength(2);
      expect(prisma.agentTeam.create).toHaveBeenCalled();
    });
  });

  describe('findAll', () => {
    it('should return all teams for a user', async () => {
      const result = await service.findAll(userId);
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('Alpha Team');
    });
  });

  describe('findOne', () => {
    it('should return a team by id', async () => {
      const result = await service.findOne(userId, teamId);
      expect(result.id).toBe(teamId);
    });

    it('should throw NotFoundException if team not found', async () => {
      prisma.agentTeam.findFirst.mockResolvedValue(null);
      await expect(service.findOne(userId, 'nope')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('update', () => {
    it('should update a team', async () => {
      const result = await service.update(userId, teamId, {
        name: 'Beta Team',
      });
      expect(result.id).toBe(teamId);
      expect(prisma.agentTeam.update).toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('should soft-delete a team', async () => {
      const result = await service.remove(userId, teamId);
      expect(result.deleted).toBe(true);
      expect(prisma.agentTeam.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { deletedAt: expect.any(Date) },
        }),
      );
    });
  });

  describe('addMember', () => {
    it('should add a member to a team', async () => {
      const result = await service.addMember(userId, teamId, {
        agentId: 'agent-c',
        role: 'member',
      });
      expect(result.agentId).toBe('agent-a');
      expect(prisma.agentTeamMember.create).toHaveBeenCalled();
    });
  });

  describe('recordCollaboration', () => {
    it('should record a collaboration and update trust score', async () => {
      prisma.agentTeamCollaboration.findMany.mockResolvedValue([
        { score: 0.9 },
        { score: 0.8 },
      ]);

      const result = await service.recordCollaboration(userId, teamId, {
        taskDescription: 'Fix bug',
        participantAgentIds: ['agent-a', 'agent-b'],
        outcome: 'success',
        score: 0.9,
      });

      expect(result.taskDescription).toBe('Fix bug');
      expect(prisma.agentTeam.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            trustScore: expect.closeTo(0.85, 5),
            collaborationCount: 2,
          }),
        }),
      );
    });
  });
});
