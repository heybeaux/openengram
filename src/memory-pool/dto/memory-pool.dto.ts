import { IsString, IsOptional, IsEnum } from 'class-validator';
import { PoolVisibility, PoolPermission } from '@prisma/client';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateMemoryPoolDto {
  @IsString()
  name: string;

  @IsString()
  userId: string;

  @ApiPropertyOptional({ enum: ['GLOBAL', 'SHARED', 'PRIVATE'], type: String })
  @IsEnum(PoolVisibility)
  @IsOptional()
  visibility?: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  createdBy: string; // agent session key
}

export class GrantPoolAccessDto {
  @IsString()
  agentSessionId: string; // AgentSession.id

  @ApiPropertyOptional({ enum: ['READ', 'WRITE', 'ADMIN'], type: String })
  @IsEnum(PoolPermission)
  @IsOptional()
  permission?: string;

  @IsString()
  grantedBy: string; // session key of grantor
}

export class AddMemoryToPoolDto {
  @IsString()
  memoryId: string;

  @IsString()
  addedBy: string;
}
