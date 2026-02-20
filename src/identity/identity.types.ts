/**
 * Identity Framework Types — Delegation Contracts, Challenge Protocol, Failure Patterns
 */

// ── Delegation Contracts (HEY-185) ──

export type ContractStatus = 'pending' | 'in_progress' | 'completed' | 'failed' | 'timed_out';

export interface DelegationContract {
  id: string;
  taskDescription: string;
  expectedOutputs: string[];
  successCriteria: string[];
  timeout: number; // ms
  constraints: string[];
  delegatedTo: string; // agentId
  status: ContractStatus;
  result?: string;
  createdAt: Date;
  completedAt?: Date;
  accountId?: string;
}

export interface CreateContractDto {
  taskDescription: string;
  expectedOutputs: string[];
  successCriteria: string[];
  timeout: number;
  constraints?: string[];
  delegatedTo: string;
  accountId?: string;
}

export interface CompleteContractDto {
  status: 'completed' | 'failed';
  result?: string;
}

// ── Challenge Protocol (HEY-186) ──

export type ChallengeType = 'unsafe' | 'underspecified' | 'capability_mismatch' | 'resource_constraint';
export type ChallengeResolution = 'accepted' | 'overridden' | 'modified';

export interface Challenge {
  id: string;
  contractId?: string;
  taskDescription: string;
  challengeType: ChallengeType;
  reasoning: string;
  resolution?: ChallengeResolution;
  resolvedBy?: string;
  createdAt: Date;
  resolvedAt?: Date;
  accountId?: string;
}

export interface CreateChallengeDto {
  contractId?: string;
  taskDescription: string;
  challengeType: ChallengeType;
  reasoning: string;
  accountId?: string;
}

export interface ResolveChallengeDto {
  resolution: ChallengeResolution;
  resolvedBy: string;
}

// ── Failure Pattern Detection (HEY-187) ──

export type FailurePatternType = 'repeated_agent_failure' | 'cascading_failure' | 'timeout_pattern';

export interface FailurePattern {
  id: string;
  patternType: FailurePatternType;
  agentId: string;
  domain?: string;
  description: string;
  occurrences: number;
  contractIds: string[];
  detectedAt: Date;
  accountId?: string;
}

// ── Agent Capability Profile (for auto-challenge) ──

export interface AgentCapabilityProfile {
  agentId: string;
  domains: string[];
  confidenceByDomain: Record<string, number>; // 0.0-1.0
}

// Types from trust/capability services (HEY-170, HEY-172, HEY-173)
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
  firstSeen: string;
  lastSeen: string;
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
