import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('loadConfig', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    vi.resetModules();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('loads valid config from env', async () => {
    process.env.ENGRAM_API_KEY = 'test-key';
    process.env.ENGRAM_USER_ID = 'test-user';
    process.env.ENGRAM_BASE_URL = 'http://localhost:3001';

    const { loadConfig } = await import('../src/config.js');
    const config = loadConfig();

    expect(config.apiKey).toBe('test-key');
    expect(config.userId).toBe('test-user');
    expect(config.baseUrl).toBe('http://localhost:3001');
    expect(config.timeoutMs).toBe(10000);
    expect(config.maxRetries).toBe(2);
  });

  it('uses defaults', async () => {
    process.env.ENGRAM_API_KEY = 'key';
    process.env.ENGRAM_USER_ID = 'user';

    const { loadConfig } = await import('../src/config.js');
    const config = loadConfig();

    expect(config.baseUrl).toBe('https://api.openengram.ai');
    expect(config.logLevel).toBe('warn');
  });

  it('allows API key to be provided later by transport/client config', async () => {
    delete process.env.ENGRAM_API_KEY;
    process.env.ENGRAM_USER_ID = 'user';

    const { loadConfig } = await import('../src/config.js');
    const config = loadConfig();

    expect(config.apiKey).toBe('');
    expect(config.userId).toBe('user');
  });

  it('rejects non-localhost HTTP URLs', async () => {
    process.env.ENGRAM_API_KEY = 'key';
    process.env.ENGRAM_USER_ID = 'user';
    process.env.ENGRAM_BASE_URL = 'http://example.com';

    const mockExit = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });

    const { loadConfig } = await import('../src/config.js');
    expect(() => loadConfig()).toThrow('exit');

    mockExit.mockRestore();
  });
});
