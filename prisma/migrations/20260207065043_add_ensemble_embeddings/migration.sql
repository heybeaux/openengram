-- AlterTable
ALTER TABLE "code_chunks" ADD COLUMN     "embedding_bge" vector(768),
ADD COLUMN     "embedding_gte" vector(768),
ADD COLUMN     "embedding_minilm" vector(384),
ADD COLUMN     "embedding_nomic" vector(768);
