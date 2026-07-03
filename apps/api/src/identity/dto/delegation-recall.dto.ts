import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional, IsNumber } from 'class-validator';

export class DelegationRecallQueryDto {
  @ApiProperty({ description: 'Task description to find similar past tasks' })
  @IsString()
  task: string;

  @ApiPropertyOptional({ description: 'User/agent context for scoping' })
  @IsOptional()
  @IsString()
  userId?: string;

  @ApiPropertyOptional({ description: 'Max results', default: 5 })
  @IsOptional()
  @IsNumber()
  limit?: number;
}

export interface SimilarTask {
  memoryId: string;
  taskDescription: string;
  agentId: string | null;
  outcome: string | null;
  score: number;
  createdAt: Date;
}

export interface FailurePattern {
  description: string;
  frequency: number;
  lastOccurred: Date;
}

export interface DelegationRecallResult {
  query: string;
  similarTasks: SimilarTask[];
  failurePatterns: FailurePattern[];
  recommendedAgent: string | null;
  recommendationReason: string | null;
}
