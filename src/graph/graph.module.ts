import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../prisma/prisma.module';
import { LLMModule } from '../llm/llm.module';
import { VectorModule } from '../vector/vector.module';
import { GraphController } from './graph.controller';
import { EntityService } from './services/entity.service';
import { RelationshipService } from './services/relationship.service';
import { GraphExtractionService } from './services/graph-extraction.service';
import { GraphService } from './services/graph.service';

/**
 * GraphModule - Semantic Memory Graphs
 *
 * Provides entity-relationship knowledge graph capabilities for Engram.
 * Feature-flagged via GRAPH_ENABLED environment variable.
 *
 * Components:
 * - EntityService: CRUD for graph entities (nodes)
 * - RelationshipService: CRUD for relationships (edges)
 * - GraphExtractionService: LLM-based entity/relationship extraction
 * - GraphService: High-level graph operations and queries
 */
@Module({
  imports: [ConfigModule, PrismaModule, LLMModule, VectorModule],
  controllers: [GraphController],
  providers: [
    EntityService,
    RelationshipService,
    GraphExtractionService,
    GraphService,
  ],
  exports: [
    EntityService,
    RelationshipService,
    GraphExtractionService,
    GraphService,
  ],
})
export class GraphModule {}
