/**
 * Backfill script for effectiveScore + safetyCritical
 *
 * Usage:
 *   npx ts-node scripts/backfill-effective-scores.ts [--dry-run]
 */

import { PrismaClient } from '@prisma/client';
import {
  ImportanceScorerService,
  SafetyDetectorService,
} from '../src/memory/intelligence';

const prisma = new PrismaClient();
const scorer = new ImportanceScorerService();
const safetyDetector = new SafetyDetectorService();

const BATCH_SIZE = 100;
const DRY_RUN = process.argv.includes('--dry-run');

interface BackfillStats {
  total: number;
  processed: number;
  safetyCritical: number;
  errors: number;
  scoreDistribution: {
    low: number; // 0-0.3
    medium: number; // 0.3-0.6
    high: number; // 0.6-1.0
  };
}

async function backfill() {
  console.log(`\n🚀 Starting effectiveScore backfill${DRY_RUN ? ' (DRY RUN)' : ''}\n`);

  const stats: BackfillStats = {
    total: 0,
    processed: 0,
    safetyCritical: 0,
    errors: 0,
    scoreDistribution: { low: 0, medium: 0, high: 0 },
  };

  // Get total count
  stats.total = await prisma.memory.count({
    where: { deletedAt: null },
  });
  console.log(`📊 Total memories to process: ${stats.total}\n`);

  let cursor: string | undefined;
  const now = new Date();

  while (true) {
    // Fetch batch
    const memories = await prisma.memory.findMany({
      where: { deletedAt: null },
      take: BATCH_SIZE,
      cursor: cursor ? { id: cursor } : undefined,
      skip: cursor ? 1 : 0,
      orderBy: { id: 'asc' },
    });

    if (memories.length === 0) break;

    // Process batch
    for (const memory of memories) {
      try {
        // 1. Detect safety-critical
        const safetyResult = safetyDetector.detectSafetyCritical(memory.raw);

        // 2. Compute effective score
        const memoryWithSafety = {
          ...memory,
          safetyCritical: safetyResult.isSafety,
        };
        const scoreResult = scorer.computeScore(memoryWithSafety, now);

        // Track stats
        stats.processed++;
        if (safetyResult.isSafety) {
          stats.safetyCritical++;
          if (!DRY_RUN) {
            console.log(
              `  🏥 Safety-critical: "${memory.raw.slice(0, 50)}..." → [${safetyResult.indicators.join(', ')}]`
            );
          }
        }

        // Score distribution
        if (scoreResult.effectiveScore < 0.3) {
          stats.scoreDistribution.low++;
        } else if (scoreResult.effectiveScore < 0.6) {
          stats.scoreDistribution.medium++;
        } else {
          stats.scoreDistribution.high++;
        }

        // Update database (unless dry run)
        if (!DRY_RUN) {
          await prisma.memory.update({
            where: { id: memory.id },
            data: {
              effectiveScore: scoreResult.effectiveScore,
              scoreComputedAt: now,
              safetyCritical: safetyResult.isSafety,
            },
          });
        }
      } catch (err) {
        stats.errors++;
        console.error(`  ❌ Error processing memory ${memory.id}:`, err);
      }
    }

    // Progress
    const pct = ((stats.processed / stats.total) * 100).toFixed(1);
    process.stdout.write(`\r  Progress: ${stats.processed}/${stats.total} (${pct}%)`);

    cursor = memories[memories.length - 1].id;
  }

  console.log('\n\n✅ Backfill complete!\n');
  console.log('📈 Stats:');
  console.log(`   Total processed: ${stats.processed}`);
  console.log(`   Safety-critical: ${stats.safetyCritical}`);
  console.log(`   Errors: ${stats.errors}`);
  console.log('\n📊 Score distribution:');
  console.log(`   Low (0-0.3):    ${stats.scoreDistribution.low}`);
  console.log(`   Medium (0.3-0.6): ${stats.scoreDistribution.medium}`);
  console.log(`   High (0.6-1.0):   ${stats.scoreDistribution.high}`);

  if (DRY_RUN) {
    console.log('\n⚠️  DRY RUN - no changes were made to the database');
  }
}

backfill()
  .catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
