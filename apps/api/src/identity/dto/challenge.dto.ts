import { IsString, IsOptional, IsIn } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { ChallengeType, ChallengeResolution } from '../identity.types';

export class CreateChallengeRequestDto {
  @ApiPropertyOptional({ description: 'Associated contract ID' })
  @IsOptional()
  @IsString()
  contractId?: string;

  @ApiProperty({ description: 'Task description' })
  @IsString()
  taskDescription: string;

  @ApiProperty({
    description: 'Challenge type',
    enum: [
      'unsafe',
      'underspecified',
      'capability_mismatch',
      'resource_constraint',
    ],
  })
  @IsIn([
    'unsafe',
    'underspecified',
    'capability_mismatch',
    'resource_constraint',
  ])
  challengeType: ChallengeType;

  @ApiProperty({ description: 'Reasoning for the challenge' })
  @IsString()
  reasoning: string;

  @ApiPropertyOptional({ description: 'Account ID' })
  @IsOptional()
  @IsString()
  accountId?: string;
}

export class ResolveChallengeRequestDto {
  @ApiProperty({
    description: 'Resolution',
    enum: ['accepted', 'overridden', 'modified'],
  })
  @IsIn(['accepted', 'overridden', 'modified'])
  resolution: ChallengeResolution;

  @ApiProperty({ description: 'Who resolved it' })
  @IsString()
  resolvedBy: string;
}
