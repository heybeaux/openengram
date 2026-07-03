/**
 * Engram Memory System - Baseline Evaluation
 * 
 * Captures the current state of the memory system for before/after comparison.
 * Run with: npx ts-node tests/evaluation/baseline.ts
 */

import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';
import { score5W1H, scoreEntityExtraction, scoreLinkDensity, MemorySample } from './scorer';

const prisma = new PrismaClient();

interface BaselineResult {
  timestamp: string;
  runLabel: string;
  metrics: {
    // Core counts
    totalMemories: number;
    totalExtractions: number;
    extractionsWithData: number;
    totalEntities: number;
    totalLinks: number;
    
    // Quality scores (0-1)
    fiveW1HCompletionRate: number;
    avgEntitiesPerMemory: number;
    avgLinksPerMemory: number;
    
    // Breakdown
    fiveW1HBreakdown: {
      who: number;
      what: number;
      when: number;
      where: number;
      why: number;
      how: number;
    };
    
    // Sample analysis
    sampleSize: number;
    sampleScores: Array<{
      memoryId: string;
      raw: string;
      fiveW1HScore: number;
      entityScore: number;
      hasExtraction: boolean;
      extractionData?: {
        who: string | null;
        what: string | null;
        when: string | null;
        where: string | null;
        why: string | null;
        how: string | null;
        topics: string[];
      };
      linkedEntities: string[];
    }>;
    
    // Distribution stats
    memoryLayerDistribution: Record<string, number>;
    memorySourceDistribution: Record<string, number>;
    entityTypeDistribution: Record<string, number>;
    linkTypeDistribution: Record<string, number>;
  };
}

async function captureBaseline(label?: string): Promise<BaselineResult> {
  console.log('📊 Starting baseline capture...\n');
  
  // 1. Core counts
  const totalMemories = await prisma.memory.count({
    where: { deletedAt: null }
  });
  
  const totalExtractions = await prisma.memoryExtraction.count();
  
  const extractionsWithData = await prisma.memoryExtraction.count({
    where: {
      OR: [
        { who: { not: null } },
        { what: { not: null } },
        { when: { not: null } },
        { whereCtx: { not: null } },
        { why: { not: null } },
        { how: { not: null } },
      ]
    }
  });
  
  const totalEntities = await prisma.entity.count();
  const totalLinks = await prisma.memoryChainLink.count();
  
  console.log(`  Total memories: ${totalMemories}`);
  console.log(`  Total extractions: ${totalExtractions}`);
  console.log(`  Extractions with data: ${extractionsWithData}`);
  console.log(`  Total entities: ${totalEntities}`);
  console.log(`  Total links: ${totalLinks}`);
  
  // 2. 5W1H breakdown
  const whoCount = await prisma.memoryExtraction.count({ where: { who: { not: null } } });
  const whatCount = await prisma.memoryExtraction.count({ where: { what: { not: null } } });
  const whenCount = await prisma.memoryExtraction.count({ where: { when: { not: null } } });
  const whereCount = await prisma.memoryExtraction.count({ where: { whereCtx: { not: null } } });
  const whyCount = await prisma.memoryExtraction.count({ where: { why: { not: null } } });
  const howCount = await prisma.memoryExtraction.count({ where: { how: { not: null } } });
  
  const fiveW1HBreakdown = {
    who: totalExtractions > 0 ? whoCount / totalExtractions : 0,
    what: totalExtractions > 0 ? whatCount / totalExtractions : 0,
    when: totalExtractions > 0 ? whenCount / totalExtractions : 0,
    where: totalExtractions > 0 ? whereCount / totalExtractions : 0,
    why: totalExtractions > 0 ? whyCount / totalExtractions : 0,
    how: totalExtractions > 0 ? howCount / totalExtractions : 0,
  };
  
  console.log('\n  5W1H Completion:');
  console.log(`    who:   ${(fiveW1HBreakdown.who * 100).toFixed(1)}%`);
  console.log(`    what:  ${(fiveW1HBreakdown.what * 100).toFixed(1)}%`);
  console.log(`    when:  ${(fiveW1HBreakdown.when * 100).toFixed(1)}%`);
  console.log(`    where: ${(fiveW1HBreakdown.where * 100).toFixed(1)}%`);
  console.log(`    why:   ${(fiveW1HBreakdown.why * 100).toFixed(1)}%`);
  console.log(`    how:   ${(fiveW1HBreakdown.how * 100).toFixed(1)}%`);
  
  // 3. Sample 20 random memories for detailed analysis
  const sampleSize = Math.min(20, totalMemories);
  const allMemories = await prisma.memory.findMany({
    where: { deletedAt: null },
    include: {
      extraction: true,
      entities: {
        include: { entity: true }
      },
      chainSources: true,
      chainTargets: true,
    },
    take: 100, // Get 100 and randomly sample
  });
  
  // Shuffle and take sample
  const shuffled = allMemories.sort(() => Math.random() - 0.5);
  const sampledMemories = shuffled.slice(0, sampleSize);
  
  console.log(`\n  Sampling ${sampleSize} memories for detailed analysis...`);
  
  const sampleScores: BaselineResult['metrics']['sampleScores'] = [];
  
  for (const memory of sampledMemories) {
    const memorySample: MemorySample = {
      id: memory.id,
      raw: memory.raw,
      extraction: memory.extraction ? {
        who: memory.extraction.who,
        what: memory.extraction.what,
        when: memory.extraction.when?.toISOString() ?? null,
        where: memory.extraction.whereCtx,
        why: memory.extraction.why,
        how: memory.extraction.how,
        topics: memory.extraction.topics,
      } : null,
      entities: memory.entities.map(me => ({
        name: me.entity.name,
        type: me.entity.type,
      })),
      linkCount: memory.chainSources.length + memory.chainTargets.length,
    };
    
    const fiveW1HScore = score5W1H(memorySample);
    const entityScore = scoreEntityExtraction(memorySample);
    
    sampleScores.push({
      memoryId: memory.id,
      raw: memory.raw.length > 200 ? memory.raw.substring(0, 200) + '...' : memory.raw,
      fiveW1HScore,
      entityScore,
      hasExtraction: !!memory.extraction,
      extractionData: memory.extraction ? {
        who: memory.extraction.who,
        what: memory.extraction.what,
        when: memory.extraction.when?.toISOString() ?? null,
        where: memory.extraction.whereCtx,
        why: memory.extraction.why,
        how: memory.extraction.how,
        topics: memory.extraction.topics,
      } : undefined,
      linkedEntities: memory.entities.map(me => me.entity.name),
    });
  }
  
  // 4. Distribution stats
  const memoryLayerDist = await prisma.memory.groupBy({
    by: ['layer'],
    _count: true,
    where: { deletedAt: null },
  });
  
  const memorySourceDist = await prisma.memory.groupBy({
    by: ['source'],
    _count: true,
    where: { deletedAt: null },
  });
  
  const entityTypeDist = await prisma.entity.groupBy({
    by: ['type'],
    _count: true,
  });
  
  const linkTypeDist = await prisma.memoryChainLink.groupBy({
    by: ['linkType'],
    _count: true,
  });
  
  const memoryLayerDistribution: Record<string, number> = {};
  memoryLayerDist.forEach(d => { memoryLayerDistribution[d.layer] = d._count; });
  
  const memorySourceDistribution: Record<string, number> = {};
  memorySourceDist.forEach(d => { memorySourceDistribution[d.source] = d._count; });
  
  const entityTypeDistribution: Record<string, number> = {};
  entityTypeDist.forEach(d => { entityTypeDistribution[d.type] = d._count; });
  
  const linkTypeDistribution: Record<string, number> = {};
  linkTypeDist.forEach(d => { linkTypeDistribution[d.linkType] = d._count; });
  
  // 5. Calculate aggregate scores
  const avgSample5W1H = sampleScores.length > 0
    ? sampleScores.reduce((sum, s) => sum + s.fiveW1HScore, 0) / sampleScores.length
    : 0;
  
  const fiveW1HCompletionRate = Object.values(fiveW1HBreakdown).reduce((a, b) => a + b, 0) / 6;
  const avgEntitiesPerMemory = totalMemories > 0 ? totalEntities / totalMemories : 0;
  const avgLinksPerMemory = totalMemories > 0 ? totalLinks / totalMemories : 0;
  
  const result: BaselineResult = {
    timestamp: new Date().toISOString(),
    runLabel: label || `baseline-${Date.now()}`,
    metrics: {
      totalMemories,
      totalExtractions,
      extractionsWithData,
      totalEntities,
      totalLinks,
      fiveW1HCompletionRate,
      avgEntitiesPerMemory,
      avgLinksPerMemory,
      fiveW1HBreakdown,
      sampleSize,
      sampleScores,
      memoryLayerDistribution,
      memorySourceDistribution,
      entityTypeDistribution,
      linkTypeDistribution,
    },
  };
  
  console.log('\n📈 Summary:');
  console.log(`  5W1H Completion Rate: ${(fiveW1HCompletionRate * 100).toFixed(1)}%`);
  console.log(`  Avg Entities/Memory: ${avgEntitiesPerMemory.toFixed(2)}`);
  console.log(`  Avg Links/Memory: ${avgLinksPerMemory.toFixed(2)}`);
  console.log(`  Sample Avg 5W1H Score: ${avgSample5W1H.toFixed(2)}/6`);
  
  return result;
}

async function saveResult(result: BaselineResult): Promise<string> {
  const resultsDir = path.join(__dirname, 'results');
  if (!fs.existsSync(resultsDir)) {
    fs.mkdirSync(resultsDir, { recursive: true });
  }
  
  const filename = `baseline-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  const filepath = path.join(resultsDir, filename);
  
  fs.writeFileSync(filepath, JSON.stringify(result, null, 2));
  console.log(`\n💾 Results saved to: ${filepath}`);
  
  return filepath;
}

async function main() {
  try {
    const label = process.argv[2] || undefined;
    const result = await captureBaseline(label);
    await saveResult(result);
    console.log('\n✅ Baseline capture complete!');
  } catch (error) {
    console.error('❌ Baseline capture failed:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
