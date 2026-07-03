const { PrismaClient } = require('@prisma/client');

const LOCAL_URL = 'postgresql://clawdbot@localhost:5432/engram';
const PROD_URL = 'postgresql://postgres:I8LQDu5EzvVaoRHR@db.sokoclvtxiejsxmpcovv.supabase.co:5432/postgres';

async function copyTable(local, prod, table, where = '') {
  try {
    // Get common columns between local and prod
    const localCols = (await local.$queryRawUnsafe(`SELECT column_name FROM information_schema.columns WHERE table_name='${table}' ORDER BY ordinal_position`)).map(c => c.column_name);
    const prodCols = new Set((await prod.$queryRawUnsafe(`SELECT column_name FROM information_schema.columns WHERE table_name='${table}' ORDER BY ordinal_position`)).map(c => c.column_name));
    const commonCols = localCols.filter(c => prodCols.has(c));
    
    // Check for vector columns to cast
    const colTypes = await local.$queryRawUnsafe(`SELECT column_name, udt_name FROM information_schema.columns WHERE table_name='${table}'`);
    const vectorCols = new Set(colTypes.filter(c => c.udt_name === 'vector').map(c => c.column_name));
    
    const selectCols = commonCols.map(c => vectorCols.has(c) ? `"${c}"::text` : `"${c}"`).join(', ');
    const insertCols = commonCols.map(c => `"${c}"`).join(', ');
    
    const countResult = await local.$queryRawUnsafe(`SELECT count(*) as c FROM "${table}" ${where}`);
    const total = Number(countResult[0].c);
    console.log(`${table}: ${total} rows to copy (${commonCols.length} common cols)`);
    if (total === 0) return;
    
    const BATCH = 100;
    let copied = 0, skipped = 0, errors = 0;
    
    for (let offset = 0; offset < total; offset += BATCH) {
      const rows = await local.$queryRawUnsafe(`SELECT ${selectCols} FROM "${table}" ${where} ORDER BY created_at OFFSET ${offset} LIMIT ${BATCH}`);
      
      for (const row of rows) {
        const vals = commonCols.map(c => {
          const v = row[c];
          if (v === null) return 'NULL';
          if (v instanceof Date) return `'${v.toISOString()}'`;
          if (typeof v === 'boolean') return v.toString();
          if (typeof v === 'number' || typeof v === 'bigint') return v.toString();
          if (typeof v === 'object') return `'${JSON.stringify(v).replace(/'/g, "''")}'::jsonb`;
          // Check if it's a vector string
          if (vectorCols.has(c)) return `'${v}'::vector`;
          return `'${String(v).replace(/'/g, "''")}'`;
        });
        
        // Check for enum columns - handle visibility
        const sql = `INSERT INTO "${table}" (${insertCols}) VALUES (${vals.join(', ')}) ON CONFLICT DO NOTHING`;
        try {
          await prod.$executeRawUnsafe(sql);
          copied++;
        } catch(e) {
          errors++;
          if (errors <= 3) console.log(`  Error: ${e.message?.substring(0, 150)}`);
        }
      }
      if ((offset + BATCH) % 500 === 0 || offset + BATCH >= total) {
        console.log(`  Progress: ${Math.min(offset + BATCH, total)}/${total} copied:${copied} skipped:${skipped} errors:${errors}`);
      }
    }
    console.log(`  Done: copied=${copied} errors=${errors}`);
  } catch(e) {
    console.error(`Failed ${table}:`, e.message?.substring(0, 200));
  }
}

async function run() {
  const local = new PrismaClient({ datasourceUrl: LOCAL_URL });
  const prod = new PrismaClient({ datasourceUrl: PROD_URL });

  // Copy in dependency order
  await copyTable(local, prod, 'accounts');
  await copyTable(local, prod, 'agents');
  await copyTable(local, prod, 'users');
  await copyTable(local, prod, 'memory_clusters');
  await copyTable(local, prod, 'memory_embeddings');
  await copyTable(local, prod, 'memories', 'WHERE deleted_at IS NULL');

  const finalCount = await prod.$queryRawUnsafe(`SELECT count(*) as c FROM memories WHERE deleted_at IS NULL`);
  console.log('Final cloud count:', finalCount[0].c);

  await local.$disconnect();
  await prod.$disconnect();
}

run().catch(e => { console.error(e); process.exit(1); });
