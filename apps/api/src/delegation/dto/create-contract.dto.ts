import { IsString, IsOptional, IsObject } from 'class-validator';

export class CreateContractDto {
  @IsString()
  delegator: string;

  @IsString()
  delegate: string;

  @IsString()
  taskDescription: string;

  @IsObject()
  terms: {
    deadline?: string;
    qualityCriteria?: string[];
    escalationRules?: string[];
  };

  @IsOptional()
  @IsObject()
  metadata?: Record<string, any>;
}
