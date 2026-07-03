import { TrustProfileService } from './trust-profile.service';

// Mock TaskCompletionService
const mockCompletions = [
  {
    id: '1',
    taskId: 't1',
    delegatedTo: 'agent-1',
    delegatedBy: 'user-1',
    taskDescription: 'Test task',
    domain: 'coding',
    outcome: 'success',
    durationMs: 1000,
    qualitySignals: {},
    metadata: {},
    createdAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
  },
  {
    id: '2',
    taskId: 't2',
    delegatedTo: 'agent-1',
    delegatedBy: 'user-1',
    taskDescription: 'Test task 2',
    domain: 'writing',
    outcome: 'partial',
    durationMs: 2000,
    qualitySignals: {},
    metadata: {},
    createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
  },
];

const mockTaskCompletionService = {
  getCompletionsByAgent: jest.fn().mockResolvedValue(mockCompletions),
} as any;

describe('TrustProfileService — Trust History & Bulk', () => {
  let service: TrustProfileService;

  beforeEach(() => {
    service = new TrustProfileService(mockTaskCompletionService);
  });

  describe('getTrustHistory', () => {
    it('should return history array with correct length', async () => {
      const result = await service.getTrustHistory('agent-1', 7);
      expect(result.history).toHaveLength(7);
    });

    it('should have date, overall, and domains fields', async () => {
      const result = await service.getTrustHistory('agent-1', 7);
      for (const point of result.history) {
        expect(point).toHaveProperty('date');
        expect(point).toHaveProperty('overall');
        expect(point).toHaveProperty('domains');
      }
    });

    it('should show non-zero scores after task dates', async () => {
      const result = await service.getTrustHistory('agent-1', 7);
      // Last entry (today) should have scores since tasks exist
      const last = result.history[result.history.length - 1];
      expect(last.overall).toBeGreaterThan(0);
      expect(last.domains).toHaveProperty('coding');
    });

    it('should return empty history for unknown agent', async () => {
      mockTaskCompletionService.getCompletionsByAgent.mockResolvedValueOnce([]);
      const result = await service.getTrustHistory('unknown', 7);
      expect(result.history).toHaveLength(7);
      expect(result.history[0].overall).toBe(0);
    });

    it('should default to 30 days', async () => {
      const result = await service.getTrustHistory('agent-1');
      expect(result.history).toHaveLength(30);
    });
  });

  describe('getBulkProfiles', () => {
    it('should return profiles for multiple agents', async () => {
      const result = await service.getBulkProfiles(['agent-1', 'agent-2']);
      expect(result.profiles).toHaveLength(2);
      expect(result.profiles[0].agentId).toBe('agent-1');
    });

    it('should return empty array for empty input', async () => {
      const result = await service.getBulkProfiles([]);
      expect(result.profiles).toHaveLength(0);
    });
  });
});
