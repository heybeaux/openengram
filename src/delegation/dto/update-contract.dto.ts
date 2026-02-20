import { IsOptional, IsString, IsIn } from 'class-validator';

export const CONTRACT_STATUSES = [
  'PROPOSED',
  'ACCEPTED',
  'IN_PROGRESS',
  'COMPLETED',
  'VERIFIED',
  'REJECTED',
] as const;
export type ContractStatus = (typeof CONTRACT_STATUSES)[number];

export class UpdateContractDto {
  @IsOptional()
  @IsIn(CONTRACT_STATUSES)
  status?: ContractStatus;

  @IsOptional()
  @IsString()
  result?: string;
}

