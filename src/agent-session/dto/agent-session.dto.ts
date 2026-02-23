import {
  IsString,
  IsOptional,
  IsEnum,
  IsNumber,
  Min,
  Max,
} from 'class-validator';
import { AgentSessionStatus } from '@prisma/client';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

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
  @ApiPropertyOptional({ enum: ['ACTIVE', 'COMPLETED', 'TERMINATED'], type: String })
  @IsEnum(AgentSessionStatus)
  @IsOptional()
  status?: string;

  @IsString()
  @IsOptional()
  label?: string;

  @IsString()
  @IsOptional()
  taskDescription?: string;
}
