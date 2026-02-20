import { PortableIdentityService, AgentExportBundle } from './portable-identity.service';
import { NotFoundException, BadRequestException } from '@nestjs/common';

describe('PortableIdentityService', () => {
  let service: PortableIdentityService;
  let prisma: any;

  const userId = 'user-1';
  const agentId = 'agent-1';
  const now = new Date('2026-01-01');

  const mockAgent = {
    id: agentId,
    name: 'TestAgent',
    createdAt: now,
    deletedAt: null,
  };

  beforeEach(() => {
    prisma = {
      agent: {
        findFirst: jest.fn().mockResolvedValue(mockAgent),
      },
      identitySnapshot: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      agentCapabilityProfile: {
        findMany: jest.fn().mockResolvedValue([
          {
            capability: 'code_review',
            confidence: 0.9,
            evidenceCount: 15,
            successRate: 0.87,
            avgDurationMs: 5000,
            notes: 'Strong at Typescript',
          },
        ]),
        create: jest.fn().mockResolvedValue({}),
      },
      memory: {
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockResolvedValue({}),
      },
      trustScore: {
        findMany: jest.fn().mockResolvedValue([
          {
            category: 'deploy',
            score: 0.92,
            signalCount: 10,
            computedAt: now,
          },
        ]),
        create: jest.fn().mockResolvedValue({}),
      },
      agentWorkStyle: {
        findMany: jest.fn().mockResolvedValue([
          { dimension: 'verbosity', value: 'concise', sampleCount: 20 },
        ]),
        create: jest.fn().mockResolvedValue({}),
      },
    };

    service = new PortableIdentityService(prisma);
  });

  describe('exportAgent', () => {
    it('should export a complete identity bundle', async () => {
      const result = await service.exportAgent(userId, agentId);

      expect(result.version).toBe('1.0');
      expect(result.agent.id).toBe(agentId);
      expect(result.agent.name).toBe('TestAgent');
      expect(result.capabilities).toHaveLength(1);
      expect(result.capabilities[0].capability).toBe('code_review');
      expect(result.trustHistory).toHaveLength(1);
      expect(result.workStyle).toHaveLength(1);
    });

    it('should throw NotFoundException for unknown agent', async () => {
      prisma.agent.findFirst.mockResolvedValue(null);
      await expect(service.exportAgent(userId, 'unknown')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should include identity snapshot when available', async () => {
      prisma.identitySnapshot.findFirst.mockResolvedValue({
        capabilities: [{ name: 'test', confidence: 0.8 }],
        preferences: { theme: 'dark' },
        trustScores: { overall: 0.9 },
        behavioralTraits: [{ trait: 'verbose' }],
      });

      const result = await service.exportAgent(userId, agentId);
      expect(result.identitySnapshot).not.toBeNull();
      expect(result.identitySnapshot.preferences.theme).toBe('dark');
    });
  });

  describe('importAgent', () => {
    const validBundle: AgentExportBundle = {
      version: '1.0',
      exportedAt: now.toISOString(),
      agent: { id: 'other-agent', name: 'OtherAgent', createdAt: now.toISOString() },
      identitySnapshot: null,
      capabilities: [
        {
          capability: 'data_analysis',
          confidence: 0.8,
          evidenceCount: 10,
          successRate: 0.85,
          avgDurationMs: 3000,
          notes: null,
        },
      ],
      preferences: [],
      trustHistory: [
        { category: 'analysis', score: 0.88, signalCount: 5, computedAt: now.toISOString() },
      ],
      workStyle: [
        { dimension: 'tool_usage', value: { primary: 'python' }, sampleCount: 15 },
      ],
      keyMemories: [
        {
          raw: 'Always validate inputs before processing',
          layer: 'IDENTITY',
          memoryType: 'CONSTRAINT',
          importance: 0.95,
          createdAt: now.toISOString(),
        },
      ],
    };

    it('should import a valid bundle', async () => {
      // No existing capabilities
      prisma.agentCapabilityProfile.findMany.mockResolvedValue([]);
      prisma.agentWorkStyle.findMany.mockResolvedValue([]);
      prisma.memory.findMany.mockResolvedValue([]);

      const result = await service.importAgent(userId, agentId, validBundle);

      expect(result.agentId).toBe(agentId);
      expect(result.imported.capabilities).toBe(1);
      expect(result.imported.trustScores).toBe(1);
      expect(result.imported.workStyles).toBe(1);
      expect(result.imported.keyMemories).toBe(1);
    });

    it('should deduplicate existing capabilities', async () => {
      prisma.agentCapabilityProfile.findMany.mockResolvedValue([
        { capability: 'data_analysis' },
      ]);
      prisma.agentWorkStyle.findMany.mockResolvedValue([]);
      prisma.memory.findMany.mockResolvedValue([]);

      const result = await service.importAgent(userId, agentId, validBundle);

      expect(result.imported.capabilities).toBe(0);
      expect(result.skipped.duplicateCapabilities).toBe(1);
    });

    it('should deduplicate existing memories by raw content', async () => {
      prisma.agentCapabilityProfile.findMany.mockResolvedValue([]);
      prisma.agentWorkStyle.findMany.mockResolvedValue([]);
      prisma.memory.findMany.mockResolvedValue([
        { raw: 'Always validate inputs before processing' },
      ]);

      const result = await service.importAgent(userId, agentId, validBundle);

      expect(result.imported.keyMemories).toBe(0);
      expect(result.skipped.duplicateMemories).toBe(1);
    });

    it('should reject unsupported bundle version', async () => {
      const badBundle = { ...validBundle, version: '99.0' as any };
      await expect(
        service.importAgent(userId, agentId, badBundle),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject bundle without agent name', async () => {
      const badBundle = { ...validBundle, agent: { id: 'x', name: '', createdAt: '' } };
      await expect(
        service.importAgent(userId, agentId, badBundle),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw if target agent not found', async () => {
      prisma.agent.findFirst.mockResolvedValue(null);
      await expect(
        service.importAgent(userId, 'unknown', validBundle),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
