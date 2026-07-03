import { IsOptional, IsIn, IsDateString, IsBoolean } from 'class-validator';
import { Transform } from 'class-transformer';

export class TimelineQueryDto {
  @IsOptional()
  @IsIn(['hour', 'day', 'week'])
  granularity?: 'hour' | 'day' | 'week' = 'day';

  @IsOptional()
  @IsDateString()
  start?: string;

  @IsOptional()
  @IsDateString()
  end?: string;

  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  cumulative?: boolean = false;
}

export interface TimelineDataPoint {
  timestamp: string;
  count: number;
  cumulative?: number;
}

export interface TimelineResponse {
  granularity: 'hour' | 'day' | 'week';
  data: TimelineDataPoint[];
  total: number;
  range: {
    start: string;
    end: string;
  };
}
