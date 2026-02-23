import { IsOptional, IsInt, IsString, Min, Max, IsEnum } from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { MemoryLayer } from '@prisma/client';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ListMemoriesDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 25;

  @IsOptional()
  @ApiPropertyOptional({ enum: ['IDENTITY', 'PROJECT', 'SESSION', 'TASK', 'INSIGHT'], type: String })
  @IsEnum(MemoryLayer)
  layer?: string;

  @IsOptional()
  @IsString()
  userId?: string;
}
