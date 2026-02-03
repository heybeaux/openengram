/**
 * Check if the 4 recent memories SHOULD have links
 */
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

const DEDUP_SIMILARITY_THRESHOLD = 0.90;
const RELATED_SIMILARITY_THRESHOLD = 0.65;

async function main() {
  const linkTime = new Date('2026-02-03T06:56:45.198Z');
  
  const recentMemories = await prisma.memory.findMany({
    where: {
      createdAt: { gte: linkTime },
    },
    orderBy: { createdAt: 'asc' },
    select: { id: true, raw: true, userId: true },
  });
  
  console.log('Checking if recent memories SHOULD have links...\n');
  
  for (const mem of recentMemories) {
    console.log('Memory:', mem.raw.substring(0, 60));
    
    // Search for similar memories
    const similar = await prisma.$queryRaw<any[]>`
      SELECT 
        m.id,
        m.raw,
        1 - (m.embedding <=> (SELECT embedding FROM memories WHERE id = ${mem.id})) as score
      FROM memories m
      WHERE m.user_id = ${mem.userId}
        AND m.id != ${mem.id}
        AND m.embedding IS NOT NULL
        AND m.deleted_at IS NULL
      ORDER BY m.embedding <=> (SELECT embedding FROM memories WHERE id = ${mem.id})
      LIMIT 5
    `;
    
    const shouldLink = similar.filter(
      s => Number(s.score) >= RELATED_SIMILARITY_THRESHOLD && 
           Number(s.score) < DEDUP_SIMILARITY_THRESHOLD
    );
    
    console.log('  Similar memories found:', similar.length);
    console.log('  Should link to:', shouldLink.length);
    
    if (similar.length > 0) {
      console.log('  Top matches:');
      for (const s of similar.slice(0, 3)) {
        const status = Number(s.score) >= RELATED_SIMILARITY_THRESHOLD ? '✓' : '✗';
        console.log(`    ${status} ${Number(s.score).toFixed(3)} - ${s.raw.substring(0, 50)}...`);
      }
    }
    console.log('');
  }
  
  // Now let's test manually calling linkRelatedMemories logic
  console.log('\n=== Manually testing link creation ===');
  
  // Pick the first recent memory
  const testMem = recentMemories[0];
  console.log('Testing with:', testMem.raw.substring(0, 60));
  
  // Get embedding
  const similar = await prisma.$queryRaw<any[]>`
    SELECT 
      id,
      1 - (embedding <=> (SELECT embedding FROM memories WHERE id = ${testMem.id})) as score
    FROM memories
    WHERE user_id = ${testMem.userId}
      AND embedding IS NOT NULL
      AND deleted_at IS NULL
    ORDER BY embedding <=> (SELECT embedding FROM memories WHERE id = ${testMem.id})
    LIMIT 10
  `;
  
  const related = similar.filter(
    m => m.id !== testMem.id && 
         Number(m.score) >= RELATED_SIMILARITY_THRESHOLD && 
         Number(m.score) < DEDUP_SIMILARITY_THRESHOLD
  );
  
  console.log('\nWould create', related.length, 'links');
  
  if (related.length > 0) {
    console.log('\nCreating test links...');
    for (const match of related) {
      try {
        await prisma.memoryChainLink.upsert({
          where: {
            sourceId_targetId_linkType: {
              sourceId: testMem.id,
              targetId: match.id,
              linkType: 'RELATED',
            },
          },
          create: {
            sourceId: testMem.id,
            targetId: match.id,
            linkType: 'RELATED',
            confidence: Number(match.score),
            createdBy: 'manual-test',
          },
          update: {
            confidence: Number(match.score),
          },
        });
        console.log('  Created link to:', match.id);
      } catch (error: any) {
        console.log('  Failed:', error.message);
      }
    }
    
    // Verify
    const newLinkCount = await prisma.memoryChainLink.count();
    console.log('\nTotal links now:', newLinkCount);
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
