import { IsOptional, IsString, IsIn } from 'class-validator';
import { TASK_STATUSES, TaskStatus } from './update-task.dto';

export class QueryTaskDto {
  @IsOptional()
  @IsIn(TASK_STATUSES)
  status?: TaskStatus;

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
