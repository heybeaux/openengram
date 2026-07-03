-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "vector";

-- CreateTable
CREATE TABLE "projects" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "rootPath" TEXT NOT NULL,
    "languages" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastIngestedAt" TIMESTAMP(3),

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "code_chunks" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "lineStart" INTEGER NOT NULL,
    "lineEnd" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "chunkType" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "parentName" TEXT,
    "dependencies" TEXT[],
    "embedding" vector(768),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "checksum" TEXT NOT NULL,

    CONSTRAINT "code_chunks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "projects_name_key" ON "projects"("name");

-- CreateIndex
CREATE INDEX "code_chunks_projectId_idx" ON "code_chunks"("projectId");

-- CreateIndex
CREATE INDEX "code_chunks_filePath_idx" ON "code_chunks"("filePath");

-- CreateIndex
CREATE INDEX "code_chunks_language_idx" ON "code_chunks"("language");

-- CreateIndex
CREATE INDEX "code_chunks_chunkType_idx" ON "code_chunks"("chunkType");

-- AddForeignKey
ALTER TABLE "code_chunks" ADD CONSTRAINT "code_chunks_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
