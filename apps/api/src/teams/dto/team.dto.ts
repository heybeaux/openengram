import {
  IsString,
  IsOptional,
  IsArray,
  IsNumber,
  Min,
  Max,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

// ── Create / Update ────────────────────────────────────────────────────

export class CreateTeamDto {
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  sharedCapabilities?: string[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AddTeamMemberDto)
  members?: AddTeamMemberDto[];
}

export class UpdateTeamDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  sharedCapabilities?: string[];
}

export class AddTeamMemberDto {
  @IsString()
  agentId: string;

  @IsOptional()
  @IsString()
  role?: string;
}

export class RecordCollaborationDto {
  @IsString()
  taskDescription: string;

  @IsArray()
  @IsString({ each: true })
  participantAgentIds: string[];

  @IsOptional()
  @IsString()
  outcome?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  score?: number;
}

// ── Response DTOs ──────────────────────────────────────────────────────

export class TeamMemberResponseDto {
  id: string;
  agentId: string;
  role: string | null;
  joinedAt: string;
}

export class TeamResponseDto {
  id: string;
  name: string;
  description: string | null;
  sharedCapabilities: string[];
  trustScore: number;
  collaborationCount: number;
  members: TeamMemberResponseDto[];
  createdAt: string;
  updatedAt: string;
}

export class CollaborationResponseDto {
  id: string;
  teamId: string;
  taskDescription: string;
  participantAgentIds: string[];
  outcome: string | null;
  score: number | null;
  createdAt: string;
}
