/**
 * Contract tests for the typed v1 API client.
 *
 * Each test mocks `fetch`, hands the client a fixture matching the backend
 * DTO shape from `src/v2/api/dto/index.ts`, and asserts that:
 *   1. The client builds the expected URL + method/body.
 *   2. The zod schema accepts the fixture and returns a typed value.
 *
 * If the backend DTO changes, these should fail loudly here before they
 * hit a real network call.
 */

import { describe, expect, it, vi } from 'vitest';
import { ApiError, EngramCodeApi } from '@/lib/api';

interface FetchCall {
  url: string;
  init?: RequestInit;
}

function mockFetch(jsonBody: unknown, status = 200): {
  fetchImpl: typeof fetch;
  calls: FetchCall[];
} {
  const calls: FetchCall[] = [];
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return new Response(JSON.stringify(jsonBody), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

const BASE = 'http://api.test';

describe('getCard', () => {
  it('GETs /v1/cards/<path>?lod= and validates the response', async () => {
    const fixture = {
      conceptPath: 'engram/ingestion/parsers/typescript',
      kind: 'module',
      lod: 'summary',
      content: 'TypeScript tree-sitter parser.',
      metadata: { generated_at: '2026-05-25T12:00:00Z' },
    };
    const { fetchImpl, calls } = mockFetch(fixture);
    const api = new EngramCodeApi({ baseUrl: BASE, fetch: fetchImpl });

    const card = await api.getCard('engram/ingestion/parsers/typescript', 'summary');

    expect(calls[0].url).toBe(
      `${BASE}/v1/cards/engram/ingestion/parsers/typescript?lod=summary`,
    );
    expect(card.conceptPath).toBe('engram/ingestion/parsers/typescript');
    expect(card.kind).toBe('module');
    expect(card.lod).toBe('summary');
  });

  it('throws ApiError on non-2xx responses', async () => {
    const { fetchImpl } = mockFetch({ message: 'not found' }, 404);
    const api = new EngramCodeApi({ baseUrl: BASE, fetch: fetchImpl });
    await expect(api.getCard('missing')).rejects.toBeInstanceOf(ApiError);
  });
});

describe('getMap', () => {
  it('GETs /v1/map with root + depth and accepts the nested tree', async () => {
    const fixture = {
      root: 'engram',
      depth: 2,
      nodes: [
        {
          conceptPath: 'engram',
          level: 'repository',
          summary: 'engram-code root',
          children: [
            {
              conceptPath: 'engram/ingestion',
              level: 'subsystem',
              summary: 'Ingestion pipeline',
              children: [],
            },
          ],
        },
      ],
    };
    const { fetchImpl, calls } = mockFetch(fixture);
    const api = new EngramCodeApi({ baseUrl: BASE, fetch: fetchImpl });

    const map = await api.getMap('engram', 2);

    expect(calls[0].url).toBe(`${BASE}/v1/map?root=engram&depth=2`);
    expect(map.root).toBe('engram');
    expect(map.depth).toBe(2);
    expect(map.nodes[0].children[0].conceptPath).toBe('engram/ingestion');
  });

  it('omits query string when no root/depth provided', async () => {
    const { fetchImpl, calls } = mockFetch({ root: null, depth: 2, nodes: [] });
    const api = new EngramCodeApi({ baseUrl: BASE, fetch: fetchImpl });
    await api.getMap();
    expect(calls[0].url).toBe(`${BASE}/v1/map`);
  });
});

describe('searchConcept', () => {
  it('POSTs /v1/search/concept with the request body and validates hits', async () => {
    const fixture = {
      query: 'parser',
      results: [
        {
          conceptPath: 'engram/ingestion/parsers/typescript',
          level: 'module',
          lod: 'summary',
          score: 1.234,
          snippet: '…TypeScript parser via tree-sitter.',
        },
      ],
      totalFound: 1,
      searchTimeMs: 4,
    };
    const { fetchImpl, calls } = mockFetch(fixture);
    const api = new EngramCodeApi({ baseUrl: BASE, fetch: fetchImpl });

    const res = await api.searchConcept('parser', { level: 'module', limit: 5 });

    expect(calls[0].url).toBe(`${BASE}/v1/search/concept`);
    expect(calls[0].init?.method).toBe('POST');
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({
      query: 'parser',
      level: 'module',
      limit: 5,
    });
    expect(res.results).toHaveLength(1);
    expect(res.results[0].score).toBeCloseTo(1.234);
  });
});

describe('listSubsystems', () => {
  it('GETs /v1/subsystems and returns the count', async () => {
    const fixture = {
      subsystems: [
        { slug: 'ingestion', name: 'Ingestion', memberCount: 7 },
        {
          slug: 'synthesis',
          name: 'Synthesis',
          memberCount: 4,
          description: 'LoD card generation',
        },
      ],
      count: 2,
    };
    const { fetchImpl, calls } = mockFetch(fixture);
    const api = new EngramCodeApi({ baseUrl: BASE, fetch: fetchImpl });

    const res = await api.listSubsystems();

    expect(calls[0].url).toBe(`${BASE}/v1/subsystems`);
    expect(res.count).toBe(2);
    expect(res.subsystems[1].description).toBe('LoD card generation');
  });
});
