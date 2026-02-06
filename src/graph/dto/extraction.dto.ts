import { GraphEntityType, GraphRelationshipType, GraphMentionRole } from '@prisma/client';

/**
 * Entity extracted from text by LLM
 */
export interface ExtractedEntity {
  name: string;
  type: GraphEntityType;
  aliases: string[];
  role: GraphMentionRole;
  confidence?: number;
}

/**
 * Relationship extracted from text by LLM
 */
export interface ExtractedRelationship {
  source: string;
  target: string;
  type: GraphRelationshipType;
  label?: string;
  confidence: number;
  properties: Record<string, any>;
}

/**
 * Complete extraction result from a memory
 */
export interface ExtractionResult {
  entities: ExtractedEntity[];
  relationships: ExtractedRelationship[];
  processingTimeMs: number;
}

/**
 * Result of processing a memory for graph data
 */
export interface MemoryProcessingResult {
  memoryId: string;
  entitiesCreated: number;
  entitiesUpdated: number;
  relationshipsCreated: number;
  relationshipsUpdated: number;
  mentionsCreated: number;
  processingTimeMs: number;
}
