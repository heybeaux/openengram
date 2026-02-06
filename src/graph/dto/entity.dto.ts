import {
  IsString,
  IsOptional,
  IsArray,
  IsEnum,
  IsObject,
  IsNumber,
  Min,
  Max,
} from 'class-validator';
import { GraphEntityType } from '@prisma/client';

/**
 * DTO for creating a new graph entity
 */
export class CreateEntityDto {
  @IsString()
  userId: string;

  @IsString()
  name: string;

  @IsEnum(GraphEntityType)
  type: GraphEntityType;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  aliases?: string[];

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, any>;

  @IsOptional()
  @IsString()
  firstSeenMemoryId?: string;
}

/**
 * DTO for updating an existing entity
 */
export class UpdateEntityDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsEnum(GraphEntityType)
  type?: GraphEntityType;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  aliases?: string[];

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, any>;
}

/**
 * DTO for searching entities
 */
export class SearchEntitiesDto {
  @IsString()
  userId: string;

  @IsString()
  query: string;

  @IsOptional()
  @IsEnum(GraphEntityType)
  type?: GraphEntityType;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(100)
  limit?: number = 10;
}

/**
 * DTO for listing entities
 */
export class ListEntitiesDto {
  @IsString()
  userId: string;

  @IsOptional()
  @IsEnum(GraphEntityType)
  type?: GraphEntityType;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(100)
  limit?: number = 50;

  @IsOptional()
  @IsNumber()
  @Min(0)
  offset?: number = 0;
}

/**
 * Entity with relationships included
 */
export interface EntityWithRelationships {
  entity: {
    id: string;
    userId: string;
    name: string;
    type: GraphEntityType;
    aliases: string[];
    description: string | null;
    metadata: Record<string, any>;
    mentionCount: number;
    createdAt: Date;
    updatedAt: Date;
  };
  outgoingRelationships: Array<{
    id: string;
    type: string;
    weight: number;
    target: {
      id: string;
      name: string;
      type: string;
    };
  }>;
  incomingRelationships: Array<{
    id: string;
    type: string;
    weight: number;
    source: {
      id: string;
      name: string;
      type: string;
    };
  }>;
}
