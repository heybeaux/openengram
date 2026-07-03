import { EngramClient } from '../src/client';

const mockFetch = jest.fn();
(global as any).fetch = mockFetch;

function ok(data: unknown, status = 200) {
  return Promise.resolve({
    ok: true, status, statusText: 'OK',
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
  });
}

function noContent() {
  return Promise.resolve({
    ok: true, status: 204, statusText: 'No Content',
    json: () => Promise.resolve(null),
    text: () => Promise.resolve(''),
  });
}

let client: EngramClient;

beforeEach(() => {
  mockFetch.mockReset();
  client = new EngramClient({
    baseUrl: 'http://localhost:3001',
    apiKey: 'key',
    userId: 'user',
    retries: 0,
  });
});

const mem = { id: '1', raw: 'test', layer: 'SESSION', importance: 0.5, tags: [], source: 'test', createdAt: '', updatedAt: '' };

describe('EngramClient', () => {
  test('remember()', async () => {
    mockFetch.mockReturnValue(ok(mem));
    const result = await client.remember('hello', { tags: ['a'] });
    expect(result).toEqual(mem);
    const [, opts] = mockFetch.mock.calls[0];
    expect(JSON.parse(opts.body)).toEqual({ raw: 'hello', tags: ['a'] });
    expect(mockFetch.mock.calls[0][0]).toContain('/v1/memories');
  });

  test('recall()', async () => {
    mockFetch.mockReturnValue(ok([mem]));
    const result = await client.recall('query', { limit: 5 });
    expect(result).toEqual([mem]);
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toContain('/v1/recall');
    expect(JSON.parse(opts.body)).toEqual({ query: 'query', limit: 5 });
  });

  test('get()', async () => {
    mockFetch.mockReturnValue(ok(mem));
    const result = await client.get('1');
    expect(result).toEqual(mem);
    expect(mockFetch.mock.calls[0][0]).toContain('/v1/memories/1');
  });

  test('update()', async () => {
    mockFetch.mockReturnValue(ok(mem));
    await client.update('1', { raw: 'updated' });
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toContain('/v1/memories/1');
    expect(opts.method).toBe('PATCH');
  });

  test('forget()', async () => {
    mockFetch.mockReturnValue(noContent());
    await client.forget('1');
    expect(mockFetch.mock.calls[0][0]).toContain('/v1/memories/1');
    expect(mockFetch.mock.calls[0][1].method).toBe('DELETE');
  });

  test('rememberMany()', async () => {
    mockFetch.mockReturnValue(ok([mem]));
    await client.rememberMany([{ text: 'a' }, { text: 'b', options: { tags: ['x'] } }]);
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body).toEqual([{ raw: 'a' }, { raw: 'b', tags: ['x'] }]);
  });

  test('generateContext()', async () => {
    mockFetch.mockReturnValue(ok('context string'));
    await client.generateContext({ focus: 'auth' });
    expect(mockFetch.mock.calls[0][0]).toContain('/v1/consolidation/generate-context');
  });

  test('dreamCycle()', async () => {
    const dream = { consolidated: 1, pruned: 0, promoted: 1, durationMs: 500 };
    mockFetch.mockReturnValue(ok(dream));
    const result = await client.dreamCycle({ dryRun: true });
    expect(result).toEqual(dream);
  });

  test('dedupScan()', async () => {
    const dedup = { duplicatesFound: 2, merged: 1, durationMs: 100 };
    mockFetch.mockReturnValue(ok(dedup));
    const result = await client.dedupScan();
    expect(result).toEqual(dedup);
  });

  test('health()', async () => {
    const h = { healthy: true, uptime: 1000, memoryCount: 50, embedServiceUp: true };
    mockFetch.mockReturnValue(ok(h));
    expect(await client.health()).toEqual(h);
  });

  test('stats()', async () => {
    const s = { total: 100, byLayer: {}, bySource: {}, fogIndex: 0.1, growthRate: 0.5 };
    mockFetch.mockReturnValue(ok(s));
    expect(await client.stats()).toEqual(s);
    expect(mockFetch.mock.calls[0][0]).toContain('/v1/stats');
  });

  // Webhooks
  test('webhooks.create()', async () => {
    const wh = { id: 'w1', url: 'http://x', events: ['memory.created'], active: true, createdAt: '' };
    mockFetch.mockReturnValue(ok(wh));
    const result = await client.webhooks.create({ url: 'http://x', events: ['memory.created'] });
    expect(result).toEqual(wh);
  });

  test('webhooks.list()', async () => {
    mockFetch.mockReturnValue(ok([]));
    expect(await client.webhooks.list()).toEqual([]);
  });

  test('webhooks.get()', async () => {
    mockFetch.mockReturnValue(ok({ id: 'w1' }));
    await client.webhooks.get('w1');
    expect(mockFetch.mock.calls[0][0]).toContain('/v1/webhooks/w1');
  });

  test('webhooks.update()', async () => {
    mockFetch.mockReturnValue(ok({ id: 'w1' }));
    await client.webhooks.update('w1', { active: false });
    expect(mockFetch.mock.calls[0][1].method).toBe('PATCH');
  });

  test('webhooks.delete()', async () => {
    mockFetch.mockReturnValue(noContent());
    await client.webhooks.delete('w1');
    expect(mockFetch.mock.calls[0][1].method).toBe('DELETE');
  });

  test('webhooks.test()', async () => {
    mockFetch.mockReturnValue(noContent());
    await client.webhooks.test('w1');
    expect(mockFetch.mock.calls[0][0]).toContain('/v1/webhooks/w1/test');
  });

  test('webhooks.deliveries()', async () => {
    mockFetch.mockReturnValue(ok([]));
    await client.webhooks.deliveries('w1');
    expect(mockFetch.mock.calls[0][0]).toContain('/v1/webhooks/w1/deliveries');
  });
});
