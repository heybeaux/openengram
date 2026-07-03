import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const EMBED_URL = 'http://127.0.0.1:8080/v1/embeddings';
const BATCH_SIZE = 20;

async function embed(text: string, model: string): Promise<number[]> {
  const res = await fetch(EMBED_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ input: text, model }),
  });
  const json = await res.json();
  return json.data[0].embedding;
}

async function main() {
  const memories = await prisma.memory.findMany({
    where: { deletedAt: null },
    select: { id: true, raw: true },
  });
  
  console.log(`Processing ${memories.length} memories...`);
  
  let processed = 0;
  for (const memory of memories) {
    try {
      // Embed with both models
      const bgeEmbedding = await embed(memory.raw, 'bge-base');
      const minilmEmbedding = await embed(memory.raw, 'minilm');
      
      // Upsert bge-base
      await prisma.$executeRaw`
        INSERT INTO memory_embeddings (id, memory_id, model_id, dimensions, embedding, updated_at)
        VALUES (${`${memory.id}-bge`}, ${memory.id}, 'bge-base', 768, ${`[${bgeEmbedding.join(',')}]`}::vector, NOW())
        ON CONFLICT (memory_id, model_id) DO UPDATE SET embedding = EXCLUDED.embedding, updated_at = NOW()
      `;
      
      // Upsert minilm
      await prisma.$executeRaw`
        INSERT INTO memory_embeddings (id, memory_id, model_id, dimensions, embedding, updated_at)
        VALUES (${`${memory.id}-minilm`}, ${memory.id}, 'minilm', 384, ${`[${minilmEmbedding.join(',')}]`}::vector, NOW())
        ON CONFLICT (memory_id, model_id) DO UPDATE SET embedding = EXCLUDED.embedding, updated_at = NOW()
      `;
      
      processed++;
      if (processed % 50 === 0) {
        console.log(`Progress: ${processed}/${memories.length}`);
      }
    } catch (e) {
      console.error(`Failed memory ${memory.id}:`, e);
    }
  }
  
  console.log(`Done! Processed ${processed} memories`);
  
  // Show count
  const count = await prisma.$queryRaw`SELECT COUNT(*) as total FROM memory_embeddings`;
  console.log('Total embeddings:', count);
}

main().catch(console.error).finally(() => prisma.$disconnect());
