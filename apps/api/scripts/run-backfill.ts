/**
 * CLI script to run backfill of missing extraction data
 * Usage: npx ts-node scripts/run-backfill.ts [--dry-run] [--batch-size=50]
 */

import { PrismaClient } from '@prisma/client';

// Parse CLI args
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const batchSizeArg = args.find(a => a.startsWith('--batch-size='));
const batchSize = batchSizeArg ? parseInt(batchSizeArg.split('=')[1], 10) : 50;
const delayMs = 500; // Delay between extractions

const prisma = new PrismaClient();

// Use native fetch to call OpenAI API
async function extractWithLLM(raw: string, userName?: string): Promise<{
  who: string | null;
  what: string | null;
  when: string | null;
  where: string | null;
  why: string | null;
  how: string | null;
  topics: string[];
  entities: Array<{ name: string; type: string }>;
}> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY environment variable is required');
  }

  const prompt = `You are a memory extraction system. Given a piece of text, extract structured information using the 5W1H framework.

${userName ? `IMPORTANT: This memory is about or from a user named "${userName}". Replace generic references like "User", "user", "the user", "I", "they" with "${userName}" in your extraction.` : ''}

Extract these fields (use these EXACT lowercase JSON keys):
- "who": People, organizations, or entities mentioned. ${userName ? `Use "${userName}" instead of generic "User" references.` : ''} Return as a string (single main person/entity), not an array.
- "what": The core fact, action, or statement. Make it a complete, standalone sentence.
- "when": Any temporal context (dates, times, relative references). Use ISO format if possible.
- "where": Location, context, or setting
- "why": Reasoning, motivation, or cause
- "how": Method, manner, or process
- "topics": Relevant categories (e.g., "preferences", "work", "technical", "personal")
- "entities": Named entities with types. Return as array of {name, type} objects where type is: person, organization, project, product, location, or other

If a field cannot be determined from the text, set it to null.
For topics and entities, return empty arrays if none found.

Respond with valid JSON only, using lowercase keys. No explanation.`;

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: prompt },
        { role: 'user', content: `Extract from this memory:\n\n"${raw}"` },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.2,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`OpenAI API error: ${response.status} - ${error}`);
  }

  const data = await response.json() as {
    choices: Array<{ message: { content: string } }>;
  };
  const content = data.choices[0]?.message?.content || '{}';
  const rawResult = JSON.parse(content);

  // Normalize keys to lowercase
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(rawResult)) {
    result[key.toLowerCase()] = value;
  }

  // Handle case where who is returned as array
  let who = result.who;
  if (Array.isArray(who)) {
    who = who[0] || null;
  }

  return {
    who: (who as string) || null,
    what: (result.what as string) || null,
    when: (result.when as string) || null,
    where: (result.where as string) || null,
    why: (result.why as string) || null,
    how: (result.how as string) || null,
    topics: Array.isArray(result.topics) ? result.topics : [],
    entities: Array.isArray(result.entities) ? result.entities : [],
  };
}

async function storeEntities(
  userId: string,
  memoryId: string,
  entities: Array<{ name: string; type: string }>,
): Promise<void> {
  for (const entity of entities) {
    try {
      const normalizedName = entity.name.toLowerCase().trim();

      const existingEntity = await prisma.entity.findUnique({
        where: {
          userId_normalizedName_type: {
            userId,
            normalizedName,
            type: entity.type,
          },
        },
      });

      let entityId: string;

      if (existingEntity) {
        entityId = existingEntity.id;
      } else {
        const newEntity = await prisma.entity.create({
          data: {
            userId,
            name: entity.name,
            normalizedName,
            type: entity.type,
          },
        });
        entityId = newEntity.id;
      }

      await prisma.memoryEntity.upsert({
        where: {
          memoryId_entityId: { memoryId, entityId },
        },
        create: { memoryId, entityId },
        update: {},
      });
    } catch (error) {
      console.error(`  [Entity] Failed to store ${entity.name}:`, error);
    }
  }
}

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  console.log('='.repeat(60));
  console.log('BACKFILL EXTRACTION DATA');
  console.log('='.repeat(60));
  console.log(`Mode: ${dryRun ? 'DRY RUN' : 'LIVE'}`);
  console.log(`Batch size: ${batchSize}`);
  console.log(`Delay between extractions: ${delayMs}ms`);
  console.log('');

  // Find memories needing backfill
  const memories = await prisma.memory.findMany({
    where: {
      deletedAt: null,
      extraction: {
        AND: [
          { who: null },
          { what: null },
        ],
      },
    },
    include: {
      extraction: { select: { id: true } },
      user: { select: { externalId: true } },
    },
    orderBy: { createdAt: 'asc' },
    take: batchSize,
  });

  const totalNeedingBackfill = await prisma.memoryExtraction.count({
    where: {
      AND: [
        { who: null },
        { what: null },
      ],
      memory: { deletedAt: null },
    },
  });

  console.log(`Found ${totalNeedingBackfill} total memories needing backfill`);
  console.log(`Processing ${memories.length} in this batch`);
  console.log('');

  if (memories.length === 0) {
    console.log('Nothing to backfill!');
    await prisma.$disconnect();
    return;
  }

  let processed = 0;
  let errors = 0;

  for (let i = 0; i < memories.length; i++) {
    const memory = memories[i];
    const progress = `[${i + 1}/${memories.length}]`;
    const userName = memory.user.externalId;

    try {
      console.log(`${progress} Processing ${memory.id.substring(0, 12)}...`);
      console.log(`  Raw: "${memory.raw.substring(0, 60)}${memory.raw.length > 60 ? '...' : ''}"`);

      const extracted = await extractWithLLM(memory.raw, userName);

      if (dryRun) {
        console.log(`  [DRY RUN] Would update:`);
        console.log(`    who: "${extracted.who}"`);
        console.log(`    what: "${extracted.what?.substring(0, 50)}..."`);
        console.log(`    topics: [${extracted.topics.join(', ')}]`);
        console.log(`    entities: ${extracted.entities.length} found`);
      } else {
        // Update extraction record
        await prisma.memoryExtraction.update({
          where: { memoryId: memory.id },
          data: {
            who: extracted.who,
            what: extracted.what,
            when: extracted.when ? new Date(extracted.when) : null,
            whereCtx: extracted.where,
            why: extracted.why,
            how: extracted.how,
            topics: extracted.topics,
            extractedAt: new Date(),
          },
        });

        // Store entities
        if (extracted.entities.length > 0) {
          await storeEntities(memory.userId, memory.id, extracted.entities);
        }

        console.log(`  ✓ Updated: who="${extracted.who}", what="${extracted.what?.substring(0, 40)}..."`);
      }

      processed++;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`  ✗ Error: ${errorMessage}`);
      errors++;
    }

    // Add delay to avoid rate limits
    if (delayMs > 0 && i < memories.length - 1) {
      await sleep(delayMs);
    }
  }

  console.log('');
  console.log('='.repeat(60));
  console.log('SUMMARY');
  console.log('='.repeat(60));
  console.log(`Processed: ${processed}`);
  console.log(`Errors: ${errors}`);
  console.log(`Remaining: ${totalNeedingBackfill - processed}`);

  // Verify final counts
  const finalWithWho = await prisma.memoryExtraction.count({
    where: { who: { not: null } },
  });
  const finalWithWhat = await prisma.memoryExtraction.count({
    where: { what: { not: null } },
  });

  console.log('');
  console.log('CURRENT STATE:');
  console.log(`  Extractions with "who": ${finalWithWho}`);
  console.log(`  Extractions with "what": ${finalWithWhat}`);

  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error('Fatal error:', error);
  await prisma.$disconnect();
  process.exit(1);
});
