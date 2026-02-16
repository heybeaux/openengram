import { IsArray, IsString, IsOptional, IsNumber, IsEnum, ValidateNested, ArrayMaxSize } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SyncMemoryEntityDto {
  @ApiProperty()
  @IsString()
  name: string;

  @ApiProperty()
  @IsString()
  type: string;

  @ApiProperty()
  @IsString()
  normalizedName: string;
}

export class SyncMemoryExtractionDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  who?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  what?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  when?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  whereCtx?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  why?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  how?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  topics?: string[];
}

export class SyncMemoryPayloadDto {
  @ApiProperty()
  @IsString()
  raw: string;

  @ApiProperty()
  @IsString()
  layer: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  memoryType?: string;

  @ApiProperty()
  @IsString()
  source: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  importanceHint?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  importanceScore?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  effectiveScore?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  priority?: number;

  @ApiProperty()
  @IsString()
  contentHash: string;

  @ApiProperty({ description: 'Source memory ID on the local instance' })
  @IsString()
  localId: string;

  @ApiProperty()
  @IsString()
  instanceId: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  createdAt?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @ValidateNested()
  @Type(() => SyncMemoryExtractionDto)
  extraction?: SyncMemoryExtractionDto;

  @ApiPropertyOptional({ type: [SyncMemoryEntityDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SyncMemoryEntityDto)
  entities?: SyncMemoryEntityDto[];
}

export class SyncPushDto {
  @ApiProperty({ type: [SyncMemoryPayloadDto] })
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => SyncMemoryPayloadDto)
  memories: SyncMemoryPayloadDto[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  syncProtocolVersion?: number;
}

export interface SyncPushResultItem {
  sourceMemoryId: string;
  cloudMemoryId?: string;
  status: 'created' | 'skipped' | 'failed';
  error?: string;
}

export interface SyncPushResponse {
  results: SyncPushResultItem[];
}
