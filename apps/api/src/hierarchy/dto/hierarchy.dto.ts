import {
  IsString,
  IsOptional,
  IsNumber,
  IsArray,
  IsIn,
  Min,
  Max,
} from 'class-validator';

/**
 * DTO for hierarchy search requests
 */
export class HierarchySearchDto {
  @IsString()
  query: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @IsIn(['L0', 'L1', 'L2', 'L3'], { each: true })
  levels?: string[];

  @IsOptional()
  @IsIn(['auto', 'explicit'])
  routing?: 'auto' | 'explicit';

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(100)
  topK?: number;
}

/**
 * DTO for query analysis requests
 */
export class HierarchyQueryAnalyzeDto {
  @IsString()
  query: string;
}

/**
 * DTO for hierarchy processing options
 */
export class HierarchyProcessOptionsDto {
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @IsIn(['L0', 'L1'], { each: true })
  levels?: string[];

  @IsOptional()
  @IsString()
  sessionId?: string;
}
