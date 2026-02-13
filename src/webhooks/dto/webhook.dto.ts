import {
  IsString,
  IsUrl,
  IsArray,
  IsOptional,
  IsBoolean,
  IsInt,
  IsNumber,
  Min,
  Max,
  ArrayMinSize,
} from 'class-validator';

export class CreateWebhookDto {
  @IsUrl()
  url: string;

  @IsArray()
  @IsString({ each: true })
  @ArrayMinSize(1)
  events: string[];

  @IsOptional()
  @IsString()
  secret?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10)
  maxRetries?: number;

  @IsOptional()
  @IsInt()
  @Min(100)
  backoffMs?: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  filterLayers?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  filterTags?: string[];

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  filterMinImportance?: number;
}

export class UpdateWebhookDto {
  @IsOptional()
  @IsUrl()
  url?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  events?: string[];

  @IsOptional()
  @IsString()
  secret?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10)
  maxRetries?: number;

  @IsOptional()
  @IsInt()
  @Min(100)
  backoffMs?: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  filterLayers?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  filterTags?: string[];

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  filterMinImportance?: number;
}
