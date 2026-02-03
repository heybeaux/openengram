/**
 * Test script to trace the exact linking flow
 * Simulates what linkRelatedMemories() does
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const DEDUP_SIMILARITY_THRESHOLD = 0.90;
const RELATED_SIMILARITY_THRESHOLD = 0.65;

async function main() {
  console.log('=== Tracing linkRelatedMemories Flow ===\n');
  
  // 1. Get a memory that has related memories
  const testMemory = await prisma.$queryRaw<any[]>`
    SELECT id, user_id, raw
    FROM memories
    WHERE raw LIKE '%Never deploy on Fridays%'
    AND embedding IS NOT NULL
    LIMIT 1
  `;
  
  if (testMemory.length === 0) {
    console.log('Test memory not found');
    return;
  }
  
  const memory = testMemory[0];
  console.log('Test Memory:');
  console.log(`  ID: ${memory.id}`);
  console.log(`  Raw: ${memory.raw}`);
  console.log(`  User: ${memory.user_id}`);
  
  // 2. Check if embedding exists (without selecting the actual vector)
  const embeddingCheck = await prisma.$queryRaw<any[]>`
    SELECT 
      id,
      CASE WHEN embedding IS NOT NULL THEN true ELSE false END as has_embedding
    FROM memories 
    WHERE id = ${memory.id}
  `;
  
  console.log(`\nEmbedding exists: ${embeddingCheck[0]?.has_embedding ? 'YES' : 'NO'}`);
  
  // 3. Simulate EmbeddingService.search()
  console.log('\n--- Simulating EmbeddingService.search() ---');
  
  const searchResults = await prisma.$queryRaw<any[]>`
    SELECT 
      id,
      1 - (embedding <=> (SELECT embedding FROM memories WHERE id = ${memory.id})) as score
    FROM memories
    WHERE user_id = ${memory.user_id}
      AND embedding IS NOT NULL
      AND deleted_at IS NULL
    ORDER BY embedding <=> (SELECT embedding FROM memories WHERE id = ${memory.id})
    LIMIT 10
  `;
  
  console.log(`Search returned ${searchResults.length} results`);
  
  // 4. Apply the linkRelatedMemories filter
  console.log('\n--- Applying linkRelatedMemories filter ---');
  console.log(`Filter: m.id !== memoryId && m.score >= ${RELATED_SIMILARITY_THRESHOLD} && m.score < ${DEDUP_SIMILARITY_THRESHOLD}`);
  
  const filtered = searchResults.filter(
    m => m.id !== memory.id && 
         Number(m.score) >= RELATED_SIMILARITY_THRESHOLD && 
         Number(m.score) < DEDUP_SIMILARITY_THRESHOLD
  );
  
  console.log(`After filter: ${filtered.length} candidates for linking`);
  
  // 5. Show all results with their status
  console.log('\n--- All Search Results ---');
  for (const r of searchResults) {
    const score = Number(r.score);
    let status = '✗ LOW';
    if (r.id === memory.id) {
      status = '⊙ SELF';
    } else if (score >= DEDUP_SIMILARITY_THRESHOLD) {
      status = '⚠ DUP';
    } else if (score >= RELATED_SIMILARITY_THRESHOLD) {
      status = '✓ LINK';
    }
    
    // Get the raw text for this memory
    const mem = await prisma.memory.findUnique({ where: { id: r.id }, select: { raw: true } });
    console.log(`  [${status}] ${score.toFixed(4)} | ${mem?.raw.substring(0, 50) || 'N/A'}...`);
  }
  
  // 6. Check for memories with similar content
  const relatedByContent = await prisma.$queryRaw<any[]>`
    SELECT id, raw
    FROM memories
    WHERE user_id = ${memory.user_id}
      AND raw LIKE '%Friday%'
      AND id != ${memory.id}
      AND embedding IS NOT NULL
  `;
  
  console.log('\n--- Memories also mentioning "Friday" ---');
  for (const r of relatedByContent) {
    const score = await prisma.$queryRaw<any[]>`
      SELECT 1 - (
        (SELECT embedding FROM memories WHERE id = ${r.id}) <=> 
        (SELECT embedding FROM memories WHERE id = ${memory.id})
      ) as score
    `;
    console.log(`  Score: ${Number(score[0]?.score || 0).toFixed(4)} | ${r.raw.substring(0, 60)}`);
  }
  
  // 7. Check the existing single link
  console.log('\n\n=== Analyzing the ONE existing link ===');
  const existingLink = await prisma.memoryChainLink.findFirst({
    include: {
      source: { select: { id: true, raw: true, userId: true } },
      target: { select: { id: true, raw: true, userId: true } },
    },
  });
  
  if (existingLink) {
    console.log('Source memory:', existingLink.source.raw);
    console.log('Target memory:', existingLink.target.raw);
    console.log('Confidence:', existingLink.confidence);
    console.log('Created by:', existingLink.createdBy);
    console.log('Created at:', existingLink.createdAt);
    
    // Calculate current similarity
    const similarity = await prisma.$queryRaw<any[]>`
      SELECT 1 - (
        (SELECT embedding FROM memories WHERE id = ${existingLink.sourceId}) <=> 
        (SELECT embedding FROM memories WHERE id = ${existingLink.targetId})
      ) as score
    `;
    console.log('Current similarity:', Number(similarity[0]?.score || 0).toFixed(4));
  }
  
  // 8. Now let's investigate WHEN that one link was created
  // vs when most memories were created
  console.log('\n\n=== Timeline Analysis ===');
  
  const linkCreatedAt = existingLink?.createdAt;
  const memoriesBeforeLink = await prisma.memory.count({
    where: {
      createdAt: { lt: linkCreatedAt },
    },
  });
  const memoriesAfterLink = await prisma.memory.count({
    where: {
      createdAt: { gte: linkCreatedAt },
    },
  });
  
  console.log(`Link created at: ${linkCreatedAt}`);
  console.log(`Memories created before link: ${memoriesBeforeLink}`);
  console.log(`Memories created after link: ${memoriesAfterLink}`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
