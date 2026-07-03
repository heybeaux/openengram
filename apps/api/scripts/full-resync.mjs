/**
 * Full resync script: push all local memories to cloud one-by-one.
 * Uses individual requests to avoid transaction cascading failures.
 * Usage: node scripts/full-resync.mjs
 */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const { PrismaClient } = require('@prisma/client');
const { decrypt } = require('../dist/src/common/encryption.util.js');
const { generateContentHash } = require('../dist/src/common/content-hash.util.js');

const CLOUD_API_BASE = 'https://api.openengram.ai';
const CONCURRENCY = 5;
const BATCH_READ = 200; // Read from DB in batches of 200

async function pushOne(memory, apiKey, instanceId) {
  const payload = {
    memories: [{
      raw: memory.raw,
      layer: memory.layer,
      memoryType: memory.memoryType ?? undefined,
      source: memory.source,
      importanceHint: memory.importanceHint ?? undefined,
      importanceScore: memory.importanceScore,
      effectiveScore: memory.effectiveScore,
      priority: memory.priority,
      contentHash: memory.contentHash,
      localId: memory.id,
      instanceId,
      createdAt: memory.createdAt.toISOString(),
      extraction: memory.extraction
        ? {
            who: memory.extraction.who ?? undefined,
            what: memory.extraction.what ?? undefined,
            when: memory.extraction.when?.toISOString() ?? undefined,
            whereCtx: memory.extraction.whereCtx ?? undefined,
            why: memory.extraction.why ?? undefined,
            how: memory.extraction.how ?? undefined,
            topics: memory.extraction.topics ?? [],
          }
        : undefined,
      entities: memory.entities?.map(me => ({
        name: me.entity.name,
        type: me.entity.type,
        normalizedName: me.entity.normalizedName,
      })),
    }],
    syncProtocolVersion: 2,
  };
  
  const response = await fetch(`${CLOUD_API_BASE}/v1/sync/push`, {
    method: 'POST',
    headers: {
      ...(apiKey.startsWith('esync_')
        ? { 'X-Sync-Key': apiKey }
        : { 'X-AM-API-Key': apiKey }),
      'X-Instance-Id': instanceId,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`${response.status}: ${body.slice(0, 200)}`);
  }
  
  const result = await response.json();
  return result.results[0];
}

async function main() {
  const prisma = new PrismaClient();
  
  try {
    const link = await prisma.cloudLink.findFirst();
    if (!link) { console.error('No cloud link found'); return; }
    
    const apiKey = link.cloudSyncKey
      ? decrypt(link.cloudSyncKey)
      : decrypt(link.cloudApiKey);
    const instanceId = link.instanceId || 'unknown';
    
    const totalPending = await prisma.memory.count({
      where: { deletedAt: null, cloudSyncedAt: null },
    });
    console.log(`Total pending: ${totalPending}`);
    if (totalPending === 0) { console.log('Nothing to sync'); return; }
    
    let synced = 0, created = 0, skipped = 0, errors = 0;
    let cursor = undefined;
    const startTime = Date.now();
    
    while (true) {
      const batch = await prisma.memory.findMany({
        where: { deletedAt: null, cloudSyncedAt: null },
        include: { extraction: true, entities: { include: { entity: true } } },
        take: BATCH_READ,
        orderBy: { createdAt: 'asc' },
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      });
      
      if (batch.length === 0) break;
      
      // Ensure content hashes
      for (const memory of batch) {
        if (!memory.contentHash) {
          const hash = generateContentHash(memory.raw);
          await prisma.memory.update({
            where: { id: memory.id },
            data: { contentHash: hash },
          });
          memory.contentHash = hash;
        }
      }
      
      // Process in parallel with concurrency limit
      for (let i = 0; i < batch.length; i += CONCURRENCY) {
        const chunk = batch.slice(i, i + CONCURRENCY);
        const results = await Promise.allSettled(
          chunk.map(async (memory) => {
            const result = await pushOne(memory, apiKey, instanceId);
            if (result.status === 'created' || result.status === 'updated' || result.status === 'skipped') {
              await prisma.memory.update({
                where: { id: result.sourceMemoryId },
                data: { cloudSyncedAt: new Date() },
              });
              return result.status;
            } else {
              throw new Error(`status=${result.status} error=${result.error || ''}`);
            }
          })
        );
        
        for (const r of results) {
          if (r.status === 'fulfilled') {
            synced++;
            if (r.value === 'created') created++;
            else if (r.value === 'skipped') skipped++;
          } else {
            errors++;
            if (errors <= 5) console.error(`Error: ${r.reason.message.slice(0, 200)}`);
          }
        }
      }
      
      cursor = batch[batch.length - 1].id;
      
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
      const rate = (synced / (Date.now() - startTime) * 1000 * 60).toFixed(0);
      const eta = synced > 0 ? (((totalPending - synced) / (synced / (Date.now() - startTime) * 1000)) / 60).toFixed(0) : '?';
      console.log(`Progress: ${synced + errors}/${totalPending} (synced=${synced} created=${created} skipped=${skipped} errors=${errors}) ${elapsed}s elapsed, ${rate}/min, ETA ~${eta}min`);
    }
    
    console.log(`\nSync complete!`);
    console.log(`Total synced: ${synced}, Created: ${created}, Skipped: ${skipped}, Errors: ${errors}`);
    
    const healthResponse = await fetch(`${CLOUD_API_BASE}/v1/health`);
    const health = await healthResponse.json();
    const localCount = await prisma.memory.count({ where: { deletedAt: null } });
    console.log(`Local: ${localCount}, Cloud: ${health.dependencies.database.memoryCount}`);
    
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(console.error);
