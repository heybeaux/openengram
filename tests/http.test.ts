import { request, HttpConfig } from '../src/http';
import { AuthError, NotFoundError, EngramError, TimeoutError } from '../src/errors';

const baseConfig: HttpConfig = {
  baseUrl: 'http://localhost:3001',
  apiKey: 'test-key',
  userId: 'test-user',
  timeout: 5000,
  retries: 0,
};

const mockFetch = jest.fn();
(global as any).fetch = mockFetch;

beforeEach(() => mockFetch.mockReset());

function jsonResponse(data: unknown, status = 200) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    statusText: 'OK',
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
  });
}

function errorResponse(status: number, body = '') {
  return Promise.resolve({
    ok: false,
    status,
    statusText: 'Error',
    json: () => Promise.resolve({}),
    text: () => Promise.resolve(body),
  });
}

describe('HTTP layer', () => {
  test('sends correct headers', async () => {
    mockFetch.mockReturnValue(jsonResponse({ ok: true }));
    await request(baseConfig, { method: 'GET', path: '/v1/health' });

    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe('http://localhost:3001/v1/health');
    expect(opts.headers['X-AM-API-Key']).toBe('test-key');
    expect(opts.headers['X-AM-User-ID']).toBe('test-user');
    expect(opts.headers['Content-Type']).toBe('application/json');
  });

  test('sends JSON body for POST', async () => {
    mockFetch.mockReturnValue(jsonResponse({ id: '1' }));
    await request(baseConfig, { method: 'POST', path: '/v1/memories', body: { raw: 'hello' } });

    const [, opts] = mockFetch.mock.calls[0];
    expect(opts.method).toBe('POST');
    expect(JSON.parse(opts.body)).toEqual({ raw: 'hello' });
  });

  test('401 throws AuthError', async () => {
    mockFetch.mockReturnValue(errorResponse(401, 'Unauthorized'));
    await expect(request(baseConfig, { method: 'GET', path: '/v1/test' })).rejects.toThrow(AuthError);
  });

  test('404 throws NotFoundError', async () => {
    mockFetch.mockReturnValue(errorResponse(404, 'Not found'));
    await expect(request(baseConfig, { method: 'GET', path: '/v1/test' })).rejects.toThrow(NotFoundError);
  });

  test('500 throws EngramError', async () => {
    mockFetch.mockReturnValue(errorResponse(500, 'Server error'));
    await expect(request(baseConfig, { method: 'GET', path: '/v1/test' })).rejects.toThrow(EngramError);
  });

  test('retries on 5xx', async () => {
    const retryConfig = { ...baseConfig, retries: 2 };
    mockFetch
      .mockReturnValueOnce(errorResponse(500, 'fail'))
      .mockReturnValueOnce(errorResponse(502, 'fail'))
      .mockReturnValueOnce(jsonResponse({ ok: true }));

    const result = await request(retryConfig, { method: 'GET', path: '/v1/health' });
    expect(result).toEqual({ ok: true });
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  test('does not retry on 4xx', async () => {
    const retryConfig = { ...baseConfig, retries: 2 };
    mockFetch.mockReturnValue(errorResponse(400, 'Bad request'));
    await expect(request(retryConfig, { method: 'GET', path: '/v1/test' })).rejects.toThrow(EngramError);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  test('timeout throws TimeoutError', async () => {
    const fastConfig = { ...baseConfig, timeout: 1, retries: 0 };
    mockFetch.mockImplementation(() => {
      const err = new Error('aborted');
      err.name = 'AbortError';
      return Promise.reject(err);
    });
    await expect(request(fastConfig, { method: 'GET', path: '/v1/test' })).rejects.toThrow(TimeoutError);
  });

  test('204 returns undefined', async () => {
    mockFetch.mockReturnValue(Promise.resolve({
      ok: true, status: 204, statusText: 'No Content',
      json: () => Promise.resolve(null),
      text: () => Promise.resolve(''),
    }));
    const result = await request(baseConfig, { method: 'DELETE', path: '/v1/memories/1' });
    expect(result).toBeUndefined();
  });

  test('calls onError callback', async () => {
    const onError = jest.fn();
    const cfg = { ...baseConfig, onError };
    mockFetch.mockReturnValue(errorResponse(401, 'nope'));
    await expect(request(cfg, { method: 'GET', path: '/v1/test' })).rejects.toThrow();
    expect(onError).toHaveBeenCalledTimes(1);
  });
});
