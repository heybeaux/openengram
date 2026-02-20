import { IsString, IsOptional, IsIn } from 'class-validator';
import { ChallengeStatus, ResolutionMethod } from '../challenge.types';

export class CreateChallengeDto {
  @IsString()
  challengerId: string;

  @IsString()
  reason: string;

  @IsOptional()
  @IsString()
  evidence?: string;
}

export class ResolveChallengeDto {
  @IsIn([ChallengeStatus.UPHELD, ChallengeStatus.DISMISSED, ChallengeStatus.RESOLVED])
  status: ChallengeStatus;

  @IsString()
  resolution: string;

  @IsIn([ResolutionMethod.HUMAN_REVIEW, ResolutionMethod.CONSENSUS, ResolutionMethod.EVIDENCE_BASED])
  method: ResolutionMethod;

  @IsString()
  resolvedBy: string;
}

export class ChallengeResponseDto {
  id: string;
  challengerId: string;
  memoryId: string;
  reason: string;
  evidence: string | null;
  status: string;
  resolution: string | null;
  resolvedBy: string | null;
  resolvedAt: Date | null;
  createdAt: Date;
}
