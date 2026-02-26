import {
  IsNumber,
  IsOptional,
  IsBoolean,
  IsString,
  Min,
  Max,
} from 'class-validator';

export class NotificationConfigDto {
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  confidenceThreshold?: number;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsString()
  webhookUrl?: string;

  @IsOptional()
  @IsString()
  webhookSecret?: string;
}
