-- CreateTable: Multi-model memory embeddings for ensemble retrieval
-- This table stores embeddings from different models per memory
-- pgvector handles variable dimensions natively

-- Ensure pgvector extension exists
CREATE EXTENSION IF NOT EXISTS vector;

-- Create the memory_embeddings table
CREATE TABLE "memory_embeddings" (
    "id" TEXT NOT NULL,
    "memory_id" TEXT NOT NULL,
    "model_id" TEXT NOT NULL,
    "dimensions" INTEGER NOT NULL DEFAULT 768,
    "embedding" vector,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "memory_embeddings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: unique constraint on memory_id + model_id (one embedding per model per memory)
CREATE UNIQUE INDEX "memory_embeddings_memory_id_model_id_key" ON "memory_embeddings"("memory_id", "model_id");

-- CreateIndex: for filtering by model
CREATE INDEX "memory_embeddings_model_id_idx" ON "memory_embeddings"("model_id");

-- CreateIndex: for looking up embeddings by memory
CREATE INDEX "memory_embeddings_memory_id_idx" ON "memory_embeddings"("memory_id");

-- Note: IVFFlat indexes require data to build lists, so we skip them here.
-- They will be created later when data exists, or use HNSW instead.

-- AddForeignKey
ALTER TABLE "memory_embeddings" ADD CONSTRAINT "memory_embeddings_memory_id_fkey" 
FOREIGN KEY ("memory_id") REFERENCES "memories"("id") 
ON DELETE CASCADE ON UPDATE CASCADE;
