/**
 * HEY-186: Challenge Protocol Types
 */

export enum ChallengeStatus {
  OPEN = 'OPEN',
  UNDER_REVIEW = 'UNDER_REVIEW',
  UPHELD = 'UPHELD',       // Challenge was valid — memory is disputed
  DISMISSED = 'DISMISSED',  // Challenge was invalid — memory stands
  RESOLVED = 'RESOLVED',    // Resolved via consensus or evidence
}

export enum ResolutionMethod {
  HUMAN_REVIEW = 'HUMAN_REVIEW',
  CONSENSUS = 'CONSENSUS',
  EVIDENCE_BASED = 'EVIDENCE_BASED',
}

export interface ChallengeInput {
  challengerId: string; // Agent session key or agent ID
  memoryId: string;
  reason: string;
  evidence?: string;
}

export interface ChallengeResolution {
  status: ChallengeStatus;
  resolution: string;
  method: ResolutionMethod;
  resolvedBy: string;
}

export interface ChallengeResult {
  id: string;
  challengerId: string;
  memoryId: string;
  reason: string;
  evidence: string | null;
  status: ChallengeStatus;
  resolution: string | null;
  resolvedBy: string | null;
  resolvedAt: Date | null;
  createdAt: Date;
}
