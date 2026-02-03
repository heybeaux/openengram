import { IsOptional, IsInt, IsString, Min, Max, IsEnum } from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { MemoryLayer } from '@prisma/client';

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
  @IsEnum(MemoryLayer)
  layer?: MemoryLayer;

  @IsOptional()
  @IsString()
  userId?: string;
}
