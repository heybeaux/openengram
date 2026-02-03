/**
 * Engram Memory System - Test Scenarios
 * 
 * Defines test scenarios for evaluating memory system capabilities.
 * Run with: npx ts-node tests/evaluation/scenarios.ts
 */

import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';
import { ScenarioResult, scoreQueryRelevance } from './scorer';

const prisma = new PrismaClient();

interface ScenarioConfig {
  name: string;
  category: 'entity_query' | 'temporal_query' | 'semantic_search' | 'deduplication' | 'extraction_quality';
  description: string;
  run: () => Promise<ScenarioResult>;
}

interface ScenarioRunResult {
  timestamp: string;
  totalScenarios: number;
  passed: number;
  failed: number;
  passRate: number;
  totalScore: number;
  maxScore: number;
  overallScorePercent: number;
  scenarios: ScenarioResult[];
}

// ============================================================================
// Test Scenarios
// ============================================================================

const scenarios: ScenarioConfig[] = [
  // ENTITY QUERIES
  {
    name: 'Entity Query: Find memories about known entities',
    category: 'entity_query',
    description: 'Query for memories mentioning specific named entities',
    run: async (): Promise<ScenarioResult> => {
      const start = Date.now();
      
      // Get a sample entity from the database
      const sampleEntity = await prisma.entity.findFirst({
        include: {
          memories: {
            include: { memory: true },
            take: 5,
          },
        },
      });
      
      if (!sampleEntity) {
        return {
          name: 'Entity Query: Find memories about known entities',
          passed: false,
          score: 0,
          maxScore: 1,
          details: 'No entities found in database to test',
          duration: Date.now() - start,
        };
      }
      
      // Check if entity has linked memories
      const hasLinkedMemories = sampleEntity.memories.length > 0;
      
      return {
        name: 'Entity Query: Find memories about known entities',
        passed: hasLinkedMemories,
        score: hasLinkedMemories ? 1 : 0,
        maxScore: 1,
        details: `Entity "${sampleEntity.name}" (${sampleEntity.type}) has ${sampleEntity.memories.length} linked memories`,
        duration: Date.now() - start,
      };
    },
  },
  
  {
    name: 'Entity Query: Entity type distribution',
    category: 'entity_query',
    description: 'Verify entities have proper type classification',
    run: async (): Promise<ScenarioResult> => {
      const start = Date.now();
      
      const typeCounts = await prisma.entity.groupBy({
        by: ['type'],
        _count: true,
      });
      
      const hasMultipleTypes = typeCounts.length > 1;
      const hasPersonType = typeCounts.some(t => t.type === 'person');
      
      const score = (hasMultipleTypes ? 0.5 : 0) + (hasPersonType ? 0.5 : 0);
      
      return {
        name: 'Entity Query: Entity type distribution',
        passed: hasMultipleTypes && hasPersonType,
        score,
        maxScore: 1,
        details: `Types found: ${typeCounts.map(t => `${t.type}(${t._count})`).join(', ')}`,
        duration: Date.now() - start,
      };
    },
  },
  
  // TEMPORAL QUERIES
  {
    name: 'Temporal Query: Memories have extraction timestamps',
    category: 'temporal_query',
    description: 'Check if extractions have "when" field populated',
    run: async (): Promise<ScenarioResult> => {
      const start = Date.now();
      
      const totalExtractions = await prisma.memoryExtraction.count();
      const withWhen = await prisma.memoryExtraction.count({
        where: { when: { not: null } },
      });
      
      const rate = totalExtractions > 0 ? withWhen / totalExtractions : 0;
      const passed = rate >= 0.1; // At least 10% should have temporal data
      
      return {
        name: 'Temporal Query: Memories have extraction timestamps',
        passed,
        score: rate,
        maxScore: 1,
        details: `${withWhen}/${totalExtractions} extractions have "when" field (${(rate * 100).toFixed(1)}%)`,
        duration: Date.now() - start,
      };
    },
  },
  
  {
    name: 'Temporal Query: Memory creation dates are valid',
    category: 'temporal_query',
    description: 'Verify all memories have valid creation timestamps',
    run: async (): Promise<ScenarioResult> => {
      const start = Date.now();
      
      const recentMemories = await prisma.memory.findMany({
        where: { deletedAt: null },
        select: { id: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take: 10,
      });
      
      const allValid = recentMemories.every(m => {
        const date = new Date(m.createdAt);
        return !isNaN(date.getTime()) && date.getTime() > 0;
      });
      
      return {
        name: 'Temporal Query: Memory creation dates are valid',
        passed: allValid,
        score: allValid ? 1 : 0,
        maxScore: 1,
        details: `Checked ${recentMemories.length} recent memories, all have valid timestamps: ${allValid}`,
        duration: Date.now() - start,
      };
    },
  },
  
  // SEMANTIC SEARCH
  {
    name: 'Semantic Search: Memories have embeddings',
    category: 'semantic_search',
    description: 'Check if memories have vector embeddings stored',
    run: async (): Promise<ScenarioResult> => {
      const start = Date.now();
      
      const totalMemories = await prisma.memory.count({ where: { deletedAt: null } });
      const withEmbedding = await prisma.memory.count({
        where: {
          deletedAt: null,
          embeddingId: { not: null },
        },
      });
      
      const rate = totalMemories > 0 ? withEmbedding / totalMemories : 0;
      const passed = rate >= 0.5; // At least 50% should have embeddings
      
      return {
        name: 'Semantic Search: Memories have embeddings',
        passed,
        score: rate,
        maxScore: 1,
        details: `${withEmbedding}/${totalMemories} memories have embeddings (${(rate * 100).toFixed(1)}%)`,
        duration: Date.now() - start,
      };
    },
  },
  
  {
    name: 'Semantic Search: Embedding model recorded',
    category: 'semantic_search',
    description: 'Verify embedding model is recorded for provenance',
    run: async (): Promise<ScenarioResult> => {
      const start = Date.now();
      
      const withModel = await prisma.memory.count({
        where: {
          deletedAt: null,
          embeddingModel: { not: null },
        },
      });
      
      const withEmbedding = await prisma.memory.count({
        where: {
          deletedAt: null,
          embeddingId: { not: null },
        },
      });
      
      const rate = withEmbedding > 0 ? withModel / withEmbedding : 0;
      const passed = rate >= 0.8;
      
      return {
        name: 'Semantic Search: Embedding model recorded',
        passed,
        score: rate,
        maxScore: 1,
        details: `${withModel}/${withEmbedding} embedded memories have model recorded (${(rate * 100).toFixed(1)}%)`,
        duration: Date.now() - start,
      };
    },
  },
  
  // EXTRACTION QUALITY
  {
    name: 'Extraction Quality: What field populated',
    category: 'extraction_quality',
    description: 'The "what" field should always be extracted',
    run: async (): Promise<ScenarioResult> => {
      const start = Date.now();
      
      const totalExtractions = await prisma.memoryExtraction.count();
      const withWhat = await prisma.memoryExtraction.count({
        where: { what: { not: null } },
      });
      
      const rate = totalExtractions > 0 ? withWhat / totalExtractions : 0;
      const passed = rate >= 0.9; // 90% should have "what"
      
      return {
        name: 'Extraction Quality: What field populated',
        passed,
        score: rate,
        maxScore: 1,
        details: `${withWhat}/${totalExtractions} extractions have "what" field (${(rate * 100).toFixed(1)}%)`,
        duration: Date.now() - start,
      };
    },
  },
  
  {
    name: 'Extraction Quality: Topics extracted',
    category: 'extraction_quality',
    description: 'Check if topics are being extracted from memories',
    run: async (): Promise<ScenarioResult> => {
      const start = Date.now();
      
      const extractions = await prisma.memoryExtraction.findMany({
        select: { topics: true },
        take: 100,
      });
      
      const withTopics = extractions.filter(e => e.topics && e.topics.length > 0).length;
      const rate = extractions.length > 0 ? withTopics / extractions.length : 0;
      const passed = rate >= 0.3; // At least 30% should have topics
      
      return {
        name: 'Extraction Quality: Topics extracted',
        passed,
        score: rate,
        maxScore: 1,
        details: `${withTopics}/${extractions.length} extractions have topics (${(rate * 100).toFixed(1)}%)`,
        duration: Date.now() - start,
      };
    },
  },
  
  // DEDUPLICATION
  {
    name: 'Deduplication: Superseded memories tracked',
    category: 'deduplication',
    description: 'Check if superseded (duplicate/updated) memories are linked',
    run: async (): Promise<ScenarioResult> => {
      const start = Date.now();
      
      const supersededCount = await prisma.memory.count({
        where: {
          supersededById: { not: null },
        },
      });
      
      const totalMemories = await prisma.memory.count({ where: { deletedAt: null } });
      
      // Having some superseded memories is actually good (shows dedup works)
      const hasSupersededMemories = supersededCount > 0;
      
      return {
        name: 'Deduplication: Superseded memories tracked',
        passed: hasSupersededMemories || totalMemories < 50, // Pass if few memories or has superseded
        score: hasSupersededMemories ? 1 : 0.5,
        maxScore: 1,
        details: `${supersededCount} memories have been superseded out of ${totalMemories} total`,
        duration: Date.now() - start,
      };
    },
  },
  
  {
    name: 'Deduplication: UPDATES links exist',
    category: 'deduplication',
    description: 'Check for UPDATES link type indicating memory corrections',
    run: async (): Promise<ScenarioResult> => {
      const start = Date.now();
      
      const updatesLinks = await prisma.memoryChainLink.count({
        where: { linkType: 'UPDATES' },
      });
      
      const totalLinks = await prisma.memoryChainLink.count();
      
      return {
        name: 'Deduplication: UPDATES links exist',
        passed: updatesLinks > 0 || totalLinks === 0,
        score: updatesLinks > 0 ? 1 : 0.5,
        maxScore: 1,
        details: `${updatesLinks}/${totalLinks} links are UPDATES type`,
        duration: Date.now() - start,
      };
    },
  },
  
  // LINK QUALITY
  {
    name: 'Link Quality: Memory chain links exist',
    category: 'entity_query',
    description: 'Verify memories are connected via chain links',
    run: async (): Promise<ScenarioResult> => {
      const start = Date.now();
      
      const totalLinks = await prisma.memoryChainLink.count();
      const totalMemories = await prisma.memory.count({ where: { deletedAt: null } });
      
      const linksPerMemory = totalMemories > 0 ? totalLinks / totalMemories : 0;
      const passed = linksPerMemory >= 0.1; // At least 0.1 links per memory
      
      return {
        name: 'Link Quality: Memory chain links exist',
        passed,
        score: Math.min(linksPerMemory, 1),
        maxScore: 1,
        details: `${totalLinks} links across ${totalMemories} memories (${linksPerMemory.toFixed(2)} per memory)`,
        duration: Date.now() - start,
      };
    },
  },
  
  {
    name: 'Link Quality: Link type diversity',
    category: 'entity_query',
    description: 'Check for variety in link types (LED_TO, SUPPORTS, RELATED, etc)',
    run: async (): Promise<ScenarioResult> => {
      const start = Date.now();
      
      const linkTypes = await prisma.memoryChainLink.groupBy({
        by: ['linkType'],
        _count: true,
      });
      
      const typeCount = linkTypes.length;
      const passed = typeCount >= 2;
      
      return {
        name: 'Link Quality: Link type diversity',
        passed,
        score: Math.min(typeCount / 4, 1), // 4 types = perfect score
        maxScore: 1,
        details: `Found ${typeCount} link types: ${linkTypes.map(t => `${t.linkType}(${t._count})`).join(', ')}`,
        duration: Date.now() - start,
      };
    },
  },
];

// ============================================================================
// Runner
// ============================================================================

async function runScenarios(): Promise<ScenarioRunResult> {
  console.log('🧪 Running evaluation scenarios...\n');
  
  const results: ScenarioResult[] = [];
  
  for (const scenario of scenarios) {
    console.log(`  ▶ ${scenario.name}...`);
    try {
      const result = await scenario.run();
      results.push(result);
      
      const status = result.passed ? '✓' : '✗';
      console.log(`    ${status} ${result.passed ? 'PASS' : 'FAIL'} (${result.score}/${result.maxScore}) - ${result.details}`);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      results.push({
        name: scenario.name,
        passed: false,
        score: 0,
        maxScore: 1,
        details: `Error: ${errorMsg}`,
      });
      console.log(`    ✗ ERROR: ${errorMsg}`);
    }
  }
  
  const passed = results.filter(r => r.passed).length;
  const failed = results.length - passed;
  const totalScore = results.reduce((sum, r) => sum + r.score, 0);
  const maxScore = results.reduce((sum, r) => sum + r.maxScore, 0);
  
  const runResult: ScenarioRunResult = {
    timestamp: new Date().toISOString(),
    totalScenarios: results.length,
    passed,
    failed,
    passRate: results.length > 0 ? passed / results.length : 0,
    totalScore,
    maxScore,
    overallScorePercent: maxScore > 0 ? (totalScore / maxScore) * 100 : 0,
    scenarios: results,
  };
  
  console.log('\n📊 Summary:');
  console.log(`  Passed: ${passed}/${results.length} (${(runResult.passRate * 100).toFixed(1)}%)`);
  console.log(`  Score:  ${totalScore.toFixed(2)}/${maxScore} (${runResult.overallScorePercent.toFixed(1)}%)`);
  
  return runResult;
}

async function saveResult(result: ScenarioRunResult): Promise<string> {
  const resultsDir = path.join(__dirname, 'results');
  if (!fs.existsSync(resultsDir)) {
    fs.mkdirSync(resultsDir, { recursive: true });
  }
  
  const filename = `scenarios-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  const filepath = path.join(resultsDir, filename);
  
  fs.writeFileSync(filepath, JSON.stringify(result, null, 2));
  console.log(`\n💾 Results saved to: ${filepath}`);
  
  return filepath;
}

async function main() {
  try {
    const result = await runScenarios();
    await saveResult(result);
    console.log('\n✅ Scenario evaluation complete!');
    
    // Exit with error code if any scenarios failed
    if (result.failed > 0) {
      process.exit(1);
    }
  } catch (error) {
    console.error('❌ Scenario evaluation failed:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Export for use in other files
export { scenarios, runScenarios };
export type { ScenarioConfig, ScenarioRunResult };

// Run if executed directly
if (require.main === module) {
  main();
}
