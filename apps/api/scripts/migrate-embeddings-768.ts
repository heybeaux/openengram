/**
 * Migration Script: Re-embed all memories to 768-dim local embeddings
 * 
 * Migrates from OpenAI text-embedding-3-small (1536-dim) to 
 * local bge-base-en-v1.5 (768-dim) via engram-embed server.
 * 
 * Usage:
 *   npx ts-node scripts/migrate-embeddings-768.ts
 * 
 * Prerequisites:
 *   - engram-embed server running at http://127.0.0.1:8080
 *   - PostgreSQL with pgvector extension
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const LOCAL_EMBED_URL = process.env.LOCAL_EMBED_URL || 'http://127.0.0.1:8080';
const BATCH_SIZE = 50;

interface EmbeddingResponse {
  object: string;
  data: Array<{
    embedding: number[];
    index: number;
  }>;
  model: string;
}

async function embedBatch(texts: string[]): Promise<number[][]> {
  const response = await fetch(`${LOCAL_EMBED_URL}/v1/embeddings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      input: texts,
      model: 'bge-base-en-v1.5',
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Embedding API error: ${response.status} - ${error}`);
  }

  const data: EmbeddingResponse = await response.json();
  return data.data
    .sort((a, b) => a.index - b.index)
    .map((item) => item.embedding);
}

async function main() {
  console.log('🚀 Starting embedding migration to 768-dim local embeddings\n');

  // Check if engram-embed is running
  try {
    const healthCheck = await fetch(`${LOCAL_EMBED_URL}/v1/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: 'test' }),
    });
    if (!healthCheck.ok) throw new Error('Health check failed');
    console.log('✅ engram-embed server is running\n');
  } catch (error) {
    console.error('❌ engram-embed server not reachable at', LOCAL_EMBED_URL);
    console.error('   Start it with: cd ~/projects/engram-embed && cargo run --release');
    process.exit(1);
  }

  // Get all memories
  const memories = await prisma.memory.findMany({
    where: { deletedAt: null },
    select: { id: true, raw: true },
    orderBy: { createdAt: 'asc' },
  });

  console.log(`📊 Found ${memories.length} memories to process\n`);

  // Check current embedding stats
  const stats = await prisma.$queryRaw<[{ count: bigint; dims: number | null }]>`
    SELECT 
      COUNT(*) as count,
      vector_dims(embedding) as dims 
    FROM memories 
    WHERE embedding IS NOT NULL AND deleted_at IS NULL
    GROUP BY dims
  `;
  
  if (stats.length > 0) {
    console.log('📈 Current embedding stats:');
    for (const stat of stats) {
      console.log(`   ${stat.dims}-dim: ${stat.count} memories`);
    }
    console.log();
  }

  // Process in batches
  let processed = 0;
  let errors = 0;
  const startTime = Date.now();

  for (let i = 0; i < memories.length; i += BATCH_SIZE) {
    const batch = memories.slice(i, i + BATCH_SIZE);
    const texts = batch.map((m) => m.raw);

    try {
      const embeddings = await embedBatch(texts);

      // Update each memory with its new embedding
      for (let j = 0; j < batch.length; j++) {
        const memory = batch[j];
        const embedding = embeddings[j];
        const embeddingStr = `[${embedding.join(',')}]`;

        await prisma.$executeRawUnsafe(`
          UPDATE memories 
          SET 
            embedding = $1::vector,
            embedding_model = 'bge-base-en-v1.5',
            updated_at = NOW()
          WHERE id = $2
        `, embeddingStr, memory.id);
      }

      processed += batch.length;
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      const rate = (processed / parseFloat(elapsed)).toFixed(1);
      process.stdout.write(`\r⏳ Progress: ${processed}/${memories.length} (${rate} mem/s)`);
    } catch (error) {
      console.error(`\n❌ Error processing batch starting at ${i}:`, error);
      errors += batch.length;
    }
  }

  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log('\n\n✅ Migration complete!\n');
  console.log('📊 Summary:');
  console.log(`   Total memories: ${memories.length}`);
  console.log(`   Successfully migrated: ${processed}`);
  console.log(`   Errors: ${errors}`);
  console.log(`   Time: ${totalTime}s`);
  console.log(`   New dimensions: 768 (bge-base-en-v1.5)`);

  // Verify
  const newStats = await prisma.$queryRaw<[{ count: bigint; dims: number | null }]>`
    SELECT 
      COUNT(*) as count,
      vector_dims(embedding) as dims 
    FROM memories 
    WHERE embedding IS NOT NULL AND deleted_at IS NULL
    GROUP BY dims
  `;
  
  console.log('\n📈 Post-migration stats:');
  for (const stat of newStats) {
    console.log(`   ${stat.dims}-dim: ${stat.count} memories`);
  }

  await prisma.$disconnect();
}

main().catch(console.error);
