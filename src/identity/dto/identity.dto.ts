import { IsString, IsOptional, IsNumber, IsIn, Min, Max } from 'class-validator';

export class RecordTrustSignalDto {
  @IsIn(['SUCCESS', 'FAILURE', 'CORRECTION'])
  signalType: 'SUCCESS' | 'FAILURE' | 'CORRECTION';

  @IsString()
  context: string;

  @IsOptional()
  @IsString()
  agentId?: string;

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(2)
  weight?: number;

  @IsOptional()
  @IsString()
  sourceMemoryId?: string;
}

export class ComputeScoreDto {
  @IsOptional()
  @IsString()
  agentId?: string;

  @IsOptional()
  @IsString()
  category?: string;
}
