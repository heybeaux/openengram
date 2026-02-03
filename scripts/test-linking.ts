/**
 * Test script to debug memory linking
 * Tests the linking flow step by step
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Constants from memory.service.ts
const DEDUP_SIMILARITY_THRESHOLD = 0.90;
const RELATED_SIMILARITY_THRESHOLD = 0.65;

async function main() {
  console.log('=== Memory Linking Debug Test ===\n');
  
  // 1. Get a memory with embedding
  const testMemory = await prisma.memory.findFirst({
    where: { embeddingId: { not: null } },
    orderBy: { createdAt: 'desc' },
    select: { id: true, raw: true, embeddingId: true, userId: true },
  });
  
  if (!testMemory) {
    console.error('No memories with embeddings found!');
    return;
  }
  
  console.log('Test Memory:');
  console.log(`  ID: ${testMemory.id}`);
  console.log(`  Raw: ${testMemory.raw.substring(0, 80)}...`);
  console.log(`  User: ${testMemory.userId}`);
  console.log(`  EmbeddingId: ${testMemory.embeddingId}`);
  
  // 2. Check if embedding exists in vector store via pg_vectors
  console.log('\n--- Checking pgvector table ---');
  
  // Check if there's a pgvector table
  const vectorTableCheck = await prisma.$queryRaw<any[]>`
    SELECT table_name 
    FROM information_schema.tables 
    WHERE table_schema = 'public' 
    AND table_name LIKE '%vector%' OR table_name LIKE '%embedding%'
  `;
  console.log('Vector-related tables:', vectorTableCheck);
  
  // 3. Check the Embedding table
  console.log('\n--- Checking Embedding records ---');
  const embeddingCount = await prisma.$queryRaw<any[]>`
    SELECT COUNT(*)::int as count FROM "Embedding"
  `;
  console.log('Total embeddings in Embedding table:', embeddingCount);
  
  // 4. Get sample embedding
  const sampleEmbedding = await prisma.$queryRaw<any[]>`
    SELECT id, "memoryId", array_length(embedding, 1) as dimensions 
    FROM "Embedding" 
    LIMIT 3
  `;
  console.log('Sample embeddings:', sampleEmbedding);
  
  // 5. Check if search works - use raw SQL with pgvector
  console.log('\n--- Testing Vector Search ---');
  
  // Get the actual embedding vector for our test memory
  const memoryEmbedding = await prisma.$queryRaw<any[]>`
    SELECT id, embedding 
    FROM "Embedding" 
    WHERE "memoryId" = ${testMemory.id}
  `;
  
  if (memoryEmbedding.length === 0) {
    console.log('No embedding found for test memory!');
    return;
  }
  
  console.log(`Found embedding for memory ${testMemory.id}`);
  
  // 6. Search for similar embeddings using cosine similarity
  console.log('\n--- Searching for Similar Memories ---');
  
  const similarMemories = await prisma.$queryRaw<any[]>`
    SELECT 
      e.id,
      e."memoryId",
      m.raw,
      1 - (e.embedding <=> (SELECT embedding FROM "Embedding" WHERE "memoryId" = ${testMemory.id})) as score
    FROM "Embedding" e
    JOIN "Memory" m ON m.id = e."memoryId"
    WHERE m."userId" = ${testMemory.userId}
      AND e."memoryId" != ${testMemory.id}
    ORDER BY e.embedding <=> (SELECT embedding FROM "Embedding" WHERE "memoryId" = ${testMemory.id})
    LIMIT 10
  `;
  
  console.log(`Found ${similarMemories.length} similar memories:`);
  for (const sim of similarMemories) {
    console.log(`  Score: ${sim.score.toFixed(4)} | ${sim.raw.substring(0, 60)}...`);
  }
  
  // 7. Check how many would qualify for linking
  const qualifyForLinking = similarMemories.filter(
    m => m.score >= RELATED_SIMILARITY_THRESHOLD && m.score < DEDUP_SIMILARITY_THRESHOLD
  );
  
  console.log(`\n--- Linking Analysis ---`);
  console.log(`Similarity threshold for linking: ${RELATED_SIMILARITY_THRESHOLD} - ${DEDUP_SIMILARITY_THRESHOLD}`);
  console.log(`Memories that would qualify for linking: ${qualifyForLinking.length}`);
  
  for (const m of qualifyForLinking) {
    console.log(`  Would link: ${m.score.toFixed(4)} | ${m.raw.substring(0, 60)}...`);
  }
  
  // 8. Check existing links for this memory
  const existingLinks = await prisma.memoryChainLink.findMany({
    where: {
      OR: [
        { sourceId: testMemory.id },
        { targetId: testMemory.id },
      ],
    },
  });
  console.log(`\nExisting links for this memory: ${existingLinks.length}`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
