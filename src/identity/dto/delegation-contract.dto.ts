import { IsString, IsArray, IsNumber, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateContractBodyDto {
  @ApiProperty() @IsString() taskDescription: string;
  @ApiProperty({ type: [String] }) @IsArray() expectedOutputs: string[];
  @ApiProperty({ type: [String] }) @IsArray() successCriteria: string[];
  @ApiProperty() @IsNumber() timeout: number;
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() constraints?: string[];
  @ApiProperty() @IsString() delegatedTo: string;
  @ApiPropertyOptional() @IsOptional() @IsString() accountId?: string;
}

export class CompleteContractBodyDto {
  @ApiProperty({ enum: ['completed', 'failed'] }) @IsString() status: 'completed' | 'failed';
  @ApiPropertyOptional() @IsOptional() @IsString() result?: string;
}
