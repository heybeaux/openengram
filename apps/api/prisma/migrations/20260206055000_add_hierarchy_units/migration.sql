-- Hierarchical Embeddings MVP Migration
-- Phase 1: L0 (sentence) and L1 (paragraph) levels

-- Create enum for hierarchy levels
CREATE TYPE "HierarchyLevel" AS ENUM ('L0', 'L1', 'L2', 'L3');

-- Create hierarchy_units table
CREATE TABLE "hierarchy_units" (
    "id" TEXT NOT NULL,
    "level" "HierarchyLevel" NOT NULL,
    "text" TEXT NOT NULL,
    "summary" TEXT,
    "source_memory_id" TEXT,
    "parent_unit_id" TEXT,
    "position" INTEGER,
    "char_start" INTEGER,
    "char_end" INTEGER,
    "pinecone_id" TEXT NOT NULL,
    "pinecone_namespace" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hierarchy_units_pkey" PRIMARY KEY ("id")
);

-- Create indexes for efficient queries
CREATE UNIQUE INDEX "hierarchy_units_pinecone_id_key" ON "hierarchy_units"("pinecone_id");
CREATE INDEX "hierarchy_units_level_idx" ON "hierarchy_units"("level");
CREATE INDEX "hierarchy_units_source_memory_id_idx" ON "hierarchy_units"("source_memory_id");
CREATE INDEX "hierarchy_units_user_id_level_idx" ON "hierarchy_units"("user_id", "level");
CREATE INDEX "hierarchy_units_parent_unit_id_idx" ON "hierarchy_units"("parent_unit_id");

-- Add foreign key constraints
ALTER TABLE "hierarchy_units" ADD CONSTRAINT "hierarchy_units_source_memory_id_fkey" 
    FOREIGN KEY ("source_memory_id") REFERENCES "memories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "hierarchy_units" ADD CONSTRAINT "hierarchy_units_parent_unit_id_fkey" 
    FOREIGN KEY ("parent_unit_id") REFERENCES "hierarchy_units"("id") ON DELETE SET NULL ON UPDATE CASCADE;
