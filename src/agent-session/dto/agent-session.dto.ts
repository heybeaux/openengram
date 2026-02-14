import {
  IsString,
  IsOptional,
  IsEnum,
  IsNumber,
  Min,
  Max,
} from 'class-validator';
import { AgentSessionStatus } from '@prisma/client';

export class CreateAgentSessionDto {
  @IsString()
  sessionKey: string;

  @IsString()
  @IsOptional()
  parentKey?: string;

  @IsString()
  @IsOptional()
  label?: string;

  @IsString()
  @IsOptional()
  taskDescription?: string;

  @IsString()
  @IsOptional()
  userId?: string;

  @IsOptional()
  @IsNumber()
  @Min(200)
  @Max(16000)
  contextTokenBudget?: number;
}

export class UpdateAgentSessionDto {
  @IsEnum(AgentSessionStatus)
  @IsOptional()
  status?: AgentSessionStatus;

  @IsString()
  @IsOptional()
  label?: string;

  @IsString()
  @IsOptional()
  taskDescription?: string;
}
