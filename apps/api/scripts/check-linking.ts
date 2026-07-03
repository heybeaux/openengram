import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const memoryCount = await prisma.memory.count();
  const linkCount = await prisma.memoryChainLink.count();
  const links = await prisma.memoryChainLink.findMany({ take: 5 });
  const memoriesWithEmbeddings = await prisma.memory.count({ where: { embeddingId: { not: null } } });
  const memoriesWithoutEmbeddings = await prisma.memory.count({ where: { embeddingId: null } });
  
  console.log('=== Database Status ===');
  console.log(`Total Memories: ${memoryCount}`);
  console.log(`Memories with embeddings: ${memoriesWithEmbeddings}`);
  console.log(`Memories without embeddings: ${memoriesWithoutEmbeddings}`);
  console.log(`Total Chain Links: ${linkCount}`);
  console.log('\n=== Existing Links ===');
  console.log(JSON.stringify(links, null, 2));
  
  // Get a sample memory
  const sampleMemory = await prisma.memory.findFirst({
    where: { embeddingId: { not: null } },
    select: { id: true, raw: true, embeddingId: true, userId: true },
  });
  console.log('\n=== Sample Memory with Embedding ===');
  console.log(JSON.stringify(sampleMemory, null, 2));
}

main().catch(console.error).finally(() => prisma.$disconnect());
