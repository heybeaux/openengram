import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsObject, IsOptional, IsNumber } from 'class-validator';

export interface PortableIdentityExport {
  schemaVersion: string;
  exportedAt: string;
  agentId: string;
  agentName: string;
  capabilities: CapabilityProfile[];
  preferences: Record<string, any>;
  trustProfile: TrustProfile;
  workHistorySummary: WorkHistorySummary;
  collaborationPatterns: CollaborationPattern[];
  integrityHash: string;
}

export interface CapabilityProfile {
  name: string;
  score: number;
  evidenceCount: number;
}

export interface TrustProfile {
  totalTasks: number;
  successRate: number;
  avgResponseQuality: number;
  specializations: string[];
}

export interface WorkHistorySummary {
  totalMemories: number;
  taskCompletions: number;
  reflections: number;
  activeSince: string;
  topCategories: { category: string; count: number }[];
}

export interface CollaborationPattern {
  partnerAgentId: string;
  interactionCount: number;
  avgOutcomeScore: number;
}

export class ImportIdentityDto {
  @ApiProperty({ description: 'The portable identity JSON export' })
  @IsObject()
  identity: PortableIdentityExport;

  @ApiPropertyOptional({ description: 'Target agent ID to import into' })
  @IsOptional()
  @IsString()
  targetAgentId?: string;
}
