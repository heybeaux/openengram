#!/usr/bin/env npx ts-node
/**
 * Quick script to ingest a project
 * Usage: npx ts-node scripts/ingest-project.ts
 */

import { ingest, IngestOptions } from '../src/ingestion/ingestion.service';
import { Language } from '../src/ingestion/types';

async function main() {
  const projectConfig = {
    name: 'whalehawk-salesforce',
    rootPath: '/Users/clawdbot/provider-prep-salesforce-integration',
    languages: [Language.APEX, Language.LWC, Language.JAVASCRIPT] as Language[],
  };

  console.log(`\n🚀 Starting ingestion for ${projectConfig.name}...`);
  console.log(`   Root: ${projectConfig.rootPath}\n`);

  const options: IngestOptions = {
    projectConfig,
    skipEmbeddings: !process.env.EMBED, // Skip embeddings unless EMBED=1
    onProgress: (phase, current, total) => {
      process.stdout.write(`\r   ${phase}: ${current}/${total}`);
    },
  };

  try {
    const result = await ingest(options);
    
    console.log('\n\n✅ Ingestion complete!\n');
    console.log('📊 Stats:');
    console.log(`   Files discovered: ${result.discovery.files.length}`);
    console.log(`   Files processed: ${result.stats.filesProcessed}`);
    console.log(`   Files skipped: ${result.stats.filesSkipped}`);
    console.log(`   Chunks created: ${result.stats.chunksCreated}`);
    console.log(`   Duration: ${result.stats.duration}ms`);
    
    console.log('\n📦 Chunks by type:');
    const byType = new Map<string, number>();
    for (const chunk of result.chunks) {
      const count = byType.get(chunk.chunkType) || 0;
      byType.set(chunk.chunkType, count + 1);
    }
    for (const [type, count] of byType) {
      console.log(`   ${type}: ${count}`);
    }

    if (result.stats.errors.length > 0) {
      console.log('\n⚠️ Errors:');
      for (const err of result.stats.errors) {
        console.log(`   ${err.file}: ${err.error}`);
      }
    }

    // Sample output
    console.log('\n📝 Sample chunks (first 3):');
    for (const chunk of result.chunks.slice(0, 3)) {
      console.log(`   - ${chunk.chunkType} "${chunk.name}" (${chunk.filePath}:${chunk.lineStart})`);
    }

  } catch (error) {
    console.error('\n❌ Ingestion failed:', error);
    process.exit(1);
  }
}

main();
