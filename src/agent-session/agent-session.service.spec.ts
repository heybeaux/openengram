import { Test, TestingModule } from '@nestjs/testing';
import { AgentSessionService } from './agent-session.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotFoundException } from '@nestjs/common';

describe('AgentSessionService', () => {
  let service: AgentSessionService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      agentSession: {
        upsert: jest.fn(),
        findUnique: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AgentSessionService,
        { provide: PrismaService, useValue: prisma },
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
      expect(result).toEqual(expected);
      expect(prisma.agentSession.upsert).toHaveBeenCalledWith({
        where: { sessionKey: dto.sessionKey },
        update: {
          label: dto.label,
          taskDescription: undefined,
          status: 'ACTIVE',
          endedAt: null,
        },
        create: {
          sessionKey: dto.sessionKey,
          parentKey: dto.parentKey,
          label: dto.label,
          taskDescription: undefined,
        },
      });
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
});
