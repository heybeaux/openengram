import { IsString, IsOptional, IsEnum } from 'class-validator';
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
