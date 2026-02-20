import {
  IsString,
  IsOptional,
  IsArray,
  IsInt,
  IsObject,
} from 'class-validator';

export class CreateTemplateDto {
  @IsString()
  name: string;

  @IsString()
  taskType: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  requiredCapabilities?: string[];

  @IsOptional()
  @IsString()
  defaultInstructions?: string;

  @IsOptional()
  @IsString()
  expectedOutputs?: string;

  @IsOptional()
  @IsInt()
  typicalDurationMs?: number;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, any>;
}
