/**
 * Test Script: Verify semantic search with 768-dim embeddings
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const LOCAL_EMBED_URL = 'http://127.0.0.1:8080';

async function embed(text: string): Promise<number[]> {
  const response = await fetch(`${LOCAL_EMBED_URL}/v1/embeddings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ input: text }),
  });
  const data = await response.json();
  return data.data[0].embedding;
}

async function main() {
  console.log('🔍 Testing semantic search with 768-dim embeddings\n');

  // Test queries
  const testQueries = [
    'Beaux wife and family',
    'agent memory and identity',
    'important lessons learned',
    'projects and development work',
  ];

  for (const query of testQueries) {
    console.log(`\n📝 Query: "${query}"`);
    console.log('─'.repeat(50));

    const embedding = await embed(query);
    const embeddingStr = `[${embedding.join(',')}]`;

    const results = await prisma.$queryRawUnsafe<
      Array<{ id: string; raw: string; score: number; layer: string }>
    >(`
      SELECT 
        id,
        SUBSTRING(raw, 1, 100) as raw,
        1 - (embedding <=> $1::vector) as score,
        layer
      FROM memories
      WHERE embedding IS NOT NULL AND deleted_at IS NULL
      ORDER BY embedding <=> $1::vector
      LIMIT 3
    `, embeddingStr);

    for (const r of results) {
      const scorePercent = (r.score * 100).toFixed(1);
      console.log(`  [${scorePercent}%] ${r.layer.padEnd(10)} ${r.raw}...`);
    }
  }

  console.log('\n✅ Search test complete!');
  await prisma.$disconnect();
}

main().catch(console.error);
