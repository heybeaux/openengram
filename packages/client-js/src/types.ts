export type MemoryLayer = 'SESSION' | 'SEMANTIC' | 'CORE' | 'META';

export interface EngramConfig {
  baseUrl: string;
  apiKey: string;
  userId: string;
  timeout?: number;
  retries?: number;
  onError?: (err: Error) => void;
}

export interface Memory {
  id: string;
  raw: string;
  processed?: string;
  layer: MemoryLayer;
  importance: number;
  tags: string[];
  source: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface RememberOptions {
  layer?: MemoryLayer;
  tags?: string[];
  source?: string;
  importance?: number;
  metadata?: Record<string, unknown>;
}

export interface RecallOptions {
  limit?: number;
  layers?: MemoryLayer[];
  minImportance?: number;
  tags?: string[];
}

export interface UpdateMemoryData {
  raw?: string;
  layer?: MemoryLayer;
  tags?: string[];
  importance?: number;
  metadata?: Record<string, unknown>;
}

export interface RememberItem {
  text: string;
  options?: RememberOptions;
}

export interface ContextOptions {
  maxTokens?: number;
  focus?: string;
}

export interface DreamOptions {
  dryRun?: boolean;
  maxLlmCalls?: number;
}

export interface DreamResult {
  consolidated: number;
  pruned: number;
  promoted: number;
  durationMs: number;
}

export interface DedupResult {
  duplicatesFound: number;
  merged: number;
  durationMs: number;
}

export interface HealthStatus {
  healthy: boolean;
  uptime: number;
  memoryCount: number;
  embedServiceUp: boolean;
}

export interface MemoryStats {
  total: number;
  byLayer: Record<string, number>;
  bySource: Record<string, number>;
  fogIndex: number;
  growthRate: number;
}

export interface WebhookCreateOptions {
  url: string;
  events: string[];
  secret?: string;
}

export interface WebhookUpdateData {
  url?: string;
  events?: string[];
  active?: boolean;
  secret?: string;
}

export interface Webhook {
  id: string;
  url: string;
  events: string[];
  active: boolean;
  secret?: string;
  createdAt: string;
}

export interface WebhookDelivery {
  id: string;
  webhookId: string;
  event: string;
  status: number;
  deliveredAt: string;
}
