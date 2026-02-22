import { Test, TestingModule } from '@nestjs/testing';
import { AnticipatoryService } from './anticipatory.service';
import { ContextSignalService } from './context-signal.service';
import { StrategySelectorService } from './strategy-selector.service';
import { CircuitBreakerService } from './circuit-breaker.service';
import { FeedbackService } from './feedback/feedback.service';
import { EntityRadiationStrategy } from './strategies/entity-radiation.strategy';
import { InsightInjectionStrategy } from './strategies/insight-injection.strategy';
import { AnticipatoryConfig } from './anticipatory.config';

describe('AnticipatoryService', () => {
  let service: AnticipatoryService;
  let signalService: jest.Mocked<ContextSignalService>;
  let selector: jest.Mocked<StrategySelectorService>;
  let circuitBreaker: jest.Mocked<CircuitBreakerService>;
  let feedbackService: jest.Mocked<FeedbackService>;
  let entityRadiation: jest.Mocked<EntityRadiationStrategy>;
  let insightInjection: jest.Mocked<InsightInjectionStrategy>;

  beforeEach(async () => {
    // Enable ARE for tests
    (AnticipatoryConfig as any).enabled = true;

    signalService = {
      extract: jest.fn(),
      clearCache: jest.fn(),
    } as any;

    selector = {
      select: jest.fn(),
    } as any;

    circuitBreaker = {
      isAllowed: jest.fn().mockReturnValue(true),
      record: jest.fn(),
      isOpen: false,
    } as any;

    feedbackService = {
      getWeights: jest.fn().mockResolvedValue({}),
      recordEvent: jest.fn(),
      flush: jest.fn(),
    } as any;

    entityRadiation = {
      name: 'entity_radiation',
      execute: jest.fn().mockResolvedValue([]),
    } as any;

    insightInjection = {
      name: 'insight_injection',
      execute: jest.fn().mockResolvedValue([]),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AnticipatoryService,
        { provide: ContextSignalService, useValue: signalService },
        { provide: StrategySelectorService, useValue: selector },
        { provide: CircuitBreakerService, useValue: circuitBreaker },
        { provide: FeedbackService, useValue: feedbackService },
        { provide: EntityRadiationStrategy, useValue: entityRadiation },
        { provide: InsightInjectionStrategy, useValue: insightInjection },
      ],
    }).compile();

    service = module.get(AnticipatoryService);
  });

  it('should return empty when not enabled in options', async () => {
    const result = await service.run('test', 'user1', new Set());
    expect(result.memories).toHaveLength(0);
    expect(result.meta.strategiesRun).toHaveLength(0);
  });

  it('should return empty when circuit breaker is open', async () => {
    circuitBreaker.isAllowed.mockReturnValue(false);
    const result = await service.run('test', 'user1', new Set(), { enabled: true });
    expect(result.memories).toHaveLength(0);
    expect(result.meta.circuitBreakerActive).toBe(true);
  });

  it('should extract signals and select strategies', async () => {
    signalService.extract.mockResolvedValue({
      query: 'How is Engram?',
      userId: 'user1',
      entities: ['Engram'],
      topics: ['projects'],
      hourOfDay: 23,
      dayOfWeek: 4,
      excludeMemoryIds: new Set(),
    });
    selector.select.mockReturnValue(['entity_radiation']);

    const result = await service.run('How is Engram?', 'user1', new Set(), { enabled: true });

    expect(signalService.extract).toHaveBeenCalledWith('How is Engram?', 'user1', expect.any(Set));
    expect(selector.select).toHaveBeenCalled();
    expect(entityRadiation.execute).toHaveBeenCalled();
    expect(result.meta.strategiesRun).toEqual(['entity_radiation']);
  });

  it('should merge anticipatory results and filter by salience', async () => {
    signalService.extract.mockResolvedValue({
      query: 'test',
      userId: 'user1',
      entities: ['Engram'],
      topics: [],
      hourOfDay: 12,
      dayOfWeek: 1,
      excludeMemoryIds: new Set(),
    });
    selector.select.mockReturnValue(['entity_radiation']);

    const mockMemory = {
      id: 'mem_1',
      raw: 'Related memory',
      score: 0.7,
      effectiveScore: 0.5,
      createdAt: new Date(),
    };

    entityRadiation.execute.mockResolvedValue([
      {
        memory: mockMemory as any,
        meta: {
          strategy: 'entity_radiation',
          reason: 'Related via Railway',
          salience: 0.65,
          entityPath: ['Engram', 'Railway'],
        },
      },
      {
        memory: { ...mockMemory, id: 'mem_2' } as any,
        meta: {
          strategy: 'entity_radiation',
          reason: 'Related via Prisma',
          salience: 0.1, // Below default threshold
          entityPath: ['Engram', 'Prisma'],
        },
      },
    ]);

    const result = await service.run('test', 'user1', new Set(), { enabled: true });

    expect(result.memories).toHaveLength(1);
    expect(result.memories[0].id).toBe('mem_1');
    expect(result.memories[0].recallSource).toBe('anticipatory');
    expect(result.memories[0].anticipatory?.strategy).toBe('entity_radiation');
  });

  it('should record circuit breaker latency', async () => {
    signalService.extract.mockResolvedValue({
      query: 'test',
      userId: 'user1',
      entities: ['Engram'],
      topics: [],
      hourOfDay: 12,
      dayOfWeek: 1,
      excludeMemoryIds: new Set(),
    });
    selector.select.mockReturnValue(['entity_radiation']);

    await service.run('test', 'user1', new Set(), { enabled: true });

    expect(circuitBreaker.record).toHaveBeenCalledWith(expect.any(Number));
  });

  it('should buffer events via feedback service', async () => {
    signalService.extract.mockResolvedValue({
      query: 'test',
      userId: 'user1',
      entities: ['Engram'],
      topics: [],
      hourOfDay: 12,
      dayOfWeek: 1,
      excludeMemoryIds: new Set(),
    });
    selector.select.mockReturnValue(['entity_radiation']);

    entityRadiation.execute.mockResolvedValue([
      {
        memory: { id: 'mem_1', raw: 'test', score: 0.7, effectiveScore: 0.5, createdAt: new Date() } as any,
        meta: { strategy: 'entity_radiation', reason: 'test', salience: 0.7 },
      },
    ]);

    await service.run('test', 'user1', new Set(), { enabled: true });

    expect(feedbackService.recordEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user1',
        strategy: 'entity_radiation',
        memoryId: 'mem_1',
      }),
    );
  });

  it('should handle strategy timeouts gracefully', async () => {
    signalService.extract.mockResolvedValue({
      query: 'test',
      userId: 'user1',
      entities: ['Engram'],
      topics: [],
      hourOfDay: 12,
      dayOfWeek: 1,
      excludeMemoryIds: new Set(),
    });
    selector.select.mockReturnValue(['entity_radiation']);

    // Simulate a strategy that never resolves (timeout should catch it)
    entityRadiation.execute.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve([]), 5000)),
    );

    // Override budget for test speed
    (AnticipatoryConfig as any).latencyBudgetMs = 50;

    const result = await service.run('test', 'user1', new Set(), { enabled: true });

    // Should return empty (timed out) but not throw
    expect(result.memories).toHaveLength(0);
  }, 10000);
});
