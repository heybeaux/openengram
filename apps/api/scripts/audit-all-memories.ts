/**
 * Audit ALL memories to find which ones SHOULD have links but don't
 */
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

const DEDUP_SIMILARITY_THRESHOLD = 0.90;
const RELATED_SIMILARITY_THRESHOLD = 0.65;

async function main() {
  console.log('=== Full Memory Linking Audit ===\n');
  
  // Get all memories with embeddings
  const allMemories = await prisma.memory.findMany({
    where: {
      deletedAt: null,
    },
    select: { id: true, raw: true, userId: true, embeddingId: true },
  });
  
  console.log('Total memories:', allMemories.length);
  console.log('With embeddings:', allMemories.filter(m => m.embeddingId).length);
  
  let totalPossibleLinks = 0;
  let memoriesWithPossibleLinks = 0;
  const missingLinks: Array<{
    memoryId: string;
    raw: string;
    possibleLinks: number;
    topMatch: number;
  }> = [];
  
  console.log('\nScanning for missing links...\n');
  
  for (const mem of allMemories) {
    if (!mem.embeddingId) continue;
    
    // Check for similar memories
    const similar = await prisma.$queryRaw<any[]>`
      SELECT 
        m.id,
        1 - (m.embedding <=> (SELECT embedding FROM memories WHERE id = ${mem.id})) as score
      FROM memories m
      WHERE m.user_id = ${mem.userId}
        AND m.id != ${mem.id}
        AND m.embedding IS NOT NULL
        AND m.deleted_at IS NULL
      ORDER BY m.embedding <=> (SELECT embedding FROM memories WHERE id = ${mem.id})
      LIMIT 10
    `;
    
    const shouldLink = similar.filter(
      s => Number(s.score) >= RELATED_SIMILARITY_THRESHOLD && 
           Number(s.score) < DEDUP_SIMILARITY_THRESHOLD
    );
    
    if (shouldLink.length > 0) {
      // Check how many links actually exist
      const existingLinks = await prisma.memoryChainLink.count({
        where: {
          OR: [
            { sourceId: mem.id },
            { targetId: mem.id },
          ],
        },
      });
      
      if (existingLinks < shouldLink.length) {
        memoriesWithPossibleLinks++;
        totalPossibleLinks += shouldLink.length;
        
        missingLinks.push({
          memoryId: mem.id,
          raw: mem.raw,
          possibleLinks: shouldLink.length,
          topMatch: Number(shouldLink[0].score),
        });
      }
    }
  }
  
  console.log('\n=== Results ===');
  console.log('Memories that SHOULD have links:', memoriesWithPossibleLinks);
  console.log('Total potential links missing:', totalPossibleLinks);
  
  // Sort by topMatch score (highest first)
  missingLinks.sort((a, b) => b.topMatch - a.topMatch);
  
  console.log('\n--- Top 15 memories with missing links ---');
  for (const item of missingLinks.slice(0, 15)) {
    console.log(`\n  Score: ${item.topMatch.toFixed(3)} | Links: ${item.possibleLinks}`);
    console.log(`  ${item.raw.substring(0, 70)}...`);
  }
  
  // Show similarity distribution
  console.log('\n\n=== Similarity Distribution (all memory pairs) ===');
  
  // Sample some memories to get score distribution
  const sampleSize = 50;
  const sampleMemories = allMemories
    .filter(m => m.embeddingId)
    .slice(0, sampleSize);
  
  const allScores: number[] = [];
  
  for (const mem of sampleMemories) {
    const similar = await prisma.$queryRaw<any[]>`
      SELECT 
        1 - (m.embedding <=> (SELECT embedding FROM memories WHERE id = ${mem.id})) as score
      FROM memories m
      WHERE m.user_id = ${mem.userId}
        AND m.id != ${mem.id}
        AND m.embedding IS NOT NULL
        AND m.deleted_at IS NULL
      ORDER BY m.embedding <=> (SELECT embedding FROM memories WHERE id = ${mem.id})
      LIMIT 5
    `;
    
    for (const s of similar) {
      allScores.push(Number(s.score));
    }
  }
  
  allScores.sort((a, b) => b - a);
  
  console.log(`Sampled ${allScores.length} similarity scores`);
  console.log(`Scores >= 0.90 (duplicates): ${allScores.filter(s => s >= 0.90).length}`);
  console.log(`Scores 0.65-0.90 (related): ${allScores.filter(s => s >= 0.65 && s < 0.90).length}`);
  console.log(`Scores 0.50-0.65: ${allScores.filter(s => s >= 0.50 && s < 0.65).length}`);
  console.log(`Scores < 0.50: ${allScores.filter(s => s < 0.50).length}`);
  
  console.log('\nTop 10 similarity scores:');
  for (const score of allScores.slice(0, 10)) {
    console.log(`  ${score.toFixed(4)}`);
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
