import { IsString, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { ChallengeType, ChallengeResolution } from '../identity.types';

export class CreateChallengeBodyDto {
  @ApiPropertyOptional() @IsOptional() @IsString() contractId?: string;
  @ApiProperty() @IsString() taskDescription: string;
  @ApiProperty() @IsString() challengeType: ChallengeType;
  @ApiProperty() @IsString() reasoning: string;
  @ApiPropertyOptional() @IsOptional() @IsString() accountId?: string;
}

export class ResolveChallengeBodyDto {
  @ApiProperty() @IsString() resolution: ChallengeResolution;
  @ApiProperty() @IsString() resolvedBy: string;
}
