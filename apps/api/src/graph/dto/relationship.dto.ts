import {
  IsString,
  IsOptional,
  IsArray,
  IsEnum,
  IsObject,
  IsNumber,
  IsBoolean,
  Min,
  Max,
} from 'class-validator';
import { GraphRelationshipType } from '@prisma/client';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * DTO for creating a new relationship
 */
export class CreateRelationshipDto {
  @IsString()
  userId: string;

  @IsString()
  sourceEntityId: string;

  @IsString()
  targetEntityId: string;

  @ApiProperty({
    enum: [
      'SPOUSE_OF',
      'PARENT_OF',
      'CHILD_OF',
      'SIBLING_OF',
      'FRIEND_OF',
      'COLLEAGUE_OF',
      'LIVES_IN',
      'WORKS_AT',
      'LOCATED_IN',
      'BORN_IN',
      'OWNS',
      'MEMBER_OF',
      'PART_OF',
      'INSTANCE_OF',
      'HAPPENED_BEFORE',
      'HAPPENED_AFTER',
      'HAPPENED_DURING',
      'HAS_ATTRIBUTE',
      'CAUSED_BY',
      'RESULTS_IN',
      'RELATED_TO',
      'CUSTOM',
    ],
    type: String,
  })
  @IsEnum(GraphRelationshipType)
  type: string;

  @IsOptional()
  @IsString()
  label?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  weight?: number = 1.0;

  @IsOptional()
  @IsObject()
  properties?: Record<string, any>;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  sourceMemoryIds?: string[];

  @IsOptional()
  @IsBoolean()
  isInferred?: boolean = false;
}

/**
 * DTO for updating a relationship
 */
export class UpdateRelationshipDto {
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  weight?: number;

  @IsOptional()
  @IsObject()
  properties?: Record<string, any>;

  @IsOptional()
  @IsString()
  label?: string;
}

/**
 * DTO for listing relationships
 */
export class ListRelationshipsDto {
  @IsString()
  userId: string;

  @IsOptional()
  @IsString()
  entityId?: string;

  @IsOptional()
  @ApiPropertyOptional({
    enum: [
      'SPOUSE_OF',
      'PARENT_OF',
      'CHILD_OF',
      'SIBLING_OF',
      'FRIEND_OF',
      'COLLEAGUE_OF',
      'LIVES_IN',
      'WORKS_AT',
      'LOCATED_IN',
      'BORN_IN',
      'OWNS',
      'MEMBER_OF',
      'PART_OF',
      'INSTANCE_OF',
      'HAPPENED_BEFORE',
      'HAPPENED_AFTER',
      'HAPPENED_DURING',
      'HAS_ATTRIBUTE',
      'CAUSED_BY',
      'RESULTS_IN',
      'RELATED_TO',
      'CUSTOM',
    ],
    type: String,
  })
  @IsEnum(GraphRelationshipType)
  type?: string;

  @IsOptional()
  @IsString()
  direction?: 'outgoing' | 'incoming' | 'both';

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(100)
  limit?: number = 50;
}

/**
 * DTO for graph traversal
 */
export class TraverseGraphDto {
  @IsString()
  userId: string;

  @IsString()
  startEntityId: string;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(5)
  maxDepth?: number = 2;

  @IsOptional()
  @IsArray()
  @ApiPropertyOptional({
    enum: [
      'SPOUSE_OF',
      'PARENT_OF',
      'CHILD_OF',
      'SIBLING_OF',
      'FRIEND_OF',
      'COLLEAGUE_OF',
      'LIVES_IN',
      'WORKS_AT',
      'LOCATED_IN',
      'BORN_IN',
      'OWNS',
      'MEMBER_OF',
      'PART_OF',
      'INSTANCE_OF',
      'HAPPENED_BEFORE',
      'HAPPENED_AFTER',
      'HAPPENED_DURING',
      'HAS_ATTRIBUTE',
      'CAUSED_BY',
      'RESULTS_IN',
      'RELATED_TO',
      'CUSTOM',
    ],
    isArray: true,
    type: String,
  })
  @IsEnum(GraphRelationshipType, { each: true })
  relationshipTypes?: string[];

  @IsOptional()
  @IsBoolean()
  includeMemories?: boolean = false;
}

/**
 * Result of graph traversal
 */
export interface GraphTraversalResult {
  nodes: Array<{
    id: string;
    name: string;
    type: string;
    depth: number;
  }>;
  edges: Array<{
    id: string;
    sourceId: string;
    targetId: string;
    type: string;
    weight: number;
  }>;
}
