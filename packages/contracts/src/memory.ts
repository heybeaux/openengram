export type MemoryLayer = "SESSION" | "SEMANTIC" | "CORE" | "META" | "PROJECT";

export interface MemoryContract {
  id: string;
  raw?: string;
  content?: string;
  processed?: string;
  layer: MemoryLayer | string;
  importance?: number;
  tags?: string[];
  source?: string;
  metadata?: Record<string, unknown>;
  createdAt?: string;
  updatedAt?: string;
}

export interface CreateMemoryRequestContract {
  raw?: string;
  content?: string;
  type?: string;
  layer?: MemoryLayer | string;
  source?: string;
  importance?: number;
  tags?: string[];
  metadata?: Record<string, unknown>;
  poolId?: string;
  agentId?: string;
}

export interface RecallRequestContract {
  query: string;
  limit?: number;
  layers?: Array<MemoryLayer | string>;
  minImportance?: number;
  tags?: string[];
  filter?: {
    tags?: string[];
    [key: string]: unknown;
  };
}
