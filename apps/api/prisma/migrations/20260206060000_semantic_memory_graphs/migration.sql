-- Semantic Memory Graphs MVP
-- Phase 0: Foundation tables for entity-relationship knowledge graph

-- CreateEnum
CREATE TYPE "GraphEntityType" AS ENUM ('PERSON', 'PLACE', 'ORGANIZATION', 'CONCEPT', 'EVENT', 'OBJECT', 'TIME', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "GraphRelationshipType" AS ENUM ('SPOUSE_OF', 'PARENT_OF', 'CHILD_OF', 'SIBLING_OF', 'FRIEND_OF', 'COLLEAGUE_OF', 'LIVES_IN', 'WORKS_AT', 'LOCATED_IN', 'BORN_IN', 'OWNS', 'MEMBER_OF', 'PART_OF', 'INSTANCE_OF', 'HAPPENED_BEFORE', 'HAPPENED_AFTER', 'HAPPENED_DURING', 'HAS_ATTRIBUTE', 'CAUSED_BY', 'RESULTS_IN', 'RELATED_TO', 'CUSTOM');

-- CreateEnum
CREATE TYPE "GraphMentionRole" AS ENUM ('SUBJECT', 'OBJECT', 'REFERENCE', 'LOCATION');

-- CreateTable: GraphEntity (nodes in the knowledge graph)
CREATE TABLE "graph_entities" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "GraphEntityType" NOT NULL,
    "aliases" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "description" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "mention_count" INTEGER NOT NULL DEFAULT 1,
    "first_seen_memory_id" TEXT,
    "embedding_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "graph_entities_pkey" PRIMARY KEY ("id")
);

-- CreateTable: GraphRelationship (edges in the knowledge graph)
CREATE TABLE "graph_relationships" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "source_entity_id" TEXT NOT NULL,
    "target_entity_id" TEXT NOT NULL,
    "type" "GraphRelationshipType" NOT NULL,
    "label" TEXT,
    "weight" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "properties" JSONB NOT NULL DEFAULT '{}',
    "source_memory_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "is_inferred" BOOLEAN NOT NULL DEFAULT false,
    "last_confirmed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "graph_relationships_pkey" PRIMARY KEY ("id")
);

-- CreateTable: GraphEntityMention (links entities to memories)
CREATE TABLE "graph_entity_mentions" (
    "id" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "memory_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "span" JSONB,
    "role" "GraphMentionRole" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "graph_entity_mentions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: GraphEntity indexes
CREATE UNIQUE INDEX "graph_entities_embedding_id_key" ON "graph_entities"("embedding_id");
CREATE UNIQUE INDEX "graph_entities_user_id_name_type_key" ON "graph_entities"("user_id", "name", "type");
CREATE INDEX "graph_entities_user_id_idx" ON "graph_entities"("user_id");
CREATE INDEX "graph_entities_type_idx" ON "graph_entities"("type");
CREATE INDEX "graph_entities_name_idx" ON "graph_entities"("name");
CREATE INDEX "graph_entities_user_id_mention_count_idx" ON "graph_entities"("user_id", "mention_count" DESC);

-- CreateIndex: GraphRelationship indexes
CREATE UNIQUE INDEX "graph_relationships_user_id_source_entity_id_target_entity__key" ON "graph_relationships"("user_id", "source_entity_id", "target_entity_id", "type");
CREATE INDEX "graph_relationships_user_id_idx" ON "graph_relationships"("user_id");
CREATE INDEX "graph_relationships_source_entity_id_idx" ON "graph_relationships"("source_entity_id");
CREATE INDEX "graph_relationships_target_entity_id_idx" ON "graph_relationships"("target_entity_id");
CREATE INDEX "graph_relationships_type_idx" ON "graph_relationships"("type");

-- CreateIndex: GraphEntityMention indexes
CREATE UNIQUE INDEX "graph_entity_mentions_entity_id_memory_id_key" ON "graph_entity_mentions"("entity_id", "memory_id");
CREATE INDEX "graph_entity_mentions_memory_id_idx" ON "graph_entity_mentions"("memory_id");
CREATE INDEX "graph_entity_mentions_entity_id_idx" ON "graph_entity_mentions"("entity_id");
CREATE INDEX "graph_entity_mentions_user_id_idx" ON "graph_entity_mentions"("user_id");

-- AddForeignKey: GraphEntity relations
ALTER TABLE "graph_entities" ADD CONSTRAINT "graph_entities_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "graph_entities" ADD CONSTRAINT "graph_entities_first_seen_memory_id_fkey" FOREIGN KEY ("first_seen_memory_id") REFERENCES "memories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey: GraphRelationship relations
ALTER TABLE "graph_relationships" ADD CONSTRAINT "graph_relationships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "graph_relationships" ADD CONSTRAINT "graph_relationships_source_entity_id_fkey" FOREIGN KEY ("source_entity_id") REFERENCES "graph_entities"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "graph_relationships" ADD CONSTRAINT "graph_relationships_target_entity_id_fkey" FOREIGN KEY ("target_entity_id") REFERENCES "graph_entities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: GraphEntityMention relations
ALTER TABLE "graph_entity_mentions" ADD CONSTRAINT "graph_entity_mentions_entity_id_fkey" FOREIGN KEY ("entity_id") REFERENCES "graph_entities"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "graph_entity_mentions" ADD CONSTRAINT "graph_entity_mentions_memory_id_fkey" FOREIGN KEY ("memory_id") REFERENCES "memories"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "graph_entity_mentions" ADD CONSTRAINT "graph_entity_mentions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
