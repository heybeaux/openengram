import { describe, it, expect, vi, afterEach } from 'vitest';
import { EngramClient } from '@/lib/engram-client';

describe('EngramClient agent session normalization', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('normalizes alternate and numeric production timestamp fields', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      sessions: [
        {
          id: 'session-1',
          session_key: 'test-session',
          label: null,
          status: 'COMPLETED',
          started_at_ms: 1782935400000,
          ended: 1782935460,
          created_at: '2026-07-01T19:00:00.000Z',
          updated_at: '2026-07-01T19:01:00.000Z',
        },
      ],
      total: 1,
    }), { status: 200 })));

    const client = new EngramClient({ baseUrl: 'https://api.example.test', apiKey: 'test-key' });
    const result = await client.getAgentSessions();

    expect(result.sessions[0]).toMatchObject({
      id: 'session-1',
      sessionKey: 'test-session',
      startedAt: '2026-07-01T19:50:00.000Z',
      endedAt: '2026-07-01T19:51:00.000Z',
    });
  });

  it('keeps missing session timestamps empty so the UI can render a fallback', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      sessions: [
        {
          id: 'session-1',
          session_key: 'test-session',
          status: 'ACTIVE',
        },
      ],
      total: 1,
    }), { status: 200 })));

    const client = new EngramClient({ baseUrl: 'https://api.example.test', apiKey: 'test-key' });
    const result = await client.getAgentSessions();

    expect(result.sessions[0].startedAt).toBe('');
    expect(result.sessions[0].createdAt).toBe('');
    expect(result.sessions[0].updatedAt).toBe('');
  });
});
