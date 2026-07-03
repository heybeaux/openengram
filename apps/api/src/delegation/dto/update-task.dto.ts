import { IsString, IsOptional, IsIn } from 'class-validator';

export const TASK_STATUSES = [
  'ASSIGNED',
  'IN_PROGRESS',
  'COMPLETED',
  'FAILED',
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export class UpdateTaskDto {
  @IsOptional()
  @IsIn(TASK_STATUSES)
  status?: TaskStatus;

  @IsOptional()
  @IsString()
  result?: string;
}
