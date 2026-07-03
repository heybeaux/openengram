import {
  IsOptional,
  IsBoolean,
  IsNumber,
  IsArray,
  IsString,
  Min,
  Max,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Options for anticipatory recall, nested inside QueryMemoryDto.
 */
export class AnticipatoryOptionsDto {
  @ApiPropertyOptional({
    description: 'Enable anticipatory recall for this query',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean = false;

  @ApiPropertyOptional({
    description: 'Maximum anticipatory results to return',
    default: 3,
  })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(5)
  maxResults?: number = 3;

  @ApiPropertyOptional({
    description:
      'Override strategy selection (e.g., ["entity_radiation", "insight_injection"])',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  strategies?: string[];

  @ApiPropertyOptional({
    description: 'Minimum salience score to include anticipatory results (0-1)',
    default: 0.3,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  minSalience?: number = 0.3;
}

/**
 * Metadata attached to each anticipatory memory in the response.
 */
export interface AnticipatoryMemoryMeta {
  strategy: string;
  reason: string;
  salience: number;
  entityPath?: string[];
  insightType?: string;
}

/**
 * Summary metadata for the entire anticipatory result set.
 */
export interface AnticipatoryMeta {
  strategiesRun: string[];
  latencyMs: number;
  circuitBreakerActive: boolean;
  signals: {
    entitiesDetected: string[];
    topics: string[];
  };
}

/**
 * Feedback DTO for the anticipatory feedback endpoint.
 */
export class AnticipatoryFeedbackDto {
  @IsString()
  memoryId: string;

  @IsOptional()
  @IsString()
  recallId?: string;

  @IsBoolean()
  wasUseful: boolean;
}
