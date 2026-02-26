import { LinearSignalService } from './linear-signal.service';

describe('LinearSignalService', () => {
  let service: LinearSignalService;
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
    jest.restoreAllMocks();
  });

  describe('when not configured', () => {
    it('returns empty observations without API key', async () => {
      delete process.env.LINEAR_API_KEY;
      service = new LinearSignalService();

      const result = await service.collect(null, { maxQueries: 10 });
      expect(result.observations).toEqual([]);
      expect(result.checkpoint).toEqual({});
    });

    it('preserves existing checkpoint when not configured', async () => {
      delete process.env.LINEAR_API_KEY;
      service = new LinearSignalService();

      const existing = { lastCheckedAt: '2025-01-01T00:00:00Z' };
      const result = await service.collect(existing, { maxQueries: 10 });
      expect(result.checkpoint).toEqual(existing);
    });
  });

  describe('when configured', () => {
    beforeEach(() => {
      process.env.LINEAR_API_KEY = 'lin_api_test123';
      service = new LinearSignalService();
    });

    it('has name "linear"', () => {
      expect(service.name).toBe('linear');
    });

    it('collects updated issues', async () => {
      const mockResponse = {
        data: {
          issues: {
            nodes: [
              {
                id: '1',
                identifier: 'ENG-1',
                title: 'Fix bug',
                updatedAt: new Date().toISOString(),
                createdAt: new Date().toISOString(),
                state: { name: 'In Progress', type: 'started' },
                assignee: { name: 'Kit' },
                labels: { nodes: [{ name: 'bug' }] },
                priority: 2,
              },
            ],
          },
        },
      };

      jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const result = await service.collect(null, { maxQueries: 1 });

      expect(result.observations).toHaveLength(1);
      expect(result.observations[0].source).toBe('linear');
      expect(result.observations[0].content).toContain('ENG-1');
      expect(result.observations[0].content).toContain('In Progress');
      expect(result.checkpoint.lastCheckedAt).toBeDefined();
    });

    it('collects multiple signal types with sufficient budget', async () => {
      const issueNode = {
        id: '1',
        identifier: 'ENG-1',
        title: 'Test',
        updatedAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        state: { name: 'Done', type: 'completed' },
        assignee: { name: 'Kit' },
        labels: { nodes: [] },
        priority: 1,
      };
      const commentNode = {
        id: 'c1',
        body: 'Looks good',
        createdAt: new Date().toISOString(),
        user: { name: 'Kit' },
        issue: { identifier: 'ENG-1', title: 'Test' },
      };

      let callCount = 0;
      jest.spyOn(global, 'fetch').mockImplementation(async () => {
        callCount++;
        // Return different data based on call order
        if (callCount <= 3) {
          return {
            ok: true,
            json: async () => ({ data: { issues: { nodes: [issueNode] } } }),
          } as Response;
        }
        return {
          ok: true,
          json: async () => ({ data: { comments: { nodes: [commentNode] } } }),
        } as Response;
      });

      const result = await service.collect(null, { maxQueries: 4 });

      expect(result.observations.length).toBeGreaterThanOrEqual(2);
      expect(result.checkpoint.queriesUsed).toBeLessThanOrEqual(4);
    });

    it('respects budget limits', async () => {
      jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => ({ data: { issues: { nodes: [] } } }),
      } as Response);

      const result = await service.collect(null, { maxQueries: 0 });
      expect(result.observations).toEqual([]);
      expect(fetch).not.toHaveBeenCalled();
    });

    it('handles API errors gracefully', async () => {
      jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
      } as Response);

      const result = await service.collect(null, { maxQueries: 4 });
      expect(result.observations).toEqual([]);
      expect(result.checkpoint.lastCheckedAt).toBeDefined();
    });

    it('uses checkpoint lastCheckedAt as since date', async () => {
      const checkpoint = { lastCheckedAt: '2025-06-01T00:00:00.000Z' };

      jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => ({ data: { issues: { nodes: [] } } }),
      } as Response);

      await service.collect(checkpoint, { maxQueries: 4 });

      const call = (fetch as jest.Mock).mock.calls[0];
      const body = JSON.parse(call[1].body);
      expect(body.variables.since).toBe('2025-06-01T00:00:00.000Z');
    });
  });
});
