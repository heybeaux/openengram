import { IsOptional, IsIn, IsDateString, IsBoolean } from 'class-validator';
import { Transform } from 'class-transformer';
import { MemoryType, MemoryLayer } from '@prisma/client';

export class TypeBreakdownQueryDto {
  @IsOptional()
  @IsIn(['day', 'week', 'month'])
  granularity?: 'day' | 'week' | 'month' = 'week';

  @IsOptional()
  @IsDateString()
  start?: string;

  @IsOptional()
  @IsDateString()
  end?: string;
}

export class LayerBreakdownQueryDto {
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  includeTrend?: boolean = true;

  @IsOptional()
  @IsIn(['day', 'week'])
  granularity?: 'day' | 'week' = 'week';
}

export interface TypeBreakdownPoint {
  timestamp: string;
  types: Record<MemoryType, number>;
  total: number;
}

export interface TypeBreakdownResponse {
  granularity: 'day' | 'week' | 'month';
  data: TypeBreakdownPoint[];
  summary: {
    dominant: MemoryType | null;
    distribution: Record<string, { count: number; percentage: number }>;
  };
}

export interface LayerDistribution {
  layer: MemoryLayer;
  count: number;
  percentage: number;
}

export interface LayerTrendPoint {
  timestamp: string;
  layers: Record<MemoryLayer, number>;
}

export interface LayerDistributionResponse {
  current: LayerDistribution[];
  total: number;
  trend?: {
    granularity: 'day' | 'week';
    data: LayerTrendPoint[];
  };
}
