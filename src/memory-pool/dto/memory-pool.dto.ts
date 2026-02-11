import { IsString, IsOptional, IsEnum } from 'class-validator';
import { PoolVisibility, PoolPermission } from '@prisma/client';

export class CreateMemoryPoolDto {
  @IsString()
  name: string;

  @IsString()
  userId: string;

  @IsEnum(PoolVisibility)
  @IsOptional()
  visibility?: PoolVisibility;

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  createdBy: string; // agent session key
}

export class GrantPoolAccessDto {
  @IsString()
  agentSessionId: string; // AgentSession.id

  @IsEnum(PoolPermission)
  @IsOptional()
  permission?: PoolPermission;

  @IsString()
  grantedBy: string; // session key of grantor
}

export class AddMemoryToPoolDto {
  @IsString()
  memoryId: string;

  @IsString()
  addedBy: string;
}
