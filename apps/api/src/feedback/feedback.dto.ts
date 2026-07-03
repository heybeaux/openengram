import { IsInt, IsString, IsOptional, Min, Max, IsIn } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateFeedbackDto {
  @ApiProperty({ minimum: 0, maximum: 10 })
  @IsInt()
  @Min(0)
  @Max(10)
  rating: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  text?: string;

  @ApiProperty({ enum: ['bug', 'feature', 'general', 'nps'] })
  @IsString()
  @IsIn(['bug', 'feature', 'general', 'nps'])
  category: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  page?: string;
}
