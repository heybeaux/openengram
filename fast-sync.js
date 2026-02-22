const { PrismaClient } = require('@prisma/client');

const CLOUD_API = 'https://api.openengram.ai';
const BATCH_SIZE = 100;
const AUTH_HEADER = 'Authorization';
const AUTH_VALUE = 'Bearer eng_5a7845e6035da07459793f39b2d19903278814e602b6ae16';

async function main() {
  const prisma = new PrismaClient();
  
  // Get cloud link info
  const link = await prisma.cloudLink.findFirst();
  if (!link) { console.log('No cloud link found'); return; }
  console.log('Instance:', link.instanceId);
  
  // Get API key from the local endpoint
  const statusRes = await fetch('http://localhost:3001/v1/cloud/status', {
    headers: { [AUTH_HEADER]: AUTH_VALUE }
  });
  
  // Get total pending
  const pending = await prisma.memory.count({ where: { deletedAt: null, cloudSyncedAt: null } });
  console.log(`Pending: ${pending}`);
  
  let synced = 0;
  let errors = 0;
  let cursor;
  
  while (true) {
    const batch = await prisma.memory.findMany({
      where: { deletedAt: null, cloudSyncedAt: null },
      include: { extraction: true, entities: { include: { entity: true } } },
      take: BATCH_SIZE,
      orderBy: { createdAt: 'asc' },
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });
    
    if (batch.length === 0) break;
    
    // Ensure content hashes
    for (const m of batch) {
      if (!m.contentHash) {
        const crypto = require('crypto');
        const hash = crypto.createHash('sha256').update(m.raw).digest('hex').slice(0, 16);
        await prisma.memory.update({ where: { id: m.id }, data: { contentHash: hash } });
        m.contentHash = hash;
      }
    }
    
    const payload = {
      memories: batch.map(m => ({
        raw: m.raw,
        layer: m.layer,
        memoryType: m.memoryType ?? undefined,
        source: m.source,
        importanceHint: m.importanceHint ?? undefined,
        importanceScore: m.importanceScore,
        effectiveScore: m.effectiveScore,
        priority: m.priority,
        contentHash: m.contentHash,
        localId: m.id,
        instanceId: link.instanceId || 'unknown',
        createdAt: m.createdAt.toISOString(),
        extraction: m.extraction ? {
          who: m.extraction.who ?? undefined,
          what: m.extraction.what ?? undefined,
          when: m.extraction.when?.toISOString() ?? undefined,
          whereCtx: m.extraction.whereCtx ?? undefined,
          why: m.extraction.why ?? undefined,
          how: m.extraction.how ?? undefined,
          topics: m.extraction.topics ?? [],
        } : undefined,
        entities: m.entities?.map(me => ({
          name: me.entity.name,
          type: me.entity.type,
          normalizedName: me.entity.normalizedName,
        })),
      })),
      syncProtocolVersion: 2,
    };
    
    try {
      const res = await fetch(`${CLOUD_API}/v1/sync/push`, {
        method: 'POST',
        headers: {
          'X-AM-API-Key': link.cloudApiKey,
          'X-Instance-Id': link.instanceId || 'unknown',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });
      
      if (!res.ok) {
        // Maybe the API key is encrypted, try via local proxy
        const text = await res.text();
        console.log(`Cloud API error ${res.status}: ${text.slice(0, 200)}`);
        errors += batch.length;
        // If auth error, we need to go through the local service
        if (res.status === 401 || res.status === 403) {
          console.log('Auth failed - API key may be encrypted. Falling back to local sync endpoint.');
          // Just trigger the built-in sync and let it run
          await fetch('http://localhost:3001/v1/cloud/sync', {
            method: 'POST',
            headers: { [AUTH_HEADER]: AUTH_VALUE },
          });
          console.log('Triggered built-in sync. Exiting fast-sync.');
          await prisma.$disconnect();
          return;
        }
        cursor = batch[batch.length - 1].id;
        continue;
      }
      
      const result = await res.json();
      
      // Bulk update all successfully synced memories
      const successIds = result.results
        .filter(r => r.status === 'created' || r.status === 'updated' || r.status === 'skipped')
        .map(r => r.sourceMemoryId);
      
      if (successIds.length > 0) {
        // Bulk update instead of individual updates!
        await prisma.memory.updateMany({
          where: { id: { in: successIds } },
          data: { cloudSyncedAt: new Date() },
        });
      }
      
      synced += successIds.length;
      const batchErrors = result.results.filter(r => r.status === 'error').length;
      errors += batchErrors;
      
      console.log(`Batch: ${successIds.length} synced, ${batchErrors} errors. Total: ${synced}/${pending}`);
    } catch (e) {
      console.log(`Error: ${e.message}`);
      errors += batch.length;
    }
    
    cursor = batch[batch.length - 1].id;
    
    // Small delay to not overwhelm
    await new Promise(r => setTimeout(r, 100));
  }
  
  console.log(`\nDone! Synced: ${synced}, Errors: ${errors}`);
  
  // Verify
  const localCount = await prisma.memory.count({ where: { deletedAt: null } });
  const remaining = await prisma.memory.count({ where: { deletedAt: null, cloudSyncedAt: null } });
  console.log(`Local: ${localCount}, Still pending: ${remaining}`);
  
  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
