import { Test, TestingModule } from '@nestjs/testing';
import { IdentityService } from './identity.service';
import { PrismaService } from '../prisma/prisma.service';
import { MemoryLayer, MemoryType, SubjectType } from '@prisma/client';

describe('IdentityService', () => {
  let service: IdentityService;
  let prisma: any;

  const mockMemories = [
    {
      id: 'mem-1',
      raw: 'Successfully deployed the API to Railway',
      layer: MemoryLayer.IDENTITY,
      memoryType: MemoryType.FACT,
      confidence: 0.9,
      createdAt: new Date('2025-01-01'),
      source: 'AGENT_REFLECTION',
      extraction: { topics: ['coding', 'deployment'], what: 'Deployed API to Railway' },
      metadata: null,
    },
    {
      id: 'mem-2',
      raw: 'I prefer using TypeScript over JavaScript',
      layer: MemoryLayer.IDENTITY,
      memoryType: MemoryType.PREFERENCE,
      confidence: 0.95,
      createdAt: new Date('2025-01-10'),
      source: 'EXPLICIT_STATEMENT',
      extraction: { topics: ['preferences', 'coding'], what: 'Prefers TypeScript over JavaScript' },
      metadata: null,
    },
    {
      id: 'mem-3',
      raw: 'Fixed the SSRF vulnerability in the proxy service',
      layer: MemoryLayer.IDENTITY,
      memoryType: MemoryType.LESSON,
      confidence: 0.85,
      createdAt: new Date('2025-01-15'),
      source: 'AGENT_REFLECTION',
      extraction: { topics: ['technical', 'security'], what: 'Fixed SSRF vulnerability' },
      metadata: null,
    },
    {
      id: 'mem-4',
      raw: 'Always use dark mode for code editors',
      layer: MemoryLayer.IDENTITY,
      memoryType: MemoryType.PREFERENCE,
      confidence: 0.9,
      createdAt: new Date('2025-01-20'),
      source: 'EXPLICIT_STATEMENT',
      extraction: { topics: ['preferences', 'interface'], what: 'Uses dark mode' },
      metadata: null,
    },
    {
      id: 'mem-5',
      raw: 'User allergic to peanuts - never include in meal suggestions',
      layer: MemoryLayer.IDENTITY,
      memoryType: MemoryType.CONSTRAINT,
      confidence: 1.0,
      createdAt: new Date('2025-02-01'),
      source: 'EXPLICIT_STATEMENT',
      extraction: { topics: ['health', 'safety'], what: 'Allergic to peanuts' },
      metadata: null,
    },
  ];

  beforeEach(async () => {
    prisma = {
      agent: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'agent-1',
          name: 'TestAgent',
          createdAt: new Date('2024-12-01'),
        }),
      },
      memory: {
        findMany: jest.fn().mockResolvedValue(mockMemories),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IdentityService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<IdentityService>(IdentityService);
  });

  describe('getIdentityProfile', () => {
    it('should return a compiled identity profile', async () => {
      const profile = await service.getIdentityProfile('agent-1');

      expect(profile.agentId).toBe('agent-1');
      expect(profile.name).toBe('TestAgent');
      expect(profile.createdAt).toBeDefined();
      expect(profile.capabilities).toBeDefined();
      expect(profile.preferences).toBeDefined();
      expect(profile.trustSignals).toBeDefined();
      expect(profile.recentPatterns).toBeDefined();
    });

    it('should extract trust signals correctly', async () => {
      const profile = await service.getIdentityProfile('agent-1');

      expect(profile.trustSignals.totalMemories).toBeGreaterThan(0);
      expect(profile.trustSignals.identityMemories).toBeGreaterThan(0);
      expect(profile.trustSignals.averageConfidence).toBeGreaterThan(0);
      expect(profile.trustSignals.oldestMemory).toBeDefined();
      expect(profile.trustSignals.newestMemory).toBeDefined();
    });
  });

  describe('extractCapabilities', () => {
    it('should detect capability signals from text', () => {
      const memories = [
        { raw: 'Successfully deployed the API to Railway', createdAt: new Date(), extraction: null },
        { raw: 'Fixed the SSRF vulnerability in the proxy service', createdAt: new Date(), extraction: null },
        { raw: 'Built a real-time notification system', createdAt: new Date(), extraction: null },
      ];

      const capabilities = service.extractCapabilities(memories);

      expect(capabilities.length).toBeGreaterThan(0);
      expect(capabilities.some((c) => c.capability.toLowerCase().includes('api'))).toBe(true);
    });

    it('should return empty array for non-capability text', () => {
      const memories = [
        { raw: 'The weather is nice today', createdAt: new Date(), extraction: null },
      ];

      const capabilities = service.extractCapabilities(memories);
      expect(capabilities.length).toBe(0);
    });
  });

  describe('extractPreferences', () => {
    it('should detect preference signals from text', () => {
      const memories = [
        { raw: 'I prefer using TypeScript over JavaScript', memoryType: 'PREFERENCE' as MemoryType, extraction: { what: 'Prefers TypeScript' }, metadata: null },
        { raw: 'Always use dark mode for code editors', memoryType: 'PREFERENCE' as MemoryType, extraction: { what: 'Uses dark mode' }, metadata: null },
      ];

      const preferences = service.extractPreferences(memories);

      expect(preferences.length).toBeGreaterThan(0);
      expect(preferences.some((p) => p.strength === 'strong')).toBe(true);
    });

    it('should use structured metadata when available', () => {
      const memories = [
        {
          raw: 'Prefers oat milk',
          memoryType: 'PREFERENCE' as MemoryType,
          extraction: null,
          metadata: { preferenceCategory: 'food', preference: 'oat milk', preferenceStrength: 'strong' },
        },
      ];

      const preferences = service.extractPreferences(memories);

      expect(preferences.length).toBe(1);
      expect(preferences[0].category).toBe('food');
      expect(preferences[0].preference).toBe('oat milk');
      expect(preferences[0].strength).toBe('strong');
    });

    it('should fall back to pattern matching for PREFERENCE type memories', () => {
      const memories = [
        {
          raw: 'Uses NeoVim as primary editor',
          memoryType: 'PREFERENCE' as MemoryType,
          extraction: { what: 'Uses NeoVim as primary editor' },
          metadata: null,
        },
      ];

      const preferences = service.extractPreferences(memories);
      expect(preferences.length).toBe(1);
    });
  });
});
