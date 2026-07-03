/**
 * Typed client for the engram-code v1 API.
 *
 * Wraps `fetch` and validates responses against the zod schemas in
 * `./schemas`. Reads the API base URL from `EC_API_URL` (or
 * `NEXT_PUBLIC_EC_API_URL` for client-side calls), defaulting to
 * `http://localhost:3000` to match the backend's `PORT=3000` convention.
 */

import {
  cardResponseSchema,
  ingestJobSchema,
  ingestListResponseSchema,
  ingestSubmitResponseSchema,
  mapResponseSchema,
  reposListResponseSchema,
  searchConceptResponseSchema,
  subsystemListResponseSchema,
  type CardKind,
  type CardResponse,
  type IngestJob,
  type IngestListResponse,
  type IngestSubmitResponse,
  type LodLevel,
  type MapResponse,
  type ReposListResponse,
  type SearchConceptResponse,
  type SubsystemListResponse,
} from './schemas';

export interface ApiClientOptions {
  baseUrl?: string;
  fetch?: typeof fetch;
}

export interface SearchConceptOptions {
  level?: CardKind;
  lod?: LodLevel;
  limit?: number;
  repoId?: string;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly url: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

function resolveBaseUrl(explicit?: string): string {
  if (explicit && explicit !== '') return explicit;
  if (typeof process !== 'undefined') {
    const env = process.env.EC_API_URL ?? process.env.NEXT_PUBLIC_EC_API_URL;
    if (env && env !== '') return env;
  }
  return 'http://localhost:3000';
}

export class EngramCodeApi {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: ApiClientOptions = {}) {
    this.baseUrl = resolveBaseUrl(opts.baseUrl).replace(/\/+$/, '');
    this.fetchImpl = opts.fetch ?? globalThis.fetch.bind(globalThis);
  }

  async getCard(
    path: string,
    lod?: LodLevel,
    repoId?: string,
  ): Promise<CardResponse> {
    const encoded = encodeConceptPath(path);
    const params = new URLSearchParams();
    if (lod) params.set('lod', lod);
    if (repoId) params.set('repo', repoId);
    const qs = params.toString();
    const url = `${this.baseUrl}/v1/cards/${encoded}${qs ? `?${qs}` : ''}`;
    return this.request(url, cardResponseSchema);
  }

  async getMap(
    root?: string,
    depth?: number,
    repoId?: string,
  ): Promise<MapResponse> {
    const params = new URLSearchParams();
    if (root && root !== '') params.set('root', root);
    if (depth !== undefined) params.set('depth', String(depth));
    if (repoId) params.set('repo', repoId);
    const qs = params.toString();
    const url = `${this.baseUrl}/v1/map${qs ? `?${qs}` : ''}`;
    return this.request(url, mapResponseSchema);
  }

  async searchConcept(
    query: string,
    opts: SearchConceptOptions = {},
  ): Promise<SearchConceptResponse> {
    const url = `${this.baseUrl}/v1/search/concept`;
    const body: Record<string, unknown> = { query };
    if (opts.level !== undefined) body.level = opts.level;
    if (opts.lod !== undefined) body.lod = opts.lod;
    if (opts.limit !== undefined) body.limit = opts.limit;
    if (opts.repoId !== undefined && opts.repoId !== '') body.repoId = opts.repoId;
    return this.request(url, searchConceptResponseSchema, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  async listSubsystems(repoId?: string): Promise<SubsystemListResponse> {
    const params = new URLSearchParams();
    if (repoId) params.set('repo', repoId);
    const qs = params.toString();
    const url = `${this.baseUrl}/v1/subsystems${qs ? `?${qs}` : ''}`;
    return this.request(url, subsystemListResponseSchema);
  }

  async listRepos(): Promise<ReposListResponse> {
    const url = `${this.baseUrl}/v1/repos`;
    return this.request(url, reposListResponseSchema);
  }

  async submitIngest(url: string, ref?: string): Promise<IngestSubmitResponse> {
    const endpoint = `${this.baseUrl}/v1/ingest/github`;
    const body: Record<string, unknown> = { url };
    if (ref !== undefined && ref !== '') body.ref = ref;
    return this.request(endpoint, ingestSubmitResponseSchema, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  async getIngest(id: string): Promise<IngestJob> {
    const url = `${this.baseUrl}/v1/ingest/${encodeURIComponent(id)}`;
    return this.request(url, ingestJobSchema);
  }

  async listIngests(limit?: number): Promise<IngestListResponse> {
    const params = new URLSearchParams();
    if (limit !== undefined) params.set('limit', String(limit));
    const qs = params.toString();
    const url = `${this.baseUrl}/v1/ingest${qs ? `?${qs}` : ''}`;
    return this.request(url, ingestListResponseSchema);
  }

  private async request<T>(
    url: string,
    schema: { parse: (input: unknown) => T },
    init?: RequestInit,
  ): Promise<T> {
    const res = await this.fetchImpl(url, init);
    if (!res.ok) {
      const text = await safeReadText(res);
      throw new ApiError(res.status, url, text || res.statusText);
    }
    const json: unknown = await res.json();
    return schema.parse(json);
  }
}

/**
 * Encode a slash-delimited concept path so each segment is URL-safe but
 * slashes are preserved. The backend's `*path` wildcard handles either
 * encoded or raw slashes, but keeping slashes raw makes server logs more
 * readable.
 */
function encodeConceptPath(path: string): string {
  return path
    .replace(/^\/+/, '')
    .replace(/\/+$/, '')
    .split('/')
    .map((seg) => encodeURIComponent(seg))
    .join('/');
}

async function safeReadText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return '';
  }
}

/** Convenience singleton for callers that don't need a custom instance. */
export const api = new EngramCodeApi();

export const getCard = (path: string, lod?: LodLevel, repoId?: string) =>
  api.getCard(path, lod, repoId);
export const getMap = (root?: string, depth?: number, repoId?: string) =>
  api.getMap(root, depth, repoId);
export const searchConcept = (query: string, opts?: SearchConceptOptions) =>
  api.searchConcept(query, opts);
export const listSubsystems = (repoId?: string) => api.listSubsystems(repoId);
export const listRepos = () => api.listRepos();
export const submitIngest = (url: string, ref?: string) =>
  api.submitIngest(url, ref);
export const getIngest = (id: string) => api.getIngest(id);
export const listIngests = (limit?: number) => api.listIngests(limit);
