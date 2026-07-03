import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  // Get memories created after the link
  const linkTime = new Date('2026-02-03T06:56:45.198Z');
  
  const recentMemories = await prisma.memory.findMany({
    where: {
      createdAt: { gte: linkTime },
    },
    orderBy: { createdAt: 'asc' },
    select: { 
      id: true, 
      raw: true, 
      createdAt: true, 
      embeddingId: true 
    },
  });
  
  console.log('Memories created after the link was created:');
  console.log('Total:', recentMemories.length);
  
  for (const m of recentMemories) {
    const links = await prisma.memoryChainLink.count({
      where: { OR: [{ sourceId: m.id }, { targetId: m.id }] }
    });
    console.log('\n---');
    console.log('Created:', m.createdAt);
    console.log('Embedding:', m.embeddingId ? 'YES' : 'NO');
    console.log('Links:', links);
    console.log('Raw:', m.raw.substring(0, 100));
  }
  
  // Also check the source memory that created the link
  console.log('\n\n=== The memory that created the link ===');
  const linkSource = await prisma.memoryChainLink.findFirst({
    include: {
      source: { select: { id: true, raw: true, createdAt: true } }
    }
  });
  
  if (linkSource) {
    console.log('Source created at:', linkSource.source.createdAt);
    console.log('Link created at:', linkSource.createdAt);
    console.log('Time between memory and link:', 
      (linkSource.createdAt.getTime() - linkSource.source.createdAt.getTime()) / 1000, 
      'seconds'
    );
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
