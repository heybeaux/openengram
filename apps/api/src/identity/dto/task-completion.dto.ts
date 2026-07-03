import {
  IsString,
  IsEnum,
  IsOptional,
  IsNumber,
  IsObject,
} from 'class-validator';

export enum TaskOutcome {
  SUCCESS = 'success',
  FAILURE = 'failure',
  PARTIAL = 'partial',
}

export class CreateTaskCompletionDto {
  @IsString()
  taskId: string;

  @IsString()
  delegatedTo: string;

  @IsString()
  delegatedBy: string;

  @IsString()
  taskDescription: string;

  @IsString()
  @IsOptional()
  domain?: string;

  @IsEnum(TaskOutcome)
  outcome: TaskOutcome;

  @IsNumber()
  durationMs: number;

  @IsObject()
  @IsOptional()
  qualitySignals?: Record<string, any>;

  @IsObject()
  @IsOptional()
  metadata?: Record<string, any>;
}

export class QueryTaskCompletionsDto {
  @IsString()
  @IsOptional()
  agentId?: string;

  @IsString()
  @IsOptional()
  taskId?: string;

  @IsNumber()
  @IsOptional()
  limit?: number;

  @IsNumber()
  @IsOptional()
  offset?: number;
}
