/**
 * Test script to debug memory linking - v2
 * Now using correct pgvector storage (embedding in memories table)
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Constants from memory.service.ts
const DEDUP_SIMILARITY_THRESHOLD = 0.90;
const RELATED_SIMILARITY_THRESHOLD = 0.65;

async function main() {
  console.log('=== Memory Linking Debug Test v2 ===\n');
  
  // 1. Check embedding column in memories table
  console.log('--- Checking memories table structure ---');
  
  const memoriesWithEmbedding = await prisma.$queryRaw<any[]>`
    SELECT COUNT(*)::int as count 
    FROM memories 
    WHERE embedding IS NOT NULL
  `;
  console.log('Memories with embeddings:', memoriesWithEmbedding[0].count);
  
  const memoriesWithoutEmbedding = await prisma.$queryRaw<any[]>`
    SELECT COUNT(*)::int as count 
    FROM memories 
    WHERE embedding IS NULL
  `;
  console.log('Memories without embeddings:', memoriesWithoutEmbedding[0].count);
  
  // 2. Get a test memory with embedding
  const testMemory = await prisma.$queryRaw<any[]>`
    SELECT id, user_id, raw, embedding_id
    FROM memories
    WHERE embedding IS NOT NULL
    ORDER BY created_at DESC
    LIMIT 1
  `;
  
  if (testMemory.length === 0) {
    console.error('No memories with embeddings found!');
    return;
  }
  
  const memory = testMemory[0];
  console.log('\nTest Memory:');
  console.log(`  ID: ${memory.id}`);
  console.log(`  Raw: ${memory.raw.substring(0, 80)}...`);
  console.log(`  User: ${memory.user_id}`);
  
  // 3. Search for similar memories using the pgvector search
  console.log('\n--- Searching for Similar Memories ---');
  
  const similarMemories = await prisma.$queryRaw<any[]>`
    SELECT 
      m.id,
      m.raw,
      1 - (m.embedding <=> (SELECT embedding FROM memories WHERE id = ${memory.id})) as score
    FROM memories m
    WHERE m.user_id = ${memory.user_id}
      AND m.id != ${memory.id}
      AND m.embedding IS NOT NULL
      AND m.deleted_at IS NULL
    ORDER BY m.embedding <=> (SELECT embedding FROM memories WHERE id = ${memory.id})
    LIMIT 15
  `;
  
  console.log(`Found ${similarMemories.length} similar memories:`);
  for (const sim of similarMemories) {
    const status = sim.score >= RELATED_SIMILARITY_THRESHOLD && sim.score < DEDUP_SIMILARITY_THRESHOLD 
      ? '✓ LINK' 
      : sim.score >= DEDUP_SIMILARITY_THRESHOLD 
        ? '⚠ DUP' 
        : '✗ LOW';
    console.log(`  [${status}] Score: ${Number(sim.score).toFixed(4)} | ${sim.raw.substring(0, 55)}...`);
  }
  
  // 4. Check how many would qualify for linking
  const qualifyForLinking = similarMemories.filter(
    m => Number(m.score) >= RELATED_SIMILARITY_THRESHOLD && Number(m.score) < DEDUP_SIMILARITY_THRESHOLD
  );
  
  console.log(`\n--- Linking Analysis ---`);
  console.log(`Similarity threshold for linking: ${RELATED_SIMILARITY_THRESHOLD} - ${DEDUP_SIMILARITY_THRESHOLD}`);
  console.log(`Memories that would qualify for linking: ${qualifyForLinking.length}`);
  
  // 5. Check existing links for this memory
  const existingLinks = await prisma.memoryChainLink.findMany({
    where: {
      OR: [
        { sourceId: memory.id },
        { targetId: memory.id },
      ],
    },
  });
  console.log(`\nExisting links for this memory: ${existingLinks.length}`);
  
  // 6. Now let's test multiple random memories
  console.log('\n\n=== Testing 5 Random Memories ===');
  
  const randomMemories = await prisma.$queryRaw<any[]>`
    SELECT id, user_id, raw
    FROM memories
    WHERE embedding IS NOT NULL
    ORDER BY RANDOM()
    LIMIT 5
  `;
  
  for (const mem of randomMemories) {
    const similar = await prisma.$queryRaw<any[]>`
      SELECT 
        m.id,
        1 - (m.embedding <=> (SELECT embedding FROM memories WHERE id = ${mem.id})) as score
      FROM memories m
      WHERE m.user_id = ${mem.user_id}
        AND m.id != ${mem.id}
        AND m.embedding IS NOT NULL
        AND m.deleted_at IS NULL
      ORDER BY m.embedding <=> (SELECT embedding FROM memories WHERE id = ${mem.id})
      LIMIT 10
    `;
    
    const linkable = similar.filter(
      s => Number(s.score) >= RELATED_SIMILARITY_THRESHOLD && Number(s.score) < DEDUP_SIMILARITY_THRESHOLD
    );
    
    const links = await prisma.memoryChainLink.count({
      where: {
        OR: [
          { sourceId: mem.id },
          { targetId: mem.id },
        ],
      },
    });
    
    console.log(`\nMemory: ${mem.raw.substring(0, 50)}...`);
    console.log(`  Could link to: ${linkable.length} memories`);
    console.log(`  Actual links: ${links}`);
    if (linkable.length > 0 && links === 0) {
      console.log(`  ⚠️ MISSING LINKS!`);
    }
  }
  
  // 7. Summary statistics
  console.log('\n\n=== Summary ===');
  const totalLinks = await prisma.memoryChainLink.count();
  const totalMemories = await prisma.memory.count({ where: { deletedAt: null } });
  
  // Estimate expected links (rough calculation)
  console.log(`Total memories: ${totalMemories}`);
  console.log(`Total links: ${totalLinks}`);
  console.log(`Link ratio: ${(totalLinks / totalMemories).toFixed(2)} links per memory`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
