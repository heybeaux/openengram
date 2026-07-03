-- CreateEnum
CREATE TYPE "Lod" AS ENUM ('INDEX', 'SUMMARY', 'STANDARD', 'DEEP');

-- CreateEnum
CREATE TYPE "EdgeType" AS ENUM ('CONTAINS', 'IMPORTS', 'CALLS', 'EXTENDS');

-- CreateTable
CREATE TABLE "cards" (
    "id" TEXT NOT NULL,
    "repoId" TEXT NOT NULL,
    "conceptPath" TEXT NOT NULL,
    "lod" "Lod" NOT NULL,
    "content" TEXT NOT NULL,
    "embedding" vector(768),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "graph_edges" (
    "id" TEXT NOT NULL,
    "repoId" TEXT NOT NULL,
    "fromPath" TEXT NOT NULL,
    "toPath" TEXT NOT NULL,
    "edgeType" "EdgeType" NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "graph_edges_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "cards_conceptPath_idx" ON "cards"("conceptPath");

-- CreateIndex
CREATE UNIQUE INDEX "cards_repoId_conceptPath_lod_key" ON "cards"("repoId", "conceptPath", "lod");

-- CreateIndex
CREATE INDEX "graph_edges_repoId_fromPath_idx" ON "graph_edges"("repoId", "fromPath");

-- CreateIndex
CREATE INDEX "graph_edges_repoId_toPath_idx" ON "graph_edges"("repoId", "toPath");

-- CreateIndex
CREATE INDEX "graph_edges_repoId_edgeType_idx" ON "graph_edges"("repoId", "edgeType");

-- AddForeignKey
ALTER TABLE "cards" ADD CONSTRAINT "cards_repoId_fkey" FOREIGN KEY ("repoId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "graph_edges" ADD CONSTRAINT "graph_edges_repoId_fkey" FOREIGN KEY ("repoId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
