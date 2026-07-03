import { IsOptional, IsString, IsIn } from 'class-validator';
import { TASK_STATUSES } from './update-task.dto';

export class QueryTaskDto {
  @IsOptional()
  @IsIn(TASK_STATUSES)
  status?: string;

  @IsOptional()
  @IsString()
  assignedTo?: string;

  @IsOptional()
  @IsString()
  assignedBy?: string;

  @IsOptional()
  @IsString()
  contractId?: string;
}
