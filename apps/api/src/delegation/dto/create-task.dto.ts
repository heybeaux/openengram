import { IsString, IsOptional, IsDateString, IsObject } from 'class-validator';

export class CreateTaskDto {
  @IsString()
  assignedTo: string;

  @IsString()
  assignedBy: string;

  @IsString()
  taskDescription: string;

  @IsOptional()
  @IsDateString()
  deadline?: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, any>;

  @IsOptional()
  @IsString()
  templateId?: string;

  @IsOptional()
  @IsString()
  contractId?: string;
}
