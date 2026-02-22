import { GitHubSignalService } from './github-signal.service';

describe('GitHubSignalService', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.restoreAllMocks();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('when not configured', () => {
    it('should return empty observations', async () => {
      delete process.env.AWARENESS_GITHUB_TOKEN;
      delete process.env.AWARENESS_GITHUB_REPOS;
      const service = new GitHubSignalService();

      const result = await service.collect(null, { maxQueries: 10 });
      expect(result.observations).toEqual([]);
      expect(result.checkpoint).toEqual({});
    });

    it('should return empty when token missing', async () => {
      delete process.env.AWARENESS_GITHUB_TOKEN;
      process.env.AWARENESS_GITHUB_REPOS = 'owner/repo';
      const service = new GitHubSignalService();

      const result = await service.collect(null, { maxQueries: 10 });
      expect(result.observations).toEqual([]);
    });

    it('should return empty when repos missing', async () => {
      process.env.AWARENESS_GITHUB_TOKEN = 'ghp_test';
      process.env.AWARENESS_GITHUB_REPOS = '';
      const service = new GitHubSignalService();

      const result = await service.collect(null, { maxQueries: 10 });
      expect(result.observations).toEqual([]);
    });
  });

  describe('when configured', () => {
    let service: GitHubSignalService;

    beforeEach(() => {
      process.env.AWARENESS_GITHUB_TOKEN = 'ghp_test_token';
      process.env.AWARENESS_GITHUB_REPOS = 'owner/repo-a, owner/repo-b';
      service = new GitHubSignalService();
    });

    it('should have correct name', () => {
      expect(service.name).toBe('github');
    });

    it('should collect commit observations', async () => {
      const mockCommits = [
        { sha: 'abc', commit: { author: { name: 'Dev', date: '2026-02-22T00:00:00Z' }, message: 'fix: something' } },
      ];
      jest.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockCommits),
      } as any)
      // PRs
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve([]) } as any)
      // Issues
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve([]) } as any)
      // Second repo - commits
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve([]) } as any)
      // Second repo - PRs
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve([]) } as any)
      // Second repo - issues
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve([]) } as any);

      const result = await service.collect(null, { maxQueries: 10 });
      expect(result.observations.length).toBeGreaterThanOrEqual(1);
      expect(result.observations[0].source).toBe('github');
      expect(result.observations[0].content).toContain('1 commits to owner/repo-a');
      expect(result.checkpoint.lastCheckedAt).toBeDefined();
    });

    it('should detect stale PRs', async () => {
      const stalePR = {
        number: 42,
        title: 'Old PR',
        state: 'open',
        created_at: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
        updated_at: new Date().toISOString(),
        user: { login: 'dev' },
        draft: false,
      };

      jest.spyOn(global, 'fetch')
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve([]) } as any) // commits
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve([stalePR]) } as any) // PRs
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve([]) } as any) // issues
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve([]) } as any) // repo-b commits
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve([]) } as any) // repo-b PRs
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve([]) } as any); // repo-b issues

      const result = await service.collect(null, { maxQueries: 10 });
      const prObs = result.observations.find(o => o.metadata?.type === 'open_prs');
      expect(prObs).toBeDefined();
      expect(prObs!.content).toContain('1 stale >3d');
      expect(prObs!.metadata!.staleCount).toBe(1);
    });

    it('should filter PRs from issues endpoint', async () => {
      const issue = { number: 1, title: 'Bug', state: 'closed', created_at: '2026-02-21', closed_at: '2026-02-22', labels: [] };
      const prAsIssue = { number: 2, title: 'PR', state: 'closed', created_at: '2026-02-21', closed_at: '2026-02-22', pull_request: {}, labels: [] };

      jest.spyOn(global, 'fetch')
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve([]) } as any)
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve([]) } as any)
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve([issue, prAsIssue]) } as any)
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve([]) } as any)
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve([]) } as any)
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve([]) } as any);

      const result = await service.collect(null, { maxQueries: 10 });
      const issueObs = result.observations.find(o => o.metadata?.type === 'closed_issues');
      expect(issueObs).toBeDefined();
      expect(issueObs!.metadata!.count).toBe(1); // PR filtered out
    });

    it('should respect budget.maxQueries', async () => {
      const fetchSpy = jest.spyOn(global, 'fetch')
        .mockResolvedValue({ ok: true, json: () => Promise.resolve([]) } as any);

      await service.collect(null, { maxQueries: 3 });
      // Should stop before exhausting budget (reserves 2 per repo)
      expect(fetchSpy.mock.calls.length).toBeLessThanOrEqual(3);
    });

    it('should use checkpoint for since date', async () => {
      const fetchSpy = jest.spyOn(global, 'fetch')
        .mockResolvedValue({ ok: true, json: () => Promise.resolve([]) } as any);

      const checkpoint = { lastCheckedAt: '2026-02-21T12:00:00Z' };
      await service.collect(checkpoint, { maxQueries: 10 });

      const firstCallUrl = fetchSpy.mock.calls[0][0] as string;
      expect(firstCallUrl).toContain('since=2026-02-21T12:00:00');
    });

    it('should handle API errors gracefully', async () => {
      jest.spyOn(global, 'fetch')
        .mockResolvedValueOnce({ ok: false, status: 403, statusText: 'Forbidden' } as any)
        // Continue with second repo
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve([]) } as any)
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve([]) } as any)
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve([]) } as any);

      // Should not throw
      const result = await service.collect(null, { maxQueries: 10 });
      expect(result.checkpoint.lastCheckedAt).toBeDefined();
    });

    it('should set Authorization header', async () => {
      const fetchSpy = jest.spyOn(global, 'fetch')
        .mockResolvedValue({ ok: true, json: () => Promise.resolve([]) } as any);

      await service.collect(null, { maxQueries: 10 });
      const headers = fetchSpy.mock.calls[0][1]?.headers as Record<string, string>;
      expect(headers.Authorization).toBe('Bearer ghp_test_token');
      expect(headers['User-Agent']).toBe('engram-awareness');
    });
  });
});
