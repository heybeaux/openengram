import { Test, TestingModule } from '@nestjs/testing';
import { IdentityController } from './identity.controller';
import { IdentityService } from './identity.service';

describe('IdentityController', () => {
  let controller: IdentityController;
  let service: IdentityService;

  const mockProfile = {
    agentId: 'agent-1',
    name: 'TestAgent',
    createdAt: '2024-12-01T00:00:00.000Z',
    capabilities: [
      { capability: 'deployed the API to Railway', evidence: 'Successfully deployed...', confidence: 0.8, firstSeen: '2025-01-01T00:00:00.000Z', lastSeen: '2025-01-01T00:00:00.000Z', occurrences: 1 },
    ],
    preferences: [
      { category: 'tooling', preference: 'using TypeScript over JavaScript', strength: 'strong' as const, source: 'I prefer using TypeScript' },
    ],
    trustSignals: {
      totalMemories: 5,
      identityMemories: 5,
      lessonMemories: 1,
      constraintMemories: 1,
      averageConfidence: 0.92,
      oldestMemory: '2025-01-01T00:00:00.000Z',
      newestMemory: '2025-02-01T00:00:00.000Z',
    },
    recentPatterns: [],
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [IdentityController],
      providers: [
        {
          provide: IdentityService,
          useValue: {
            getIdentityProfile: jest.fn().mockResolvedValue(mockProfile),
          },
        },
      ],
    }).compile();

    controller = module.get<IdentityController>(IdentityController);
    service = module.get<IdentityService>(IdentityService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('getIdentity', () => {
    it('should return identity profile', async () => {
      const result = await controller.getIdentity('agent-1');

      expect(result.agentId).toBe('agent-1');
      expect(result.name).toBe('TestAgent');
      expect(result.capabilities).toHaveLength(1);
      expect(result.preferences).toHaveLength(1);
      expect(result.trustSignals.totalMemories).toBe(5);
      expect(service.getIdentityProfile).toHaveBeenCalledWith('agent-1');
    });
  });
});
