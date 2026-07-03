import { request, HttpConfig } from './http.js';
import type {
  EngramConfig, Memory, RememberOptions, RecallOptions,
  UpdateMemoryData, RememberItem, ContextOptions,
  DreamOptions, DreamResult, DedupResult,
  HealthStatus, MemoryStats,
  WebhookCreateOptions, WebhookUpdateData, Webhook, WebhookDelivery,
} from './types.js';

export class EngramClient {
  private http: HttpConfig;

  public webhooks: {
    create(options: WebhookCreateOptions): Promise<Webhook>;
    list(): Promise<Webhook[]>;
    get(id: string): Promise<Webhook>;
    update(id: string, data: WebhookUpdateData): Promise<Webhook>;
    delete(id: string): Promise<void>;
    test(id: string): Promise<void>;
    deliveries(id: string): Promise<WebhookDelivery[]>;
  };

  constructor(config: EngramConfig) {
    this.http = {
      baseUrl: config.baseUrl.replace(/\/$/, ''),
      apiKey: config.apiKey,
      userId: config.userId,
      timeout: config.timeout ?? 30000,
      retries: config.retries ?? 2,
      onError: config.onError,
    };

    const h = this.http;
    this.webhooks = {
      create: (opts) => request<Webhook>(h, { method: 'POST', path: '/v1/webhooks', body: opts }),
      list: () => request<Webhook[]>(h, { method: 'GET', path: '/v1/webhooks' }),
      get: (id) => request<Webhook>(h, { method: 'GET', path: `/v1/webhooks/${id}` }),
      update: (id, data) => request<Webhook>(h, { method: 'PATCH', path: `/v1/webhooks/${id}`, body: data }),
      delete: (id) => request<void>(h, { method: 'DELETE', path: `/v1/webhooks/${id}` }),
      test: (id) => request<void>(h, { method: 'POST', path: `/v1/webhooks/${id}/test` }),
      deliveries: (id) => request<WebhookDelivery[]>(h, { method: 'GET', path: `/v1/webhooks/${id}/deliveries` }),
    };
  }

  async remember(text: string, options?: RememberOptions): Promise<Memory> {
    return request<Memory>(this.http, {
      method: 'POST',
      path: '/v1/memories',
      body: { raw: text, ...options },
    });
  }

  async recall(query: string, options?: RecallOptions): Promise<Memory[]> {
    return request<Memory[]>(this.http, {
      method: 'POST',
      path: '/v1/recall',
      body: { query, ...options },
    });
  }

  async get(id: string): Promise<Memory> {
    return request<Memory>(this.http, { method: 'GET', path: `/v1/memories/${id}` });
  }

  async update(id: string, data: UpdateMemoryData): Promise<Memory> {
    return request<Memory>(this.http, { method: 'PATCH', path: `/v1/memories/${id}`, body: data });
  }

  async forget(id: string): Promise<void> {
    return request<void>(this.http, { method: 'DELETE', path: `/v1/memories/${id}` });
  }

  async rememberMany(items: RememberItem[]): Promise<Memory[]> {
    return request<Memory[]>(this.http, {
      method: 'POST',
      path: '/v1/memories/batch',
      body: items.map((i) => ({ raw: i.text, ...i.options })),
    });
  }

  async generateContext(options?: ContextOptions): Promise<string> {
    return request<string>(this.http, {
      method: 'POST',
      path: '/v1/consolidation/generate-context',
      body: options ?? {},
    });
  }

  async dreamCycle(options?: DreamOptions): Promise<DreamResult> {
    return request<DreamResult>(this.http, {
      method: 'POST',
      path: '/v1/consolidation/dream-cycle',
      body: options ?? {},
    });
  }

  async dedupScan(): Promise<DedupResult> {
    return request<DedupResult>(this.http, {
      method: 'POST',
      path: '/v1/dedup/scan',
      body: {},
    });
  }

  async health(): Promise<HealthStatus> {
    return request<HealthStatus>(this.http, { method: 'GET', path: '/v1/health' });
  }

  async stats(): Promise<MemoryStats> {
    return request<MemoryStats>(this.http, { method: 'GET', path: '/v1/stats' });
  }
}
