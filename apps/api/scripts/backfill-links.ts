/**
 * Backfill memory chain links for all existing memories
 * 
 * This script processes all memories that have embeddings and creates
 * RELATED links between semantically similar memories (0.65-0.90 similarity).
 * 
 * Usage:
 *   npx tsx scripts/backfill-links.ts
 *   npx tsx scripts/backfill-links.ts --dry-run
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const DEDUP_SIMILARITY_THRESHOLD = 0.90;
const RELATED_SIMILARITY_THRESHOLD = 0.65;

interface Stats {
  memoriesProcessed: number;
  linksCreated: number;
  linksSkipped: number;
  errors: number;
}

async function backfillLinks(dryRun: boolean = false): Promise<Stats> {
  const stats: Stats = {
    memoriesProcessed: 0,
    linksCreated: 0,
    linksSkipped: 0,
    errors: 0,
  };

  console.log('=== Memory Link Backfill ===');
  console.log(`Mode: ${dryRun ? 'DRY RUN' : 'LIVE'}`);
  console.log(`Similarity threshold: ${RELATED_SIMILARITY_THRESHOLD} - ${DEDUP_SIMILARITY_THRESHOLD}\n`);

  // Get all memories with embeddings
  const memories = await prisma.memory.findMany({
    where: {
      deletedAt: null,
    },
    select: { id: true, userId: true, embeddingId: true },
  });

  const memoriesWithEmbeddings = memories.filter(m => m.embeddingId);
  console.log(`Total memories: ${memories.length}`);
  console.log(`With embeddings: ${memoriesWithEmbeddings.length}`);
  console.log('');

  for (const mem of memoriesWithEmbeddings) {
    try {
      // Search for similar memories
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

      // Filter to related but not duplicates
      const related = similar.filter(
        m => Number(m.score) >= RELATED_SIMILARITY_THRESHOLD && 
             Number(m.score) < DEDUP_SIMILARITY_THRESHOLD
      );

      for (const match of related) {
        // Check if link already exists (in either direction)
        const existingLink = await prisma.memoryChainLink.findFirst({
          where: {
            OR: [
              { sourceId: mem.id, targetId: match.id, linkType: 'RELATED' },
              { sourceId: match.id, targetId: mem.id, linkType: 'RELATED' },
            ],
          },
        });

        if (existingLink) {
          stats.linksSkipped++;
          continue;
        }

        if (!dryRun) {
          try {
            await prisma.memoryChainLink.create({
              data: {
                sourceId: mem.id,
                targetId: match.id,
                linkType: 'RELATED',
                confidence: Number(match.score),
                createdBy: 'backfill',
              },
            });
            stats.linksCreated++;
          } catch (error: any) {
            // Handle unique constraint violation (race condition)
            if (error.code === 'P2002') {
              stats.linksSkipped++;
            } else {
              throw error;
            }
          }
        } else {
          console.log(`  Would link: ${mem.id} -> ${match.id} (score: ${Number(match.score).toFixed(3)})`);
          stats.linksCreated++;
        }
      }

      stats.memoriesProcessed++;

      // Progress indicator
      if (stats.memoriesProcessed % 50 === 0) {
        console.log(`Processed ${stats.memoriesProcessed}/${memoriesWithEmbeddings.length} memories...`);
      }
    } catch (error: any) {
      console.error(`Error processing memory ${mem.id}:`, error.message);
      stats.errors++;
    }
  }

  return stats;
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  
  const startTime = Date.now();
  const stats = await backfillLinks(dryRun);
  const duration = ((Date.now() - startTime) / 1000).toFixed(2);

  console.log('\n=== Results ===');
  console.log(`Memories processed: ${stats.memoriesProcessed}`);
  console.log(`Links created: ${stats.linksCreated}`);
  console.log(`Links skipped (existing): ${stats.linksSkipped}`);
  console.log(`Errors: ${stats.errors}`);
  console.log(`Duration: ${duration}s`);

  // Verify final count
  const totalLinks = await prisma.memoryChainLink.count();
  console.log(`\nTotal links in database: ${totalLinks}`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
