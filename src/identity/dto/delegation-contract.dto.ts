import { IsString, IsArray, IsNumber, IsOptional, IsIn } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateDelegationContractDto {
  @ApiProperty({ description: 'Task description' })
  @IsString()
  taskDescription: string;

  @ApiProperty({ description: 'Expected outputs', type: [String] })
  @IsArray()
  @IsString({ each: true })
  expectedOutputs: string[];

  @ApiProperty({ description: 'Success criteria', type: [String] })
  @IsArray()
  @IsString({ each: true })
  successCriteria: string[];

  @ApiProperty({ description: 'Timeout in ms' })
  @IsNumber()
  timeout: number;

  @ApiPropertyOptional({ description: 'Constraints', type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  constraints?: string[];

  @ApiProperty({ description: 'Agent ID to delegate to' })
  @IsString()
  delegatedTo: string;

  @ApiPropertyOptional({ description: 'Account ID' })
  @IsOptional()
  @IsString()
  accountId?: string;
}

export class CompleteContractRequestDto {
  @ApiProperty({ description: 'Completion status', enum: ['completed', 'failed'] })
  @IsIn(['completed', 'failed'])
  status: 'completed' | 'failed';

  @ApiPropertyOptional({ description: 'Result description' })
  @IsOptional()
  @IsString()
  result?: string;
}
