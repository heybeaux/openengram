import { IsArray, IsOptional, IsString, ValidateNested, IsNumber, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * A single conversation turn for reflection analysis
 */
export class ConversationTurnDto {
  @ApiProperty({ enum: ['user', 'assistant'], description: 'Role of the speaker' })
  @IsString()
  role: 'user' | 'assistant';

  @ApiProperty({ description: 'Content of the message' })
  @IsString()
  content: string;

  @ApiPropertyOptional({ description: 'ISO timestamp of the message' })
  @IsOptional()
  @IsString()
  timestamp?: string;
}

/**
 * Request body for agent reflection endpoint
 */
export class ReflectDto {
  @ApiProperty({
    type: [ConversationTurnDto],
    description: 'Recent conversation turns to reflect upon',
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ConversationTurnDto)
  recentTurns: ConversationTurnDto[];

  @ApiPropertyOptional({ description: 'Agent name for personalized reflection' })
  @IsOptional()
  @IsString()
  agentName?: string;

  @ApiPropertyOptional({ 
    description: 'Minimum importance score for memories to be created (0-1)',
    default: 0.5,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  minImportance?: number;

  @ApiPropertyOptional({ description: 'Maximum number of memories to create per reflection' })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(10)
  maxMemories?: number;
}

/**
 * Response from reflection endpoint
 */
export class ReflectionResultDto {
  @ApiProperty({ description: 'IDs of created memories' })
  memoriesCreated: string[];

  @ApiProperty({ description: 'Number of insights extracted' })
  insightsExtracted: number;

  @ApiProperty({ description: 'Categories of insights found' })
  categories: {
    identity: number;
    lessons: number;
    preferences: number;
    workingStyle: number;
  };
}
