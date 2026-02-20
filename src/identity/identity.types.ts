export interface TrustSignalInput {
  userId: string;
  agentId?: string;
  signalType: 'SUCCESS' | 'FAILURE' | 'CORRECTION';
  context: string;
  category?: string;
  weight?: number;
  sourceMemoryId?: string;
  metadata?: Record<string, unknown>;
}

export interface TrustScoreResult {
  category: string | null;
  score: number;
  signalCount: number;
  successCount: number;
  failureCount: number;
  correctionCount: number;
  computedAt: Date;
}

export interface CapabilityEntry {
  name: string;
  evidenceCount: number;
  firstSeen: string; // ISO date
  lastSeen: string; // ISO date
}

export interface CapabilityDelta {
  gained: CapabilityEntry[];
  improved: Array<{
    name: string;
    previousCount: number;
    currentCount: number;
  }>;
  period: { from: Date; to: Date };
}

export interface ExperienceWeightResult {
  category: string;
  successCount: number;
  totalCount: number;
  weight: number;
}
